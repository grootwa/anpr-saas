import json
import math
from datetime import datetime, timezone
from typing import Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import (
    SessionLocal,
    ParkingSession,
    RegisteredVehicle,
    RateConfig,
    OrganizationConfig,
)

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class OrgConfigRequest(BaseModel):
    user_id: int
    org_name: str
    address: str = ""
    contact_phone: str = ""
    gst_number: str = ""
    capacity_data: dict


class RateCreateRequest(BaseModel):
    user_id: int
    vehicle_type: str = "4W"
    parking_type: str = "VISITOR"
    grace_period_mins: int = 15
    base_hours: int = 1
    base_fee_inr: float = 20.0
    extra_hourly_rate_inr: float = 10.0
    daily_max_cap_inr: float = 200.0
    is_free_for_whitelist: bool = True


class VehicleRegisterRequest(BaseModel):
    user_id: int
    plate_number: str
    owner_name: str
    phone_number: str = ""
    flat_or_unit: str = ""
    vehicle_type: str = "4W"
    parking_type: str = "RESIDENT"
    access_status: str = "WHITELIST"
    valid_until: Optional[str] = None


class GateEventRequest(BaseModel):
    user_id: int
    plate_number: str
    direction: str
    gate_label: Optional[str] = "Manual Console"
    vehicle_type: Optional[str] = "4W"
    image_path: Optional[str] = None


def normalize_plate(raw: str) -> str:
    return "".join(ch for ch in (raw or "").upper().strip() if ch.isalnum())


def calculate_dynamic_tariff(
    db: Session,
    user_id: int,
    vehicle_type: str,
    parking_type: str,
    access_type: str,
    elapsed_mins: int,
) -> float:
    rate = (
        db.query(RateConfig)
        .filter(
            RateConfig.user_id == user_id,
            RateConfig.vehicle_type == vehicle_type,
            RateConfig.parking_type == parking_type,
        )
        .first()
    )
    if not rate:
        rate = (
            db.query(RateConfig)
            .filter(RateConfig.user_id == user_id, RateConfig.vehicle_type == vehicle_type)
            .first()
        )

    if access_type == "WHITELIST" and (not rate or rate.is_free_for_whitelist):
        return 0.0

    grace = rate.grace_period_mins if rate else 15
    if elapsed_mins <= grace:
        return 0.0

    base_hrs = max(1, rate.base_hours if rate else 1)
    base_fee = rate.base_fee_inr if rate else (10.0 if vehicle_type == "2W" else 20.0)
    extra_rate = rate.extra_hourly_rate_inr if rate else (5.0 if vehicle_type == "2W" else 10.0)
    daily_cap = rate.daily_max_cap_inr if rate else 200.0

    base_mins = base_hrs * 60
    if elapsed_mins <= base_mins:
        total = base_fee
    else:
        extra_hours = math.ceil((elapsed_mins - base_mins) / 60.0)
        total = base_fee + (extra_hours * extra_rate)

    if daily_cap > 0:
        total = min(total, daily_cap)
    return round(float(total), 2)


def process_gate_decision(
    db: Session,
    user_id: int,
    plate_number: str,
    direction: Union[str, dict],
    image_path: Optional[str] = None,
) -> dict:
    if isinstance(direction, dict):
        lane_dir = (direction.get("direction") or "ENTRY").upper()
        gate_label = direction.get("gate_label") or lane_dir
        detected_vtype = direction.get("vehicle_type") or "4W"
    else:
        lane_dir = (direction or "ENTRY").upper()
        gate_label = lane_dir
        detected_vtype = "4W"

    clean_plate = normalize_plate(plate_number)
    now_utc = datetime.now(timezone.utc)

    if not clean_plate or clean_plate == "NOTEXTDETECTED":
        return {
            "action": "MANUAL_REVIEW",
            "access_type": "UNKNOWN",
            "plate_number": "UNREADABLE",
            "message": f"Unreadable vehicle plate at {gate_label}.",
            "fee_inr": 0.0,
        }

    reg = (
        db.query(RegisteredVehicle)
        .filter(
            RegisteredVehicle.user_id == user_id,
            RegisteredVehicle.plate_number == clean_plate,
        )
        .first()
    )

    access_type = reg.access_status.upper() if reg else "VISITOR"
    vehicle_type = reg.vehicle_type if reg else detected_vtype
    parking_type = reg.parking_type if reg else "VISITOR"

    if access_type == "BLACKLIST":
        blocked = ParkingSession(
            user_id=user_id,
            plate_number=clean_plate,
            vehicle_type=vehicle_type,
            parking_type=parking_type,
            access_type="BLACKLIST",
            gate_action="LOCKED",
            entry_gate=gate_label if lane_dir == "ENTRY" else None,
            exit_gate=gate_label if lane_dir == "EXIT" else None,
            entry_time=now_utc,
            duration_mins=0,
            fee_inr=0.0,
            status="BLOCKED",
            entry_image=image_path if lane_dir == "ENTRY" else None,
            exit_image=image_path if lane_dir == "EXIT" else None,
        )
        db.add(blocked)
        db.commit()
        return {
            "action": "LOCKED",
            "access_type": "BLACKLIST",
            "plate_number": clean_plate,
            "message": f"ALERT: Blacklisted vehicle {clean_plate} at {gate_label}!",
            "fee_inr": 0.0,
        }

    if lane_dir == "ENTRY":
        active = (
            db.query(ParkingSession)
            .filter(
                ParkingSession.user_id == user_id,
                ParkingSession.plate_number == clean_plate,
                ParkingSession.status == "PARKED",
            )
            .first()
        )
        if active:
            return {
                "action": "OPENED",
                "access_type": access_type,
                "plate_number": clean_plate,
                "message": f"{clean_plate} already inside (Session #{active.id}).",
                "fee_inr": 0.0,
            }

        sess = ParkingSession(
            user_id=user_id,
            plate_number=clean_plate,
            vehicle_type=vehicle_type,
            parking_type=parking_type,
            access_type=access_type,
            gate_action="OPENED",
            entry_gate=gate_label,
            entry_time=now_utc,
            duration_mins=0,
            fee_inr=0.0,
            status="PARKED",
            entry_image=image_path,
        )
        db.add(sess)
        db.commit()
        owner_tag = f" • {reg.owner_name}" if reg else ""
        return {
            "action": "OPENED",
            "access_type": access_type,
            "plate_number": clean_plate,
            "message": f"ENTRY ({gate_label}): {clean_plate} [{vehicle_type}]{owner_tag}",
            "fee_inr": 0.0,
        }

    # EXIT FLOW
    active = (
        db.query(ParkingSession)
        .filter(
            ParkingSession.user_id == user_id,
            ParkingSession.plate_number == clean_plate,
            ParkingSession.status == "PARKED",
        )
        .order_by(ParkingSession.entry_time.desc())
        .first()
    )

    if not active:
        exit_only = ParkingSession(
            user_id=user_id,
            plate_number=clean_plate,
            vehicle_type=vehicle_type,
            parking_type=parking_type,
            access_type=access_type,
            gate_action="OPENED",
            exit_gate=gate_label,
            entry_time=now_utc,
            exit_time=now_utc,
            duration_mins=0,
            fee_inr=0.0,
            status="EXITED",
            exit_image=image_path,
        )
        db.add(exit_only)
        db.commit()
        return {
            "action": "OPENED",
            "access_type": access_type,
            "plate_number": clean_plate,
            "message": f"EXIT ({gate_label}): {clean_plate} cleared (₹0).",
            "fee_inr": 0.0,
        }

    entry_dt = active.entry_time
    if entry_dt.tzinfo is None:
        entry_dt = entry_dt.replace(tzinfo=timezone.utc)

    elapsed_mins = max(1, int((now_utc - entry_dt).total_seconds() // 60))
    fee_inr = calculate_dynamic_tariff(
        db, user_id, active.vehicle_type, active.parking_type, access_type, elapsed_mins
    )

    active.exit_gate = gate_label
    active.exit_time = now_utc
    active.duration_mins = elapsed_mins
    active.fee_inr = fee_inr
    active.status = "EXITED"
    active.gate_action = "OPENED"
    if image_path:
        active.exit_image = image_path
    db.commit()

    return {
        "action": "OPENED",
        "access_type": access_type,
        "plate_number": clean_plate,
        "message": f"EXIT ({gate_label}): {clean_plate} • {elapsed_mins}m • ₹{fee_inr:.0f}",
        "fee_inr": fee_inr,
    }


@router.post("/gate-event")
def trigger_gate_event(req: GateEventRequest, db: Session = Depends(get_db)):
    return process_gate_decision(
        db=db,
        user_id=req.user_id,
        plate_number=req.plate_number,
        direction={
            "direction": req.direction,
            "gate_label": req.gate_label or req.direction,
            "vehicle_type": req.vehicle_type or "4W",
        },
        image_path=req.image_path,
    )


@router.get("/stats/today")
def get_today_stats(user_id: int = Query(...), db: Session = Depends(get_db)):
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)

    today_sessions = (
        db.query(ParkingSession)
        .filter(ParkingSession.user_id == user_id, ParkingSession.entry_time >= today_start)
        .all()
    )
    all_parked = (
        db.query(ParkingSession)
        .filter(ParkingSession.user_id == user_id, ParkingSession.status == "PARKED")
        .all()
    )

    org = db.query(OrganizationConfig).filter(OrganizationConfig.user_id == user_id).first()
    cap_data = json.loads(org.capacity_json) if org and org.capacity_json else {"slots": {}}
    slots_map = cap_data.get("slots", {})

    total_slots_by_type = {"2W": 0, "4W": 0, "HCV": 0}
    for vt in ("2W", "4W", "HCV"):
        vt_dict = slots_map.get(vt, {})
        total_slots_by_type[vt] = sum(int(v) for v in vt_dict.values()) if isinstance(vt_dict, dict) else 0

    occupied_by_type = {"2W": 0, "4W": 0, "HCV": 0}
    for p in all_parked:
        vt = p.vehicle_type if p.vehicle_type in occupied_by_type else "4W"
        occupied_by_type[vt] += 1

    today_entries = sum(1 for s in today_sessions if s.status in ("PARKED", "EXITED"))
    today_exits = sum(1 for s in today_sessions if s.status == "EXITED")
    today_alerts = sum(1 for s in today_sessions if s.status == "BLOCKED")
    today_revenue = sum(float(s.fee_inr or 0.0) for s in today_sessions if s.status == "EXITED")

    return {
        "today_entries": today_entries,
        "today_exits": today_exits,
        "today_alerts": today_alerts,
        "today_revenue": round(today_revenue, 2),
        "currently_parked": len(all_parked),
        "occupancy": {
            vt: {
                "occupied": occupied_by_type[vt],
                "total": total_slots_by_type[vt],
                "available": max(0, total_slots_by_type[vt] - occupied_by_type[vt]),
            }
            for vt in ("2W", "4W", "HCV")
        },
    }


@router.get("/events/recent")
def get_recent_events(user_id: int = Query(...), db: Session = Depends(get_db)):
    rows = (
        db.query(ParkingSession)
        .filter(ParkingSession.user_id == user_id)
        .order_by(ParkingSession.id.desc())
        .limit(5)
        .all()
    )
    events = []
    for r in rows:
        latest_ts = r.exit_time or r.entry_time
        img = r.exit_image or r.entry_image
        events.append(
            {
                "event_key": f"{r.id}_{r.status}_{int(latest_ts.timestamp()) if latest_ts else 0}",
                "session_id": r.id,
                "plate_number": r.plate_number,
                "vehicle_type": r.vehicle_type,
                "access_type": r.access_type,
                "status": r.status,
                "gate": r.exit_gate if r.status == "EXITED" else r.entry_gate,
                "fee_inr": r.fee_inr,
                "timestamp": latest_ts.isoformat() if latest_ts else None,
                "image_url": f"http://localhost:8000/{img.replace(chr(92), '/')}" if img else None,
            }
        )
    return events


@router.get("/sessions")
def list_sessions(
    user_id: int = Query(...),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    today_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=5, le=100),
    db: Session = Depends(get_db),
):
    q = db.query(ParkingSession).filter(ParkingSession.user_id == user_id)

    if today_only:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(ParkingSession.entry_time >= today_start)

    if status and status != "ALL":
        q = q.filter(ParkingSession.status == status)

    if search and search.strip():
        clean_search = normalize_plate(search)
        q = q.filter(
            (ParkingSession.plate_number.ilike(f"%{clean_search}%"))
            | (ParkingSession.access_type.ilike(f"%{clean_search}%"))
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
                "vehicle_type": r.vehicle_type,
                "parking_type": r.parking_type,
                "access_type": r.access_type,
                "gate_action": r.gate_action,
                "entry_gate": r.entry_gate,
                "exit_gate": r.exit_gate,
                "entry_time": r.entry_time.isoformat() if r.entry_time else None,
                "exit_time": r.exit_time.isoformat() if r.exit_time else None,
                "duration_mins": r.duration_mins,
                "fee_inr": r.fee_inr,
                "status": r.status,
                "entry_image_url": f"http://localhost:8000/{r.entry_image.replace(chr(92), '/')}" if r.entry_image else None,
                "exit_image_url": f"http://localhost:8000/{r.exit_image.replace(chr(92), '/')}" if r.exit_image else None,
            }
            for r in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


# --- VEHICLE & OWNER REGISTRY ---
@router.get("/vehicles")
def list_registered_vehicles(
    user_id: int = Query(...),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(RegisteredVehicle).filter(RegisteredVehicle.user_id == user_id)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            (RegisteredVehicle.plate_number.ilike(term))
            | (RegisteredVehicle.owner_name.ilike(term))
            | (RegisteredVehicle.flat_or_unit.ilike(term))
        )
    rows = q.order_by(RegisteredVehicle.id.desc()).all()
    return [
        {
            "id": v.id,
            "plate_number": v.plate_number,
            "owner_name": v.owner_name,
            "phone_number": v.phone_number,
            "flat_or_unit": v.flat_or_unit,
            "vehicle_type": v.vehicle_type,
            "parking_type": v.parking_type,
            "access_status": v.access_status,
            "valid_until": v.valid_until,
        }
        for v in rows
    ]


@router.post("/vehicles")
def register_vehicle(req: VehicleRegisterRequest, db: Session = Depends(get_db)):
    clean_plate = normalize_plate(req.plate_number)
    if not clean_plate:
        raise HTTPException(status_code=400, detail="Valid license plate is required")

    existing = (
        db.query(RegisteredVehicle)
        .filter(RegisteredVehicle.user_id == req.user_id, RegisteredVehicle.plate_number == clean_plate)
        .first()
    )
    if existing:
        existing.owner_name = req.owner_name.strip()
        existing.phone_number = req.phone_number.strip()
        existing.flat_or_unit = req.flat_or_unit.strip()
        existing.vehicle_type = req.vehicle_type.upper()
        existing.parking_type = req.parking_type.upper()
        existing.access_status = req.access_status.upper()
        existing.valid_until = req.valid_until
    else:
        existing = RegisteredVehicle(
            user_id=req.user_id,
            plate_number=clean_plate,
            owner_name=req.owner_name.strip(),
            phone_number=req.phone_number.strip(),
            flat_or_unit=req.flat_or_unit.strip(),
            vehicle_type=req.vehicle_type.upper(),
            parking_type=req.parking_type.upper(),
            access_status=req.access_status.upper(),
            valid_until=req.valid_until,
        )
        db.add(existing)

    db.commit()
    return {"status": "saved", "plate_number": clean_plate}


@router.delete("/vehicles/{vehicle_id}")
def delete_registered_vehicle(vehicle_id: int, db: Session = Depends(get_db)):
    v = db.query(RegisteredVehicle).filter(RegisteredVehicle.id == vehicle_id).first()
    if not v:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    db.delete(v)
    db.commit()
    return {"status": "deleted"}


# --- RATE CONFIGURATOR ---
@router.get("/rates")
def list_rates(user_id: int = Query(...), db: Session = Depends(get_db)):
    rates = db.query(RateConfig).filter(RateConfig.user_id == user_id).order_by(RateConfig.id.asc()).all()
    return [
        {
            "id": r.id,
            "vehicle_type": r.vehicle_type,
            "parking_type": r.parking_type,
            "grace_period_mins": r.grace_period_mins,
            "base_hours": r.base_hours,
            "base_fee_inr": r.base_fee_inr,
            "extra_hourly_rate_inr": r.extra_hourly_rate_inr,
            "daily_max_cap_inr": r.daily_max_cap_inr,
            "is_free_for_whitelist": r.is_free_for_whitelist,
        }
        for r in rates
    ]


@router.post("/rates")
def save_rate(req: RateCreateRequest, db: Session = Depends(get_db)):
    vt = req.vehicle_type.upper()
    pt = req.parking_type.upper()
    existing = (
        db.query(RateConfig)
        .filter(
            RateConfig.user_id == req.user_id,
            RateConfig.vehicle_type == vt,
            RateConfig.parking_type == pt,
        )
        .first()
    )
    if existing:
        existing.grace_period_mins = req.grace_period_mins
        existing.base_hours = req.base_hours
        existing.base_fee_inr = req.base_fee_inr
        existing.extra_hourly_rate_inr = req.extra_hourly_rate_inr
        existing.daily_max_cap_inr = req.daily_max_cap_inr
        existing.is_free_for_whitelist = req.is_free_for_whitelist
    else:
        existing = RateConfig(
            user_id=req.user_id,
            vehicle_type=vt,
            parking_type=pt,
            grace_period_mins=req.grace_period_mins,
            base_hours=req.base_hours,
            base_fee_inr=req.base_fee_inr,
            extra_hourly_rate_inr=req.extra_hourly_rate_inr,
            daily_max_cap_inr=req.daily_max_cap_inr,
            is_free_for_whitelist=req.is_free_for_whitelist,
        )
        db.add(existing)
    db.commit()
    return {"status": "saved"}


@router.delete("/rates/{rate_id}")
def delete_rate(rate_id: int, db: Session = Depends(get_db)):
    r = db.query(RateConfig).filter(RateConfig.id == rate_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Rate rule not found")
    db.delete(r)
    db.commit()
    return {"status": "deleted"}


# --- ORGANIZATION & CAPACITY CONFIG ---
@router.get("/org-config")
def get_org_config(user_id: int = Query(...), db: Session = Depends(get_db)):
    org = db.query(OrganizationConfig).filter(OrganizationConfig.user_id == user_id).first()
    if not org:
        org = OrganizationConfig(user_id=user_id)
        db.add(org)
        db.commit()
        db.refresh(org)

    return {
        "org_name": org.org_name,
        "address": org.address,
        "contact_phone": org.contact_phone,
        "gst_number": org.gst_number,
        "capacity_data": json.loads(org.capacity_json),
    }


@router.put("/org-config")
def save_org_config(req: OrgConfigRequest, db: Session = Depends(get_db)):
    org = db.query(OrganizationConfig).filter(OrganizationConfig.user_id == req.user_id).first()
    if not org:
        org = OrganizationConfig(user_id=req.user_id)
        db.add(org)

    org.org_name = req.org_name.strip()
    org.address = req.address.strip()
    org.contact_phone = req.contact_phone.strip()
    org.gst_number = req.gst_number.strip()
    org.capacity_json = json.dumps(req.capacity_data)
    org.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "saved"}