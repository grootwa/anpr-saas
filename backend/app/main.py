from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.snapshot import router as snapshot_router
from app.core.config import settings

app = FastAPI(title=settings.PROJECT_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register your routes
app.include_router(snapshot_router, prefix="/v1", tags=["ANPR"])