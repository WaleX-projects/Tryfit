import httpx
import asyncio
import base64
import io
from PIL import Image

class BriaAIService:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {"api_token": self.api_key}
    
    def _prepare_mask(self, image_b64: str, mask_b64: str):
        # Decode the main image to get its target dimensions
        img_bytes = base64.b64decode(image_b64.split(",")[-1])
        img = Image.open(io.BytesIO(img_bytes))
        target_size = img.size  # (width, height) e.g., (188, 269)

        # Decode the mask and resize it to match the main image exactly
        mask_bytes = base64.b64decode(mask_b64.split(",")[-1])
        mask = Image.open(io.BytesIO(mask_bytes))
        
        # Use NEAREST resampling to keep the mask strictly black/white
        resized_mask = mask.resize(target_size, Image.NEAREST)

        # Convert back to base64
        buffered = io.BytesIO()
        resized_mask.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')

    async def generate_fit(self, garment_base64: str, human_base64: str):
        # NEW: Fix the mask ratio before sending the request
        fixed_mask_b64 = self._prepare_mask(human_base64, garment_base64)
        
        url = "https://engine.prod.bria-api.com/v2/image/edit/gen_fill"
        
        payload = {
    "image": human_base64.split(",")[-1],
    "mask": garment_base64.split(",")[-1], 
    "prompt": "A professional man wearing a tailored blazer, photorealistic, maintain male facial identity, sharp detail",
    "negative_prompt": "woman, female, long hair, makeup, jewelry, changing person, distorted features",
    "version": 2, # Essential for the best prompt adherence
    "guidance_scale": 5 # A higher scale (5-7) makes the AI follow your prompt more strictly
}

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(url, json=payload, headers=self.headers)
            res_data = response.json()

            if response.status_code not in [200, 201, 202]:
                raise Exception(f"Bria rejected the job: {res_data}")

            request_id = res_data.get("request_id")
            status_url = res_data.get("status_url") or f"https://engine.prod.bria-api.com/v2/status/{request_id}"
            
            print(f"Job started! ID: {request_id}. Polling...")

            for attempt in range(45):
                await asyncio.sleep(2)
                status_res = await client.get(status_url, headers=self.headers)
                status_data = status_res.json()
                
                current_status = status_data.get("status")
                if current_status == "COMPLETED":
                    return status_data["result"]["image_url"]
                
                if current_status == "ERROR":
                    raise Exception(f"Bria AI Error: {status_data.get('error')}")

            raise Exception("Timeout: Bria took too long.")