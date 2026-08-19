import asyncio
import json
import os
from typing import Optional
import httpx
from fastapi import FastAPI, APIRouter, Depends, File, Form, UploadFile, HTTPException, Query, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, Column, String, Integer, DateTime, Text, ForeignKey, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session, relationship
from datetime import datetime
from database import get_db

from models import User


GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"

async def verify_google_access_token(token: str) -> dict:
    """
    Verifies Google Access Token retrieved via chrome.identity.getAuthToken
    by querying Google's UserInfo endpoint.
    """
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {token}"},
                timeout=10.0
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired Google OAuth token."
                )
            return response.json()
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Unable to verify token with Google: {exc}"
            )


async def get_current_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
) -> User:

    print(f"Authorization Header: {authorization}")
    print(f"Token Query Param: {token}")
    """
    Dependency that extracts token from either:
      1. 'Authorization: Bearer <token>' Header
      2. '?token=<token>' Query parameter (used by SSE EventSource)
    """
    extracted_token = None

    if authorization and authorization.startswith("Bearer "):
        extracted_token = authorization.split(" ")[1]
    elif token:
        extracted_token = token

    if not extracted_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing."
        )

    # Validate token with Google
    google_user = await verify_google_access_token(extracted_token)
    user_id = google_user.get("sub")
    email = google_user.get("email")

    if not user_id or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user information returned from Google."
        )

    # Retrieve or auto-create user record in database
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        user = User(
            id=user_id,
            email=email,
            name=google_user.get("name"),
            picture=google_user.get("picture"),
            credits=5  # Default sign-up bonus credits
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user





auth_router = APIRouter(prefix="/api/auth", tags=["Authentication"])

class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    credits: int

@auth_router.post("/google", response_model=UserResponse, summary="Verify Google OAuth Token")
async def google_auth(
    current_user: User = Depends(get_current_user)
):
    """
    Authenticates Google Chrome extension users and returns their profile + credit balance.
    """
    return current_user



