from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.api import snapshot, auth, parking, agent, streams
from app.core.database import SessionLocal, Base, Camera, engine
from app.services.stream_manager import stream_manager

Base.metadata.create_all(bind=engine)

app = FastAPI(title="ANPR Cloud Suite")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router, prefix="/v1/auth", tags=["Auth"])
app.include_router(snapshot.router, prefix="/v1", tags=["Snapshot ANPR"])
app.include_router(agent.router, prefix="/v1/agent", tags=["Edge Agents"])
app.include_router(streams.router, prefix="/v1/cameras", tags=["Camera Management"])
app.include_router(parking.router, prefix="/v1/parking", tags=["Smart Parking"])


@app.on_event("startup")
def resume_saved_cameras():
    db = SessionLocal()
    try:
        active_cams = db.query(Camera).filter(Camera.is_active == True).all()
        for cam in active_cams:
            if cam.source_url:
                stream_manager.start_camera(cam)
    finally:
        db.close()