from datetime import datetime, timezone
from sqlalchemy import (
    create_engine,
    Column,
    BigInteger,
    Integer,
    String,
    Float,
    DateTime,
    Index,
    ForeignKey,
    Boolean,
    Text,
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from app.core.config import settings

engine = create_engine(
    settings.MYSQL_URL,
    pool_size=50,
    max_overflow=20,
    pool_pre_ping=True,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class CustomBase:
    __table_args__ = {"extend_existing": True}


Base = declarative_base(cls=CustomBase)


def utc_now():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    full_name = Column(String(120), nullable=False, default="Operator")
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    logs = relationship("ANPRLog", back_populates="owner", cascade="all, delete-orphan")
    rules = relationship("VehicleRule", back_populates="owner", cascade="all, delete-orphan")
    sessions = relationship("ParkingSession", back_populates="owner", cascade="all, delete-orphan")


USER_ID_TYPE = User.__table__.c.id.type


# APP 1 & SHARED CORE: Raw ANPR Captures
class ANPRLog(Base):
    __tablename__ = "anpr_logs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    app_source = Column(String(30), nullable=False, default="snapshot")
    task_id = Column(String(36), unique=True, nullable=False)
    image_path = Column(String(255), nullable=False)

    plate_number = Column(String(20), nullable=False)
    category = Column(String(20), nullable=True)
    confidence = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    owner = relationship("User", back_populates="logs")

    __table_args__ = (
        Index("idx_user_app_created", "user_id", "app_source", "created_at"),
        Index("idx_user_plate", "user_id", "plate_number"),
        {"extend_existing": True},
    )


# Legacy Whitelist & Blacklist Rules (kept for backward compatibility)
class VehicleRule(Base):
    __tablename__ = "vehicle_rules"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plate_number = Column(String(20), nullable=False)
    rule_type = Column(String(20), nullable=False)
    owner_label = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    owner = relationship("User", back_populates="rules")

    __table_args__ = (
        Index("idx_rule_user_plate", "user_id", "plate_number", unique=True),
        {"extend_existing": True},
    )


# APP 2: Unified Parking & Gate Access Sessions
class ParkingSession(Base):
    __tablename__ = "parking_sessions"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plate_number = Column(String(32), nullable=False)
    vehicle_type = Column(String(16), default="4W")
    parking_type = Column(String(32), default="VISITOR")
    access_type = Column(String(20), nullable=False, default="VISITOR")
    gate_action = Column(String(20), nullable=False, default="OPENED")
    entry_gate = Column(String(120), nullable=True)
    exit_gate = Column(String(120), nullable=True)
    entry_image = Column(String(512), nullable=True)
    exit_image = Column(String(512), nullable=True)
    entry_time = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    exit_time = Column(DateTime(timezone=True), nullable=True)
    duration_mins = Column(Integer, default=0)
    fee_inr = Column(Float, default=0.0)
    status = Column(String(20), nullable=False, default="PARKED")

    owner = relationship("User", back_populates="sessions")

    __table_args__ = (
        Index("idx_parking_user_status", "user_id", "status", "entry_time"),
        Index("idx_parking_user_plate", "user_id", "plate_number"),
        {"extend_existing": True},
    )


class EdgeAgent(Base):
    __tablename__ = "edge_agents"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    agent_name = Column(String(120), nullable=False)
    agent_token = Column(String(64), unique=True, index=True, nullable=False)
    direction = Column(String(16), default="ENTRY")
    line_y_ratio = Column(Float, default=0.65)
    is_active = Column(Boolean, default=True)
    last_heartbeat = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)


class Camera(Base):
    __tablename__ = "cameras"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    gate_no = Column(String(32), nullable=False)
    gate_name = Column(String(120), nullable=False)
    source_url = Column(String(512), nullable=False)
    gate_type = Column(String(16), default="ENTRY")
    line_x1 = Column(Float, default=0.15)
    line_y1 = Column(Float, default=0.65)
    line_x2 = Column(Float, default=0.85)
    line_y2 = Column(Float, default=0.65)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)


class OrganizationConfig(Base):
    __tablename__ = "organization_configs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    org_name = Column(String(200), default="Smart Parking Facility")
    address = Column(String(500), default="")
    contact_phone = Column(String(50), default="")
    gst_number = Column(String(50), default="")
    capacity_json = Column(
        Text,
        default='{"parking_types":["VISITOR","RESIDENT","VIP","EV"],"slots":{"2W":{"VISITOR":40,"RESIDENT":30,"VIP":10,"EV":10},"4W":{"VISITOR":50,"RESIDENT":40,"VIP":15,"EV":10},"HCV":{"VISITOR":10,"RESIDENT":5,"VIP":2,"EV":0}}}',
    )
    updated_at = Column(DateTime(timezone=True), default=utc_now)


class RateConfig(Base):
    __tablename__ = "rate_configs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    vehicle_type = Column(String(16), default="4W")
    parking_type = Column(String(32), default="VISITOR")
    grace_period_mins = Column(Integer, default=15)
    base_hours = Column(Integer, default=1)
    base_fee_inr = Column(Float, default=20.0)
    extra_hourly_rate_inr = Column(Float, default=10.0)
    daily_max_cap_inr = Column(Float, default=200.0)
    is_free_for_whitelist = Column(Boolean, default=True)


class RegisteredVehicle(Base):
    __tablename__ = "registered_vehicles"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    plate_number = Column(String(32), index=True, nullable=False)
    owner_name = Column(String(120), nullable=False)
    phone_number = Column(String(32), default="")
    flat_or_unit = Column(String(100), default="")
    vehicle_type = Column(String(16), default="4W")
    parking_type = Column(String(32), default="RESIDENT")
    access_status = Column(String(16), default="WHITELIST")
    valid_until = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)


class CameraLaneConfig(Base):
    __tablename__ = "camera_lane_configs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(USER_ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    lane = Column(String(16), nullable=False)
    source_url = Column(String(512), default="")
    line_y_ratio = Column(Float, default=0.65)
    is_running = Column(Boolean, default=False)
    updated_at = Column(DateTime(timezone=True), default=utc_now)


Base.metadata.create_all(bind=engine)