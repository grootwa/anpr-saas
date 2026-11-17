import os
from dotenv import load_dotenv

load_dotenv()

class Settings:
    PROJECT_NAME = "ANPR SaaS API"
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    MYSQL_URL = os.getenv("MYSQL_URL", "mysql+pymysql://root:root@localhost:3306/anpr_db")
    UPLOAD_DIR = "uploads"
    YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "/home/groot/anpr-saas/backend/app/models/best.onnx")

settings = Settings()
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)