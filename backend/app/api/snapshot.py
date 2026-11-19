import os
import uuid
import shutil
import math
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Query
from fastapi.responses import JSONResponse
from celery.result import AsyncResult
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.config import settings
from app.core.database import SessionLocal, ANPRLog
from app.worker.tasks import celery, process_anpr_pipeline

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/snapshot")
async def create_snapshot(
    file: UploadFile = File(...),
    user_id: int = Form(...),
    app_source: str = Form("snapshot")
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="An image file is required.")

    task_id = str(uuid.uuid4())
    file_ext = file.filename.split(".")[-1]
    file_path = os.path.join(settings.UPLOAD_DIR, f"{task_id}.{file_ext}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    celery_task = process_anpr_pipeline.delay(task_id, [file_path], user_id, app_source)
    
    return JSONResponse(status_code=202, content={
        "message": "Image queued for processing", 
        "task_id": celery_task.id,
        "image_path": file_path,
        "status": "processing"
    })

@router.get("/status/{task_id}")
async def get_task_status(task_id: str):
    task_result = AsyncResult(task_id, app=celery)
    if task_result.state == "PENDING":
        return {"task_id": task_id, "status": "processing"}
    elif task_result.state == "SUCCESS":
        return {"task_id": task_id, "status": "completed", "result": task_result.result}
    elif task_result.state == "FAILURE":
        return {"task_id": task_id, "status": "failed", "error": str(task_result.info)}
    return {"task_id": task_id, "status": task_result.state}

@router.get("/logs")
def get_anpr_logs(
    user_id: int = Query(...),
    app_source: str = Query("snapshot"),
    search: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=5, le=100),
    db: Session = Depends(get_db)
):
    query = db.query(ANPRLog).filter(
        ANPRLog.user_id == user_id,
        ANPRLog.app_source == app_source
    )

    if search and search.strip():
        clean_search = search.strip().upper().replace(" ", "")
        query = query.filter(
            (ANPRLog.plate_number.ilike(f"%{clean_search}%")) |
            (ANPRLog.category.ilike(f"%{clean_search}%"))
        )

    if status and status != "ALL":
        query = query.filter(ANPRLog.status == status)

    total = query.count()
    total_pages = max(1, math.ceil(total / page_size))
    offset = (page - 1) * page_size

    logs = query.order_by(ANPRLog.created_at.desc()).offset(offset).limit(page_size).all()

    return {
        "items": [
            {
                "id": log.id,
                "task_id": log.task_id,
                "plate_number": log.plate_number,
                "category": log.category or "UNKNOWN",
                "confidence": log.confidence,
                "status": log.status,
                "image_url": f"http://localhost:8000/{log.image_path.replace(chr(92), '/')}",
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/search")
def global_search(
    user_id: int = Query(...),
    q: str = Query(..., min_length=2),
    limit: int = Query(15, le=50),
    db: Session = Depends(get_db)
):
    clean_q = q.strip().upper().replace(" ", "")

    snapshot_hits = (
        db.query(ANPRLog)
        .filter(
            ANPRLog.user_id == user_id,
            ANPRLog.app_source == "snapshot",
            ANPRLog.plate_number.ilike(f"%{clean_q}%"),
        )
        .order_by(ANPRLog.created_at.desc())
        .limit(limit)
        .all()
    )

    parking_hits = (
        db.query(ParkingSession)
        .filter(
            ParkingSession.user_id == user_id,
            ParkingSession.plate_number.ilike(f"%{clean_q}%"),
        )
        .order_by(ParkingSession.entry_time.desc())
        .limit(limit)
        .all()
    )

    results = []
    for s in snapshot_hits:
        results.append({
            "id": f"snap-{s.id}",
            "app": "snapshot",
            "app_label": "Snapshot Studio",
            "plate_number": s.plate_number,
            "meta": f"{s.category or 'STANDARD'} • {s.confidence}% Conf",
            "timestamp": s.created_at.isoformat() if s.created_at else None,
            "image_url": f"http://localhost:8000/{s.image_path.replace(chr(92), '/')}" if s.image_path else None,
        })

    for p in parking_hits:
        results.append({
            "id": f"park-{p.id}",
            "app": "parking",
            "app_label": "Parking & Access",
            "plate_number": p.plate_number,
            "meta": f"{p.access_type} • {p.status} • ₹{p.fee_inr:.0f}",
            "timestamp": p.entry_time.isoformat() if p.entry_time else None,
            "image_url": f"http://localhost:8000/{p.entry_image.replace(chr(92), '/')}" if p.entry_image else None,
        })

    results.sort(key=lambda x: x["timestamp"] or "", reverse=True)
    return {"query": clean_q, "results": results[:limit]}

@router.get("/stats")
def get_anpr_stats(
    user_id: int = Query(...),
    app_source: str = Query("snapshot"),
    db: Session = Depends(get_db)
):
    total_scans = db.query(func.count(ANPRLog.id)).filter(
        ANPRLog.user_id == user_id, ANPRLog.app_source == app_source
    ).scalar() or 0

    verified_scans = db.query(func.count(ANPRLog.id)).filter(
        ANPRLog.user_id == user_id, ANPRLog.app_source == app_source, ANPRLog.status == "success"
    ).scalar() or 0

    failed_scans = db.query(func.count(ANPRLog.id)).filter(
        ANPRLog.user_id == user_id, ANPRLog.app_source == app_source, ANPRLog.status == "OCR_FAILED"
    ).scalar() or 0

    avg_conf = db.query(func.avg(ANPRLog.confidence)).filter(
        ANPRLog.user_id == user_id, ANPRLog.app_source == app_source, ANPRLog.status == "success"
    ).scalar() or 0.0

    return {
        "total_scans": total_scans,
        "verified_scans": verified_scans,
        "failed_scans": failed_scans,
        "avg_confidence": round(float(avg_conf), 1),
    }