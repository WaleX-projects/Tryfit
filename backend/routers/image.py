import asyncio
import json
import os
import uuid
from datetime import datetime
from typing import Optional

import httpx
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)

from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import get_db
from models import Task,User
from youcam_client import YouCamClient
from routers.auth import get_current_user
from config import YOUCAM_API_KEY
router = APIRouter(prefix="/image", tags=["Image Operations"])

# Load API key securely from environment variables

youcam_client = YouCamClient(api_key=YOUCAM_API_KEY)

"""
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCxtIqYSYruTZscYc0aro+/kYPAdmiAdyXiuoBz9NO5rdS53BXWE6xFZyPNiEQVefVHSdjvaxjRv5aXqyIjf1go7qWmI0alc2ocD0LcZs2X9D8AdWvz9/uLKbg+Ol0hQf1/3pmysUDRZgArFmHjLbJI3kmYkqQcNiP590bYES1KBQIDAQAB"""
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



@router.post("/api/v1/tryon", summary="Generate a try-on image using YouCam API")
async def generate_image(
    request: ImageRequest = Depends(process_image_json),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    uploaded_file: UploadFile = File(...),
):
    """
    Submits user photo and garment image for virtual AI try-on.
    Requires Google authentication and deducts 1 credit per execution.
    """
    # 1. Enforce credit balance limit
    if current_user.credits <= 0:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Insufficient credits. Please top up your account to generate more looks."
        )

    try:
        # 2. Read binary file contents
        file_bytes = await uploaded_file.read()

        # 3. Step 1: Initialize file upload on YouCam
        init_response = await youcam_client.init_file_upload(
            file_name=uploaded_file.filename or "user_upload.jpg",
            file_size=len(file_bytes),
            content_type=uploaded_file.content_type or "image/jpeg",
        )

        files = init_response.get("data", {}).get("files", [])
        if not files or not files[0].get("requests"):
            raise HTTPException(
                status_code=502, detail="Failed to retrieve upload configuration from YouCam."
            )

        file_info = files[0]
        src_file_id = file_info.get("file_id")
        s3_request = file_info["requests"][0]
        upload_url = s3_request.get("url")
        s3_headers = s3_request.get("headers", {})

        # 4. Step 2: Upload raw image binary to storage target
        upload_success = await youcam_client.upload_file_bytes(
            upload_url=upload_url,
            file_bytes=file_bytes,
            content_type=uploaded_file.content_type or "image/jpeg",
            s3_headers=s3_headers,
        )

        if not upload_success:
            raise HTTPException(
                status_code=502, detail="Failed to stream binary payload to storage provider."
            )

        # 5. Step 3: Create AI try-on task
        task_id = await youcam_client.create_tryon_task(
            src_file_id=src_file_id,
            ref_file_url=request.ref_file_url,
            garment_category=request.garment_category,
            change_shoes=request.change_shoes,
        )

        # 6. Deduct credit from authenticated user
        current_user.credits -= 1

        # 7. Save task record bound to authenticated user ID
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
    """Generator streaming real-time status updates via SSE for the owner's task."""
    retry_delay = 2  # Polling interval in seconds

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
                "message": f"Task {task_id} not found."
            })
            yield f"data: {not_found_payload}\n\n"
            break

        # Update local task database record owned by user
        existing_task = db.query(Task).filter(
            Task.task_id == task_id,
            Task.user_id == user_id
        ).first()

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
    db: Session = Depends(get_db)
):
    """
    Establishes an authenticated Server-Sent Events (SSE) stream
    to push real-time task completion updates.
    """
    return StreamingResponse(
        sse_generator(task_id, db, current_user.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disables proxy buffering in Nginx
        },
    )











