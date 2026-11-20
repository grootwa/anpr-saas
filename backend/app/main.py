import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.api import agent, auth, parking, snapshot, streams
from app.core.config import settings
from app.core.database import Base, Camera, SessionLocal, engine
from app.services.stream_manager import stream_manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("anpr.main")

# Ensure upload directory exists before mounting StaticFiles
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

# Ensure database tables are initialized
Base.metadata.create_all(bind=engine)


def _resume_saved_cameras_worker() -> None:
    """Resume active cameras in a background thread so Uvicorn startup never blocks on RTSP."""
    db = SessionLocal()
    try:
        active_cams = db.query(Camera).filter(Camera.is_active == True).all()
        logger.info("Startup camera auto-resume: found %d active camera(s).", len(active_cams))
        for cam in active_cams:
            if cam.source_url:
                try:
                    stream_manager.start_camera(cam)
                    logger.info("Resumed camera #%s (%s - %s)", cam.id, cam.gate_no, cam.gate_name)
                except Exception as cam_exc:
                    logger.exception("Failed to resume camera #%s: %s", cam.id, cam_exc)
    except Exception as exc:
        logger.exception("Error querying active cameras during startup: %s", exc)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- STARTUP ---
    logger.info("Starting ANPR Cloud Suite backend...")
    resume_thread = threading.Thread(target=_resume_saved_cameras_worker, daemon=True)
    resume_thread.start()

    yield

    # --- SHUTDOWN ---
    logger.info("Shutting down ANPR Cloud Suite — stopping active camera streams...")
    for cam_id in list(stream_manager.workers.keys()):
        try:
            stream_manager.stop_camera(cam_id)
        except Exception as stop_exc:
            logger.warning("Error stopping camera #%s during shutdown: %s", cam_id, stop_exc)
    logger.info("All camera streams stopped cleanly.")


app = FastAPI(title="ANPR Cloud Suite", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={
            "detail": "Internal server error",
            "path": request.url.path,
            "reason": str(exc),
        },
    )


app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

app.include_router(auth.router, prefix="/v1/auth", tags=["Auth"])
app.include_router(snapshot.router, prefix="/v1", tags=["Snapshot ANPR"])
app.include_router(agent.router, prefix="/v1/agent", tags=["Edge Agents"])
app.include_router(streams.router, prefix="/v1/cameras", tags=["Camera Management"])
app.include_router(parking.router, prefix="/v1/parking", tags=["Smart Parking"])


@app.get("/v1/health", tags=["Diagnostics"])
def health_check():
    """Live diagnostic check for MySQL, Redis queue depth, and active camera threads."""
    db_ok = False
    db_error = None
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception as exc:
        db_error = str(exc)
    finally:
        db.close()

    redis_ok = False
    queue_depth = None
    redis_error = None
    try:
        import redis

        r = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        r.ping()
        redis_ok = True
        queue_depth = r.llen("celery")
    except Exception as exc:
        redis_error = str(exc)

    camera_states = {
        cam_id: {
            "gate": f"{w.gate_no} ({w.gate_name})",
            "running": w.running,
            "connected": w.connected,
            "status": w.status_text,
        }
        for cam_id, w in stream_manager.workers.items()
    }

    overall = "healthy" if (db_ok and redis_ok) else "degraded"
    return {
        "status": overall,
        "database": {"ok": db_ok, "error": db_error},
        "redis": {"ok": redis_ok, "celery_queue_depth": queue_depth, "error": redis_error},
        "cameras": camera_states,
    }