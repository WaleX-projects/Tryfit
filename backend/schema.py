from uuid import UUID
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, HttpUrl, ConfigDict
from models import StatusEnum

# --- Request Schemas ---

class CreateTryOnRequest(BaseModel):
    user_id: UUID
    input_user_image_url: str
    product_ids: List[UUID]  # Unordered list of selected item IDs


# --- Response Schemas ---

class SessionStepResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    step_id: UUID
    step_order: int
    product_id: UUID
    status: StatusEnum
    input_image_url: str
    output_image_url: Optional[str] = None


class TryOnSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    session_id: UUID
    user_id: UUID
    status: StatusEnum
    input_user_image_url: str
    final_output_image_url: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    steps: List[SessionStepResponse]


class CategoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category_id: int
    name: str
    execution_order: int


class ProductResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_id: UUID
    title: str
    sku: str
    category_id: int
    asset_url: str