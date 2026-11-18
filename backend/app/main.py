from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.api import snapshot, auth, parking

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
app.include_router(parking.router, prefix="/v1/parking", tags=["Parking & Access Control"])