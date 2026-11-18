from datetime import datetime, timezone
from sqlalchemy import (
    create_engine, Column, BigInteger, Integer, String, Float,
    DateTime, Index, ForeignKey, Boolean
)
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from app.core.config import settings

engine = create_engine(
    settings.MYSQL_URL,
    pool_size=50,
    max_overflow=20,
    pool_pre_ping=True
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

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

# APP 1 & SHARED CORE: Raw ANPR Captures
class ANPRLog(Base):
    __tablename__ = "anpr_logs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    app_source = Column(String(30), nullable=False, default="snapshot")  # 'snapshot' | 'parking'
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
    )

# APP 2: Whitelist & Blacklist Rules
class VehicleRule(Base):
    __tablename__ = "vehicle_rules"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plate_number = Column(String(20), nullable=False)
    rule_type = Column(String(20), nullable=False)  # 'WHITELIST' | 'BLACKLIST'
    owner_label = Column(String(100), nullable=True)  # e.g. "Flat A-402" or "Stolen Alert"
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    owner = relationship("User", back_populates="rules")

    __table_args__ = (
        Index("idx_rule_user_plate", "user_id", "plate_number", unique=True),
    )

# APP 2: Parking & Gate Access Sessions
class ParkingSession(Base):
    __tablename__ = "parking_sessions"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    plate_number = Column(String(20), nullable=False)
    access_type = Column(String(20), nullable=False)  # 'WHITELIST' | 'VISITOR' | 'BLACKLIST'
    gate_action = Column(String(20), nullable=False)  # 'OPENED' | 'LOCKED'
    entry_image = Column(String(255), nullable=True)
    exit_image = Column(String(255), nullable=True)
    entry_time = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    exit_time = Column(DateTime(timezone=True), nullable=True)
    duration_mins = Column(Integer, default=0)
    fee_inr = Column(Float, default=0.0)
    status = Column(String(20), nullable=False, default="PARKED")  # 'PARKED' | 'EXITED' | 'BLOCKED'

    owner = relationship("User", back_populates="sessions")

    __table_args__ = (
        Index("idx_parking_user_status", "user_id", "status", "entry_time"),
        Index("idx_parking_user_plate", "user_id", "plate_number"),
    )

Base.metadata.create_all(bind=engine)