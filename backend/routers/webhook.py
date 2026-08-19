import os
import json
import base64
import hmac
import hashlib
import logging

from sqlalchemy.orm import Session
from database import get_db
from models import Task, WebhookLog, VideoTask
from config import YOUCAM_WEBHOOK_SECRET, YOUCAM_API_KEY
from websocket_manager import manager  # <-- was missing

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from youcam_client import YouCamClient

logger = logging.getLogger(__name__)

youcam_client = YouCamClient(api_key=YOUCAM_API_KEY)

router = APIRouter(tags=["Webhook Operations"])

Test = True
WEBHOOK_SECRET = "" if Test else YOUCAM_WEBHOOK_SECRET


def verify_signature(body_bytes: bytes, webhook_id: str, webhook_timestamp: str, signature_header: str) -> bool:
    """Verifies HMAC-SHA256 signature for Standard Webhooks spec."""
    if not WEBHOOK_SECRET:
        logger.warning("WEBHOOK_SECRET is not set. Bypassing signature verification.")
        return True

    try:
        secret_str = WEBHOOK_SECRET.removeprefix("whsec_") if WEBHOOK_SECRET.startswith("whsec_") else WEBHOOK_SECRET
        try:
            secret_bytes = base64.b64decode(secret_str)
        except Exception:
            secret_bytes = secret_str.encode("utf-8")

        to_sign = f"{webhook_id}.{webhook_timestamp}.".encode("utf-8") + body_bytes
        computed_hmac = hmac.new(secret_bytes, to_sign, hashlib.sha256).digest()
        computed_b64 = base64.b64encode(computed_hmac).decode("utf-8")

        signatures = signature_header.strip().split()
        for sig_part in signatures:
            if "," in sig_part:
                version, sig_val = sig_part.split(",", 1)
            elif "=" in sig_part:
                version, sig_val = sig_part.split("=", 1)
            else:
                version, sig_val = "v1", sig_part

            if version == "v1" and hmac.compare_digest(sig_val, computed_b64):
                return True

        logger.warning("Signature verification failed: no matching signature found.")
        return False

    except Exception as e:
        logger.error("Error during signature verification: %s", e)
        return False


@router.post("/webhook-endpoint")
async def handle_webhook(
    request: Request,
    db: Session = Depends(get_db),
    webhook_id: str = Header(..., alias="webhook-id"),
    webhook_timestamp: str = Header(..., alias="webhook-timestamp"),
    webhook_signature: str = Header(..., alias="webhook-signature"),
):
    body_bytes = await request.body()

    if not verify_signature(body_bytes, webhook_id, webhook_timestamp, webhook_signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    data = payload.get("data", {})
    task_id = data.get("taskId")
    task_status = data.get("taskStatus")
    logger.info("Webhook payload: %s", payload)

    new_log = WebhookLog(
        task_id=task_id,
        webhook_id=webhook_id,
        event_type=task_status,
        payload=payload,
    )
    db.add(new_log)

    if not task_id:
        db.commit()  # still persist the log even with no task_id
        return {"status": "ignored", "message": "No task_id in payload."}

    task_type = None
    db_task = None

    try:
        video_task = db.query(VideoTask).filter(VideoTask.video_task_id == task_id).first()

        if video_task:
            task_type = "video"
            db_task = video_task
            db_task.status = task_status

            if task_status == "success":
                try:
                    task_response = await youcam_client.get_task_video_status(task_id)

                    result_url = task_response.get("data",{}).get('results').get('url')
                    print(f"task_response{task_type}" ,task_response )
                    if result_url:
                        db_task.result_url = result_url
                except Exception as e:
                    logger.error("Failed to fetch video URL for %s: %s", task_id, e)

        else:
            image_task = db.query(Task).filter(Task.task_id == task_id).first()
            if image_task:
                task_type = "image"
                db_task = image_task
                db_task.status = task_status

                if task_status == "success":
                    try:
                        task_response = await youcam_client.get_task_status(task_id)
                        print(f"task_response{task_type}" ,task_response )
                       
                        result_url = task_response.get("data",{}).get('results').get('url')
                            
                        if result_url:
                            db_task.result_url = result_url
                    except Exception as e:
                        logger.error("Failed to fetch image URL for %s: %s", task_id, e)

        if db_task:
            db.commit()
            await manager.send_to_task(task_id, {
                "status": task_status,
                "task_type": task_type,
                "result_url": getattr(db_task, "result_url", None),
                "url_of_product":getattr(db_task, "url_of_product", None),
                "price_of_product":getattr(db_task, "price_of_product", None),
            })
        else:
            logger.warning("Webhook received for unknown task_id: %s", task_id)
            db.commit()  # still save the log

    except Exception as e:
        db.rollback()
        logger.error("Error processing webhook for task_id %s: %s", task_id, e)
        raise HTTPException(status_code=500, detail="Error processing webhook.")

    return {"status": "success"}