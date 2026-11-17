import os
import uuid
import shutil
from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from celery.result import AsyncResult
from app.core.config import settings
from app.core.celery_app import celery
from app.worker.tasks import process_anpr_pipeline

router = APIRouter()

@router.post("/snapshot")
async def create_snapshot(
    file: UploadFile = File(...),
    user_id: int = Form(...) # Accept the tenant ID
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="An image file is required.")

    task_id = str(uuid.uuid4())
    file_ext = file.filename.split(".")[-1]
    file_path = os.path.join(settings.UPLOAD_DIR, f"{task_id}.{file_ext}")
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    # Pass user_id into the background worker
    celery_task = process_anpr_pipeline.delay(task_id, [file_path], user_id)
    
    return JSONResponse(status_code=202, content={
        "message": "Image queued for processing", 
        "task_id": celery_task.id, 
        "status": "processing"
    })

@router.get("/status/{task_id}")
async def get_status(task_id: str):
    task_result = AsyncResult(task_id, app=celery)
    if task_result.ready():
        return {"status": "completed", "result": task_result.result}
    return {"status": "processing"}