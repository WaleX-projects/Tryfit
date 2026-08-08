import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

# Import database models and authentication dependencies from main application
from database import get_db
from models import  Task, User
from .auth import get_current_user



gallery_router = APIRouter(
    prefix="/api/v1/gallery",
    tags=["Gallery Management"]
)


class GalleryItemResponse(BaseModel):
    """Pydantic response schema representing a single gallery item."""
    model_config = ConfigDict(from_attributes=True)

    task_id: str = Field(..., description="Unique task string identifier from YouCam/TryFit")
    user_id: str = Field(..., description="Owner Google Sub ID")
    garment_category: str = Field(..., description="Garment category (e.g. tops, bottoms, auto)")
    change_shoes: bool = Field(True, description="Flag indicating whether shoes were changed")
    status: str = Field(..., description="Task status (e.g. PENDING, SUCCESS, FAILED)")
    src_file_url: str = Field(..., description="Source/User uploaded image URL or ID")
    ref_file_url: str = Field(..., description="Reference product image URL")
    result_url: Optional[str] = Field(None, description="Final AI try-on generated image URL")
    error_message: Optional[str] = Field(None, description="Error message if try-on task failed")
    is_favorite: bool = Field(False, description="Whether the user starred this look")
    title: Optional[str] = Field(None, description="Custom title or tag given by user")
    created_at: Optional[datetime] = Field(None, description="Timestamp when task was created")
    updated_at: Optional[datetime] = Field(None, description="Timestamp when task was last updated")


class GalleryListResponse(BaseModel):
    """Paginated response container for gallery items."""
    total: int = Field(..., description="Total count matching search filters")
    limit: int = Field(..., description="Number of records returned per page")
    offset: int = Field(..., description="Offset index")
    items: List[GalleryItemResponse] = Field(..., description="List of gallery records")


class GalleryCreateRequest(BaseModel):
    """Payload to manually create or register a gallery item."""
    task_id: str = Field(..., min_length=3, description="Unique identifier for the task")
    src_file_url: str = Field(..., description="Source user image URL")
    ref_file_url: str = Field(..., description="Reference garment image URL")
    result_url: Optional[str] = Field(None, description="Result image URL")
    garment_category: str = Field("auto", description="Category of garment")
    change_shoes: bool = Field(True, description="Whether shoes were changed")
    status: str = Field("SUCCESS", description="Initial status of entry")
    title: Optional[str] = Field(None, max_length=255, description="Optional custom title")
    is_favorite: bool = Field(False, description="Favorite flag")


class GalleryUpdateRequest(BaseModel):
    """Payload to update an existing gallery item."""
    is_favorite: Optional[bool] = Field(None, description="Toggle favorite state")
    title: Optional[str] = Field(None, max_length=255, description="Updated custom title")
    garment_category: Optional[str] = Field(None, description="Updated category classification")


@gallery_router.get(
    "",
    response_model=GalleryListResponse,
    summary="List User Gallery Items (Read All)",
    operation_id="list_user_gallery_items"
)
async def list_gallery_items(
    limit: int = Query(20, ge=1, le=100, description="Items per page (max 100)"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
    only_favorites: bool = Query(False, description="Filter only favorited try-on looks"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status (e.g. SUCCESS, PENDING, FAILED)"),
    category: Optional[str] = Query(None, description="Filter by garment category"),
    search: Optional[str] = Query(None, description="Search term matching look title"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **READ (LIST)**: Retrieve past virtual try-on history for the authenticated user.
    Supports filtering by favorites, status, category, search query, and pagination.
    """
    query = db.query(Task).filter(Task.user_id == current_user.id)

    # Apply filters dynamically
    if only_favorites:
        query = query.filter(Task.is_favorite == True)

    if status_filter:
        query = query.filter(Task.status == status_filter.upper())

    if category:
        query = query.filter(Task.garment_category == category)

    if search:
        query = query.filter(Task.title.ilike(f"%{search}%"))

    total_count = query.count()
    items = query.order_by(Task.created_at.desc()).offset(offset).limit(limit).all()

    return GalleryListResponse(
        total=total_count,
        limit=limit,
        offset=offset,
        items=[GalleryItemResponse.model_validate(item) for item in items]
    )


@gallery_router.get(
    "/{task_id}",
    response_model=GalleryItemResponse,
    summary="Get Single Gallery Item (Read One)",
    operation_id="get_gallery_item_by_task_id"
)
async def get_gallery_item(
    task_id: str = Path(..., description="Unique task ID of the try-on result"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **READ (SINGLE)**: Fetch details for a specific try-on look by task_id.
    """
    task = db.query(Task).filter(
        Task.task_id == task_id,
        Task.user_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Gallery item with ID '{task_id}' was not found in your collection."
        )

    return task


@gallery_router.post(
    "",
    response_model=GalleryItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Gallery Entry (Create)",
    operation_id="create_gallery_item"
)
async def create_gallery_item(
    payload: GalleryCreateRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **CREATE**: Manually add a completed try-on result into the user's gallery.
    """
    # Check if task_id already exists
    existing = db.query(Task).filter(Task.task_id == payload.task_id).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Task with ID '{payload.task_id}' already exists in gallery."
        )

    new_task = Task(
        task_id=payload.task_id,
        user_id=current_user.id,
        src_file_url=payload.src_file_url,
        ref_file_url=payload.ref_file_url,
        result_url=payload.result_url,
        garment_category=payload.garment_category,
        change_shoes=payload.change_shoes,
        status=payload.status,
        title=payload.title,
        is_favorite=payload.is_favorite
    )

    db.add(new_task)
    db.commit()
    db.refresh(new_task)
    return new_task


@gallery_router.patch(
    "/{task_id}",
    response_model=GalleryItemResponse,
    summary="Update Gallery Item Details (Update)",
    operation_id="update_gallery_item_by_task_id"
)
async def update_gallery_item(
    payload: GalleryUpdateRequest,
    task_id: str = Path(..., description="Unique task ID to update"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **UPDATE**: Update title, favorite flag, or category of a saved try-on look.
    """
    task = db.query(Task).filter(
        Task.task_id == task_id,
        Task.user_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Gallery item with ID '{task_id}' not found."
        )

    if payload.is_favorite is not None:
        task.is_favorite = payload.is_favorite

    if payload.title is not None:
        task.title = payload.title

    if payload.garment_category is not None:
        task.garment_category = payload.garment_category

    db.commit()
    db.refresh(task)
    return task


@gallery_router.post(
    "/{task_id}/favorite",
    response_model=GalleryItemResponse,
    summary="Toggle Favorite Status",
    operation_id="toggle_gallery_item_favorite"
)
async def toggle_favorite(
    task_id: str = Path(..., description="Task ID to toggle favorite status"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **UPDATE (FAVORITE)**: Quick action endpoint to flip the favorite state of a look.
    """
    task = db.query(Task).filter(
        Task.task_id == task_id,
        Task.user_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Gallery item with ID '{task_id}' not found."
        )

    task.is_favorite = not task.is_favorite
    db.commit()
    db.refresh(task)
    return task


@gallery_router.delete(
    "/{task_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Gallery Item (Delete)",
    operation_id="delete_gallery_item_by_task_id"
)
async def delete_gallery_item(
    task_id: str = Path(..., description="Task ID of item to delete"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    **DELETE**: Permanently remove a try-on look from the user's gallery history.
    """
    task = db.query(Task).filter(
        Task.task_id == task_id,
        Task.user_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Gallery item with ID '{task_id}' not found."
        )

    db.delete(task)
    db.commit()

    return {
        "success": True,
        "message": f"Try-on item '{task_id}' deleted successfully from gallery.",
        "deleted_task_id": task_id
    }