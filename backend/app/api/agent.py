import os
import uuid
import secrets
import shutil
from datetime import datetime, timezone
from typing import List
from fastapi import APIRouter, UploadFile, File, Form, Header, HTTPException, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal, EdgeAgent
from app.worker.tasks import process_anpr_pipeline

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class CreateAgentRequest(BaseModel):
    user_id: int
    agent_name: str
    direction: str = "ENTRY"
    line_y_ratio: float = 0.65

@router.post("/register")
def register_agent(req: CreateAgentRequest, db: Session = Depends(get_db)):
    token = f"agt_{secrets.token_hex(20)}"
    agent = EdgeAgent(
        user_id=req.user_id,
        agent_name=req.agent_name,
        agent_token=token,
        direction=req.direction.upper(),
        line_y_ratio=max(0.1, min(0.95, req.line_y_ratio)),
    )
    db.add(agent)
    db.commit()
    db.refresh(agent)
    return {
        "id": agent.id,
        "agent_name": agent.agent_name,
        "agent_token": agent.agent_token,
        "direction": agent.direction,
        "line_y_ratio": agent.line_y_ratio,
    }

@router.get("/list")
def list_agents(user_id: int, db: Session = Depends(get_db)):
    agents = db.query(EdgeAgent).filter(EdgeAgent.user_id == user_id).all()
    return [
        {
            "id": a.id,
            "agent_name": a.agent_name,
            "agent_token": a.agent_token,
            "direction": a.direction,
            "line_y_ratio": a.line_y_ratio,
            "is_active": a.is_active,
            "last_heartbeat": a.last_heartbeat.isoformat() if a.last_heartbeat else None,
        }
        for a in agents
    ]

@router.post("/heartbeat")
def agent_heartbeat(x_agent_token: str = Header(...), db: Session = Depends(get_db)):
    agent = db.query(EdgeAgent).filter(EdgeAgent.agent_token == x_agent_token).first()
    if not agent:
        raise HTTPException(status_code=401, detail="Invalid agent token")
    agent.last_heartbeat = datetime.now(timezone.utc)
    db.commit()
    return {
        "status": "online",
        "direction": agent.direction,
        "line_y_ratio": agent.line_y_ratio,
    }

@router.post("/ingest")
async def ingest_vehicle_crossing(
    files: List[UploadFile] = File(...),
    track_id: int = Form(...),
    x_agent_token: str = Header(...),
    db: Session = Depends(get_db),
):
    agent = db.query(EdgeAgent).filter(EdgeAgent.agent_token == x_agent_token, EdgeAgent.is_active == True).first()
    if not agent:
        raise HTTPException(status_code=401, detail="Unauthorized or inactive edge agent")

    if not files:
        raise HTTPException(status_code=400, detail="At least one vehicle frame is required")

    task_id = str(uuid.uuid4())
    saved_paths = []
    for idx, f in enumerate(files[:5]):  # Cap burst at 5 frames
        ext = (f.filename.split(".")[-1] if f.filename and "." in f.filename else "jpg")
        path = os.path.join(settings.UPLOAD_DIR, f"{task_id}_f{idx}.{ext}")
        with open(path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)
        saved_paths.append(path)

    agent.last_heartbeat = datetime.now(timezone.utc)
    db.commit()

    # Pass auto_gate_direction so Celery triggers Parking Gate & MySQL log upon OCR completion
    celery_task = process_anpr_pipeline.delay(
        task_id,
        saved_paths,
        agent.user_id,
        "parking",
        agent.direction,
    )

    return {
        "status": "queued",
        "task_id": celery_task.id,
        "track_id": track_id,
        "direction": agent.direction,
        "frames_received": len(saved_paths),
    }