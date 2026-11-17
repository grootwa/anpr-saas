from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, BigInteger, String, Float, DateTime, Index, ForeignKey, Boolean
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
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)
    
    logs = relationship("ANPRLog", back_populates="owner", cascade="all, delete-orphan")

class ANPRLog(Base):
    __tablename__ = "anpr_logs"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    
    task_id = Column(String(36), unique=True, nullable=False)
    image_path = Column(String(255), nullable=False)
    
    plate_number = Column(String(20), nullable=False)
    category = Column(String(20), nullable=True) 
    confidence = Column(Float, nullable=False, default=0.0)
    status = Column(String(20), nullable=False) 
    
    created_at = Column(DateTime(timezone=True), default=utc_now, nullable=False)

    owner = relationship("User", back_populates="logs")

    __table_args__ = (
        Index('idx_user_created', 'user_id', 'created_at'),
        Index('idx_user_plate', 'user_id', 'plate_number'),
    )

Base.metadata.create_all(bind=engine)