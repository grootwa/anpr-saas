import os
import uuid
import shutil
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
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db)
):
    query = db.query(ANPRLog).filter(
        ANPRLog.user_id == user_id,
        ANPRLog.app_source == app_source
    )

    if search:
        clean_search = search.strip().upper().replace(" ", "")
        query = query.filter(ANPRLog.plate_number.ilike(f"%{clean_search}%"))

    if status and status != "ALL":
        query = query.filter(ANPRLog.status == status)

    logs = query.order_by(ANPRLog.created_at.desc()).limit(limit).all()

    return [
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
    ]

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