import os
import json
import base64
import hmac
import hashlib
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from sqlalchemy.orm import Session
from database import get_db
from models import Task, WebhookLog
from config import YOUCAM_WEBHOOK_SECRET

router = APIRouter(tags=["Webhook Operations"])
Test = True

if Test:
    WEBHOOK_SECRET = ""
else:
    WEBHOOK_SECRET = YOUCAM_WEBHOOK_SECRET
#os.getenv("WEBHOOK_SECRET", "whsec_NDg0NDg3MzExNzI0MTE5MjY1OjExNTU1OTk0OTYzMg")

def verify_signature(body_bytes: bytes, webhook_id: str, webhook_timestamp: str, signature_header: str) -> bool:
    """Verifies HMAC-SHA256 signature for Standard Webhooks spec."""
    if not WEBHOOK_SECRET:
        print("⚠️ WEBHOOK_SECRET is not set. Bypassing signature verification.")
        return True

    try:
        # 1. Clean and decode secret (Standard Webhooks format has 'whsec_' prefix)
        secret_str = WEBHOOK_SECRET.removeprefix("whsec_") if WEBHOOK_SECRET.startswith("whsec_") else WEBHOOK_SECRET
        try:
            secret_bytes = base64.b64decode(secret_str)
        except Exception:
            secret_bytes = secret_str.encode("utf-8")

        # 2. Recreate the signed message payload string: {id}.{timestamp}.{body}
        to_sign = f"{webhook_id}.{webhook_timestamp}.".encode("utf-8") + body_bytes

        # 3. Compute HMAC SHA256 base64 digest
        computed_hmac = hmac.new(secret_bytes, to_sign, hashlib.sha256).digest()
        computed_b64 = base64.b64encode(computed_hmac).decode("utf-8")

        # --- DEBUG LOGS ---
        print(f"--- WEBHOOK DEBUG ---")
        print(f"ID received: {webhook_id}")
        print(f"Timestamp received: {webhook_timestamp}")
        print(f"Raw Signature Header: {signature_header}")
        print(f"Computed Base64 Sig: {computed_b64}")
        print(f"---------------------")

        # 4. Parse space-separated or comma-separated signature formats safely
        # Standard Webhooks sends multiple signatures separated by spaces: "v1,sig1 v2,sig2"
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

        print("❌ Signature verification failed: No matching signature found.")
        return False

    except Exception as e:
        print(f"❌ Error during signature verification: {e}")
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

    # 1. Verify Signature
    if not verify_signature(body_bytes, webhook_id, webhook_timestamp, webhook_signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # 2. Parse Payload
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")

    task_id = payload.get("data", {}).get("task_id")
    task_status = payload.get("data", {}).get("task_status")
    

    # 3. Log to webhook_logs
    new_log = WebhookLog(
        task_id=task_id,
        webhook_id=webhook_id,
        event_type=task_status,
        payload=payload
    )
    db.add(new_log)

    # 4. Update tasks status
    if task_id:
        existing_task = db.query(Task).filter(Task.task_id == task_id).first()
        if existing_task:
            existing_task.status = task_status
            db.commit()
    return {"status": "success"}
