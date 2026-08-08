import uuid
from sqlalchemy import Column, String, Boolean, Text, DateTime, func, Integer,create_engine, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base
from datetime import datetime
from sqlalchemy.orm import sessionmaker, Session, relationship

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)  # Google Sub ID
    email = Column(String, unique=True, index=True)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    credits = Column(Integer, default=5)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Explicit foreign keys on relationship to avoid ambiguity
    tasks = relationship("Task", back_populates="owner", foreign_keys="Task.user_id")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(String(255), unique=True, nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    client_id = Column(String(255), nullable=True)
    garment_category = Column(String(50), nullable=False, default="auto")
    change_shoes = Column(Boolean, default=True)
    status = Column(String(50), nullable=False, default="PENDING")
    src_file_url = Column(Text, nullable=False)
    ref_file_url = Column(Text, nullable=False)
    result_url = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Backlink to User owner
    owner = relationship("User", back_populates="tasks", foreign_keys=[user_id])


class WebhookLog(Base):
    __tablename__ = "webhook_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id = Column(String(255), nullable=True)
    webhook_id = Column(String(255), nullable=True)
    event_type = Column(String(100), nullable=True)
    payload = Column(JSONB, nullable=False)
    received_at = Column(DateTime(timezone=True), server_default=func.now())
