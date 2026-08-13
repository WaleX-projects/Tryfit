import asyncio
import json
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from config import YOUCAM_API_KEY
from database import get_db
from models import Task, User, VideoTask
from routers.auth import get_current_user
from youcam_client import YouCamClient
from websocket_manager import manager

from fastapi import WebSocket, WebSocketDisconnect

router = APIRouter(prefix="/image", tags=["Image Operations"])

youcam_client = YouCamClient(api_key=YOUCAM_API_KEY)


# --- Image Models & Helpers ---
class ImageRequest(BaseModel):
    ref_file_url: str
    garment_category: str = "full_body"
    change_shoes: bool = True


def process_image_json(
    ref_file_url: str = Form(...),
    garment_category: str = Form("full_body"),
    change_shoes: bool = Form(True),
) -> ImageRequest:
    return ImageRequest(
        ref_file_url=ref_file_url,
        garment_category=garment_category,
        change_shoes=change_shoes,
    )


# --- Video Models & Helpers ---
class VideoRequest(BaseModel):
    task_id: str


def process_video_json(
    task_id: str = Form(...),  # Fixed: explicit Form parameter
) -> VideoRequest:
    return VideoRequest(task_id=task_id)


# --- Image Endpoints ---
@router.post("/api/v1/tryon", summary="Generate a try-on image using YouCam API")
async def generate_image(
    request: ImageRequest = Depends(process_image_json),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    uploaded_file: UploadFile = File(...),
):
    if current_user.credits <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please top up your account to generate more looks.",
        )

    try:
        file_bytes = await uploaded_file.read()

        init_response = await youcam_client.init_file_upload(
            file_name=uploaded_file.filename or "user_upload.jpg",
            file_size=len(file_bytes),
            content_type=uploaded_file.content_type or "image/jpeg",
        )

        files = init_response.get("data", {}).get("files", [])
        if not files or not files[0].get("requests"):
            raise HTTPException(
                status_code=502,
                detail="Failed to retrieve upload configuration from YouCam.",
            )

        file_info = files[0]
        src_file_id = file_info.get("file_id")
        s3_request = file_info["requests"][0]
        upload_url = s3_request.get("url")
        s3_headers = s3_request.get("headers", {})

        upload_success = await youcam_client.upload_file_bytes(
            upload_url=upload_url,
            file_bytes=file_bytes,
            content_type=uploaded_file.content_type or "image/jpeg",
            s3_headers=s3_headers,
        )

        if not upload_success:
            raise HTTPException(
                status_code=502,
                detail="Failed to stream binary payload to storage provider.",
            )

        task_id = await youcam_client.create_tryon_task(
            src_file_id=src_file_id,
            ref_file_url=request.ref_file_url,
            garment_category=request.garment_category,
            change_shoes=request.change_shoes,
        )

        current_user.credits -= 1

        task = Task(
            task_id=task_id,
            user_id=current_user.id,
            src_file_url=src_file_id,
            ref_file_url=request.ref_file_url,
            garment_category=request.garment_category,
            change_shoes=request.change_shoes,
            status="pending",
        )
        db.add(task)
        db.commit()

        return {
            "message": "Try-on task created successfully.",
            "task_id": task_id,
            "remaining_credits": current_user.credits,
            "status_code": 201,
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


async def sse_generator(task_id: str, db: Session, user_id: str):
    retry_delay = 2

    while True:
        try:
            task_response = await youcam_client.get_task_status(task_id)
        except Exception as e:
            error_payload = json.dumps({"status": "error", "message": str(e)})
            yield f"data: {error_payload}\n\n"
            break

        data_payload = task_response.get("data", {}) or {}
        task_status = data_payload.get("task_status")

        results = data_payload.get("results") or {}
        result_url = results.get("url") if isinstance(results, dict) else None
        error_msg = data_payload.get("error")

        if not task_status:
            not_found_payload = json.dumps({
                "task_id": task_id,
                "status": "not_found",
                "message": f"Task {task_id} not found.",
            })
            yield f"data: {not_found_payload}\n\n"
            break

        existing_task = (
            db.query(Task)
            .filter(Task.task_id == task_id, Task.user_id == user_id)
            .first()
        )

        if existing_task:
            existing_task.status = task_status
            if result_url:
                existing_task.result_url = result_url
            if error_msg:
                existing_task.error_message = str(error_msg)
            db.commit()

        payload = {
            "task_id": task_id,
            "status": task_status,
            "result_url": result_url,
            "error": error_msg,
        }
        yield f"data: {json.dumps(payload)}\n\n"

        if task_status in ["success", "failed", "error"]:
            break

        await asyncio.sleep(retry_delay)


@router.get(
    "/api/v1/task/{task_id}",
    summary="Get the status of a try-on task via SSE",
    response_class=StreamingResponse,
)
async def stream_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return StreamingResponse(
        sse_generator(task_id, db, current_user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )








@router.post(
    "/api/v1/tryon-motion", summary="Generate a try-on video using YouCam API"
)
async def generate_video(
    requests: VideoRequest = Depends(process_video_json),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    VIDEO_CREDIT_COST = 10

    if current_user.credits < VIDEO_CREDIT_COST:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please top up your account to generate a video.",
        )

    try:
        # Fixed: using requests.task_id
        existing_task = (
            db.query(Task)
            .filter(
                Task.task_id == requests.task_id,
                Task.user_id == current_user.id,
            )
            .first()
        )

        if existing_task is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Task not found."
            )

        if existing_task.status != "success" or not existing_task.result_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Source image task has not completed successfully yet.",
            )

        image_url = existing_task.result_url

        video_task = await youcam_client.create_tryon_video_task(
            src_file_url=image_url,
        )
        print("video_task_data",video_task)
        video_task_id = video_task.get("data", {}).get("task_id") or video_task.get("task_id")


        current_user.credits -= VIDEO_CREDIT_COST

        new_video_task = VideoTask(
            task_id=existing_task.task_id,   # FK linking to static task in tasks table
            video_task_id=video_task_id,   # YouCam's remote video processing ID
            user_id=current_user.id,
            status="pending",
        )
        db.add(new_video_task)
        db.commit()
        

        return {
            "message": "Video try-on task created successfully.",
            "task_id": video_task_id,
            "remaining_credits": current_user.credits,
            "status_code": 201,
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))



@router.websocket("/ws/task-status/{task_id}")
async def websocket_task_status(websocket: WebSocket, task_id: str):
    await manager.connect(websocket, task_id)
    try:
        while True:
            # Keep the connection open and wait for client disconnection
            # We just wait for ping/pong or client closure
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, task_id)
