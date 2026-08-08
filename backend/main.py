import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers.webhook import router as webhook_router 
from routers.image import router as image_router
from routers.auth import auth_router
from fastapi import WebSocket
from routers.gallery import gallery_router
app = FastAPI(
    title="TryFit AI Virtual Try-On Backend",
    description="FastAPI service with Google OAuth authentication and YouCam virtual try-on API integration.",
    version="1.0.0",
    servers=[
        {"url": "https://tryfit.ddns.net", "description": "Production (HTTPS)"},
        {"url": "http://localhost:8000", "description": "Local Development"},
    ],
)

# Enable CORS for all origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers for different functionalities
app.include_router(image_router) 
app.include_router(webhook_router)
app.include_router(auth_router)
app.include_router(gallery_router)


@app.get("/")
def root():
    return {"message": "Tryfit API is active."}






