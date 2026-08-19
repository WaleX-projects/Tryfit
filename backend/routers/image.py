import asyncio
import json
from typing import Optional
import traceback

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

router = APIRouter(prefix="/api", tags=["Image Operations"])





youcam_client = YouCamClient(api_key=YOUCAM_API_KEY)



#---------------------------------------------------------------------------------------------
#                            REQUEST  & RESPONSE MODELS 
#----------------------------------------------------------------------------------------------

# --- Image Models & Helpers ---
class ImageRequest(BaseModel):
    ref_file_url: str
    garment_category: str = "full_body"
    change_shoes: bool = True
    price_of_product: Optional[int] = None
    url_of_product: str



def process_image_json(
    ref_file_url: str = Form(...),
    garment_category: str = Form("full_body"),
    change_shoes: bool = Form(True),
    price_of_product: Optional[int] = None,
    url_of_product: str = Form(...)
) -> ImageRequest:

    print(
        ref_file_url,
        garment_category,
        change_shoes,
        price_of_product,
        url_of_product
    )
    return ImageRequest(
        ref_file_url=ref_file_url,
        garment_category=garment_category,
        change_shoes=change_shoes,
        price_of_product=price_of_product,
        url_of_product=url_of_product
    )


# --- Video Models & Helpers ---
class VideoRequest(BaseModel):
    task_id: str


def process_video_json(
    task_id: str = Form(...),  # Fixed: explicit Form parameter
) -> VideoRequest:
    return VideoRequest(task_id=task_id)


# --- Image Endpoints ---
@router.post("/image/v1/tryon", summary="Generate a try-on image using YouCam API")
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
        
        #asyncio.time(10)
        current_user.credits -= 1

        task = Task(
            task_id=task_id,
            user_id=current_user.id,
            src_file_url=src_file_id,
            ref_file_url=request.ref_file_url,
            garment_category=request.garment_category,
            change_shoes=request.change_shoes,
            url_of_product=request.url_of_product,
            price_of_product=request.price_of_product,
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
        print("IMAGE TRYON ERROR:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))





# ---------------------------------------------------------------------------------------------
#                            VIDEO ENDPOINTS
# ---------------------------------------------------------------------------------------------


@router.post(
    "/video/v1/tryon-motion", summary="Generate a try-on video using YouCam API"
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
            image_task_id=existing_task.task_id,
            video_task_id=video_task_id,
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
async def websocket_task_status(
    websocket: WebSocket,
    task_id: str,
    task_type: Optional[str] = None,
    db: Session = Depends(get_db),
):

    print("========== WEBSOCKET ==========")
    print("task_id:", task_id)
    print("task_type:", task_type)

    if task_type == "video":

        db_task = (
            db.query(VideoTask)
            .filter(
                VideoTask.video_task_id == task_id
            )
            .first()
        )

    else:

        db_task = (
            db.query(Task)
            .filter(
                Task.task_id == task_id
            )
            .first()
        )

    print("db_task:", db_task)

    if db_task is None:

        print("❌ TASK NOT FOUND")

        await websocket.close(code=1008)

        return

    print("✅ TASK FOUND")

    await manager.connect(
        websocket,
        task_id,
    )

    try:

        if task_type == "video":

            await websocket.send_json({
                "type": "video_status",
                "video_task_id": db_task.video_task_id,
                "status": db_task.status,
                "video_url": db_task.result_url,
                "error": db_task.error_message,
            })

        else:

            await websocket.send_json({
                "type": "image_status",
                "task_id": db_task.task_id,
                "status": db_task.status,
                "image_url": db_task.result_url,
                "error": db_task.error_message,
            })

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:

        manager.disconnect(
            websocket,
            task_id,
        )
