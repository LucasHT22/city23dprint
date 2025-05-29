from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import FileResponse
from tasks import generate_model_task
from celery.result import AsyncResult
import os

app = FastAPI()

@app.get("/generate")
def generate_model(city: str, lat: float, lon: float, radius: int = 1000):
    zip_path = f"static/cities/{city.replace(' ', '_')}.zip"
    task = generate_model_task.delay(city, lat, lon, radius, zip_path)
    return {"task_id": task.id}

@app.get("/status/{task_id}")
def get_status(task_id: str):
    result = AsyncResult(task_id)
    return {"status": result.status}

@app.get("/download")
def download(city: str):
    zip_path = f"static/cities/{city.replace(' ', '_')}.zip"
    if os.path.exists(zip_path):
         return FileResponse(zip_path, filename=os.path.basename(zip_path))
    return {"error": "File not found"}