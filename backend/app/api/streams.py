import time
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, Camera
from app.services.stream_manager import stream_manager

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class CameraCreateUpdateRequest(BaseModel):
    user_id: int
    gate_no: str
    gate_name: str
    source_url: str
    gate_type: str = "ENTRY"
    line_x1: float = 0.15
    line_y1: float = 0.65
    line_x2: float = 0.85
    line_y2: float = 0.65
    is_active: bool = True


class SlantLineRequest(BaseModel):
    line_x1: float
    line_y1: float
    line_x2: float
    line_y2: float


def serialize_camera(cam: Camera) -> dict:
    worker = stream_manager.get_worker(cam.id)
    return {
        "id": cam.id,
        "gate_no": cam.gate_no,
        "gate_name": cam.gate_name,
        "source_url": cam.source_url,
        "gate_type": cam.gate_type,
        "line_x1": cam.line_x1,
        "line_y1": cam.line_y1,
        "line_x2": cam.line_x2,
        "line_y2": cam.line_y2,
        "is_active": bool(worker and worker.running),
        "connected": bool(worker and worker.connected),
        "status_text": worker.status_text if worker else "Offline",
    }


@router.get("/list")
def list_cameras(user_id: int = Query(...), db: Session = Depends(get_db)):
    cams = db.query(Camera).filter(Camera.user_id == user_id).order_by(Camera.id.asc()).all()
    return [serialize_camera(c) for c in cams]


@router.post("/create")
def create_camera(req: CameraCreateUpdateRequest, db: Session = Depends(get_db)):
    cam = Camera(
        user_id=req.user_id,
        gate_no=req.gate_no.strip(),
        gate_name=req.gate_name.strip(),
        source_url=req.source_url.strip(),
        gate_type=req.gate_type.upper(),
        line_x1=req.line_x1,
        line_y1=req.line_y1,
        line_x2=req.line_x2,
        line_y2=req.line_y2,
        is_active=req.is_active,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)

    if cam.is_active and cam.source_url:
        stream_manager.start_camera(cam)

    return serialize_camera(cam)


@router.put("/{camera_id}")
def update_camera(camera_id: int, req: CameraCreateUpdateRequest, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    source_changed = cam.source_url != req.source_url.strip()
    cam.gate_no = req.gate_no.strip()
    cam.gate_name = req.gate_name.strip()
    cam.source_url = req.source_url.strip()
    cam.gate_type = req.gate_type.upper()
    cam.line_x1 = req.line_x1
    cam.line_y1 = req.line_y1
    cam.line_x2 = req.line_x2
    cam.line_y2 = req.line_y2
    cam.is_active = req.is_active
    db.commit()
    db.refresh(cam)

    if cam.is_active and cam.source_url:
        worker = stream_manager.get_worker(cam.id)
        if not worker or source_changed:
            stream_manager.start_camera(cam)
        else:
            worker.update_config(
                cam.gate_no,
                cam.gate_name,
                cam.gate_type,
                (cam.line_x1, cam.line_y1, cam.line_x2, cam.line_y2),
            )
    else:
        stream_manager.stop_camera(cam.id)

    return serialize_camera(cam)


@router.post("/{camera_id}/toggle")
def toggle_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    worker = stream_manager.get_worker(cam.id)
    if worker and worker.running:
        stream_manager.stop_camera(cam.id)
        cam.is_active = False
    else:
        cam.is_active = True
        stream_manager.start_camera(cam)

    db.commit()
    db.refresh(cam)
    return serialize_camera(cam)


@router.patch("/{camera_id}/line")
def update_camera_slant_line(camera_id: int, req: SlantLineRequest, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    cam.line_x1 = max(0.0, min(1.0, req.line_x1))
    cam.line_y1 = max(0.0, min(1.0, req.line_y1))
    cam.line_x2 = max(0.0, min(1.0, req.line_x2))
    cam.line_y2 = max(0.0, min(1.0, req.line_y2))
    db.commit()

    worker = stream_manager.get_worker(cam.id)
    if worker:
        worker.update_line(cam.line_x1, cam.line_y1, cam.line_x2, cam.line_y2)

    return {"status": "updated", "camera_id": cam.id}


@router.delete("/{camera_id}")
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    stream_manager.stop_camera(cam.id)
    db.delete(cam)
    db.commit()
    return {"status": "deleted", "id": camera_id}


@router.get("/{camera_id}/latest-frame")
def get_camera_latest_frame(camera_id: int):
    worker = stream_manager.get_worker(camera_id)
    if not worker or not worker.running:
        raise HTTPException(status_code=404, detail="Camera stream offline")

    # Signal worker that UI is actively viewing this camera
    worker.last_preview_request = time.time()

    with worker.lock:
        frame_bytes = worker.latest_jpeg

    if not frame_bytes:
        raise HTTPException(status_code=204, detail="Frame warming up")

    return Response(
        content=frame_bytes,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )