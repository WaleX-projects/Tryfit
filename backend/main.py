from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from model import BriaAIService
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize
bria_ai = BriaAIService(api_key="57f68b3b3b244ab58363b8363fcba8c7")

class TryOnRequest(BaseModel):
    product_image: str
    user_image: str

@app.post("/api/try-on")
async def handle_try_on(request: TryOnRequest):
    try:
        # This now waits until the image is actually READY
        final_url = await bria_ai.generate_fit(
            request.product_image, 
            request.user_image
        )
        
        return {
            "status": "success",
            "result_image": final_url 
        }
    except Exception as e:
        print(f"Server Error: {e}")
        # Return the actual error message so you can debug in the extension
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)