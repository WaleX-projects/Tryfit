import httpx
from typing import Optional, Dict, Any


class YouCamClient:
    """Async Client for YouCam AI Clothes V3 API."""

    BASE_URL = "https://yce-api-01.makeupar.com/s2s/v2.0"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def init_file_upload(
        self, file_name: str, file_size: int, content_type: str = "image/jpg"
    ) -> Dict[str, Any]:
        """Step 1: Request presigned upload URL and file_id from YouCam."""
        # FIX: Endpoint is /file, not /file/cloth-v3
        url = f"{self.BASE_URL}/file"
        payload = {
            "files": [
                {
                    "content_type": content_type,
                    "file_name": file_name,
                    "file_size": file_size,
                }
            ]
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            return response.json()

    async def upload_file_bytes(
        self, upload_url: str, file_bytes: bytes, content_type: str = "image/jpg", s3_headers: Optional[Dict[str, str]] = None
    ) -> bool:
        """Step 2: Directly upload in-memory bytes (from FastAPI UploadFile) to S3."""
        upload_headers = {
            "Content-Type": content_type,
            "Content-Length": str(len(file_bytes)),
        }
        # Merge extra headers returned by S3 if present
        if s3_headers:
            upload_headers.update(s3_headers)

        async with httpx.AsyncClient() as client:
            response = await client.put(upload_url, content=file_bytes, headers=upload_headers)
            return response.status_code == 200

    async def create_tryon_task(
        self,
        src_file_url: Optional[str] = None,
        ref_file_url: Optional[str] = None,
        src_file_id: Optional[str] = None,
        ref_file_id: Optional[str] = None,
        garment_category: str = "full_body",
        change_shoes: bool = True,
    ) -> str:
        """Step 5: Submit a virtual try-on task using URLs or File IDs."""
        url = f"{self.BASE_URL}/task/cloth-v3"

        payload: Dict[str, Any] = {
            "garment_category": garment_category,
            "change_shoes": change_shoes,
        }

        if src_file_url:
            payload["src_file_url"] = src_file_url
        elif src_file_id:
            payload["src_file_id"] = src_file_id

        if ref_file_url:
            payload["ref_file_url"] = ref_file_url
        elif ref_file_id:
            payload["ref_file_id"] = ref_file_id

        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, headers=self.headers)
            response.raise_for_status()
            data = response.json()
            return data["data"]["task_id"]

    async def get_task_status(self, task_id: str) -> Dict[str, Any]:
        """Step 6 & 7: Check the status of a virtual try-on task."""
        url = f"{self.BASE_URL}/task/cloth-v3/{task_id}"

        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=self.headers)
            response.raise_for_status()
            return response.json()