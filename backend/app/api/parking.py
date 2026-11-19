import math
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import SessionLocal, VehicleRule, ParkingSession

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class GateEventRequest(BaseModel):
    user_id: int
    plate_number: str
    direction: str  # "ENTRY" | "EXIT"
    image_path: Optional[str] = None

class RuleCreateRequest(BaseModel):
    user_id: int
    plate_number: str
    rule_type: str  # "WHITELIST" | "BLACKLIST"
    owner_label: Optional[str] = ""

@router.post("/gate-event")
def process_gate_event(req: GateEventRequest, db: Session = Depends(get_db)):
    plate = req.plate_number.strip().upper().replace(" ", "")
    if not plate or plate == "NOTEXTDETECTED":
        return {"action": "MANUAL_REVIEW", "message": "Unreadable plate — manual check required"}

    rule = db.query(VehicleRule).filter(
        VehicleRule.user_id == req.user_id,
        VehicleRule.plate_number == plate
    ).first()

    # 1. BLACKLIST CHECK
    if rule and rule.rule_type == "BLACKLIST":
        blocked_session = ParkingSession(
            user_id=req.user_id,
            plate_number=plate,
            access_type="BLACKLIST",
            gate_action="LOCKED",
            entry_image=req.image_path,
            status="BLOCKED"
        )
        db.add(blocked_session)
        db.commit()
        return {
            "action": "LOCKED",
            "access_type": "BLACKLIST",
            "plate_number": plate,
            "message": f"SECURITY ALERT: {rule.owner_label or 'Blacklisted Vehicle'}"
        }

    access_type = "WHITELIST" if (rule and rule.rule_type == "WHITELIST") else "VISITOR"

    # 2. ENTRY GATE LOGIC
    if req.direction.upper() == "ENTRY":
        active = db.query(ParkingSession).filter(
            ParkingSession.user_id == req.user_id,
            ParkingSession.plate_number == plate,
            ParkingSession.status == "PARKED"
        ).first()

        if active:
            return {
                "action": "OPENED",
                "access_type": access_type,
                "plate_number": plate,
                "message": "Vehicle already inside — Barrier Opened"
            }

        session = ParkingSession(
            user_id=req.user_id,
            plate_number=plate,
            access_type=access_type,
            gate_action="OPENED",
            entry_image=req.image_path,
            status="PARKED"
        )
        db.add(session)
        db.commit()
        return {
            "action": "OPENED",
            "access_type": access_type,
            "plate_number": plate,
            "message": "Resident Authorized — Barrier Open" if access_type == "WHITELIST" else "Visitor Pass Started — Barrier Open"
        }

    # 3. EXIT GATE LOGIC
    active = db.query(ParkingSession).filter(
        ParkingSession.user_id == req.user_id,
        ParkingSession.plate_number == plate,
        ParkingSession.status == "PARKED"
    ).order_by(ParkingSession.entry_time.desc()).first()

    now = datetime.now(timezone.utc)
    if not active:
        return {
            "action": "OPENED",
            "access_type": access_type,
            "plate_number": plate,
            "fee_inr": 0.0,
            "message": "No active entry session — Exit Allowed"
        }

    entry_dt = active.entry_time if active.entry_time.tzinfo else active.entry_time.replace(tzinfo=timezone.utc)
    mins = max(1, int((now - entry_dt).total_seconds() // 60))
    hours = math.ceil(mins / 60)
    fee = 0.0 if access_type == "WHITELIST" else float(20 + max(0, hours - 1) * 10)

    active.exit_time = now
    active.exit_image = req.image_path
    active.duration_mins = mins
    active.fee_inr = fee
    active.status = "EXITED"
    db.commit()

    return {
        "action": "OPENED",
        "access_type": access_type,
        "plate_number": plate,
        "duration_mins": mins,
        "fee_inr": fee,
        "message": f"Exit Cleared • Duration: {mins}m • Fee: ₹{fee:.0f}"
    }

@router.get("/sessions")
def list_sessions(
    user_id: int = Query(...),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=5, le=100),
    db: Session = Depends(get_db)
):
    q = db.query(ParkingSession).filter(ParkingSession.user_id == user_id)

    if status and status != "ALL":
        q = q.filter(ParkingSession.status == status)

    if search and search.strip():
        clean_search = search.strip().upper().replace(" ", "")
        q = q.filter(
            (ParkingSession.plate_number.ilike(f"%{clean_search}%")) |
            (ParkingSession.access_type.ilike(f"%{clean_search}%"))
        )

    total = q.count()
    total_pages = max(1, math.ceil(total / page_size))
    offset = (page - 1) * page_size

    rows = q.order_by(ParkingSession.entry_time.desc()).offset(offset).limit(page_size).all()

    return {
        "items": [
            {
                "id": r.id,
                "plate_number": r.plate_number,
                "access_type": r.access_type,
                "gate_action": r.gate_action,
                "entry_time": r.entry_time.isoformat() if r.entry_time else None,
                "exit_time": r.exit_time.isoformat() if r.exit_time else None,
                "duration_mins": r.duration_mins,
                "fee_inr": r.fee_inr,
                "status": r.status,
                "image_url": f"http://localhost:8000/{r.entry_image.replace(chr(92), '/')}" if r.entry_image else None
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/rules")
def list_rules(user_id: int = Query(...), db: Session = Depends(get_db)):
    return db.query(VehicleRule).filter(VehicleRule.user_id == user_id).order_by(VehicleRule.created_at.desc()).all()

@router.post("/rules")
def add_rule(req: RuleCreateRequest, db: Session = Depends(get_db)):
    plate = req.plate_number.strip().upper().replace(" ", "")
    existing = db.query(VehicleRule).filter(
        VehicleRule.user_id == req.user_id,
        VehicleRule.plate_number == plate
    ).first()
    if existing:
        existing.rule_type = req.rule_type
        existing.owner_label = req.owner_label
    else:
        db.add(VehicleRule(
            user_id=req.user_id,
            plate_number=plate,
            rule_type=req.rule_type,
            owner_label=req.owner_label
        ))
    db.commit()
    return {"status": "saved", "plate_number": plate}

@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: int, db: Session = Depends(get_db)):
    db.query(VehicleRule).filter(VehicleRule.id == rule_id).delete()
    db.commit()
    return {"status": "deleted"}