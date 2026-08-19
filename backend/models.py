import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    Boolean,
    Text,
    DateTime,
    Integer,
    ForeignKey,
    func,
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, relationship


Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)  # Google Sub ID
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    picture = Column(String, nullable=True)
    credits = Column(Integer, default=5, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=True,
    )

    # User -> Image Tasks
    tasks = relationship(
        "Task",
        back_populates="owner",
        cascade="all, delete-orphan",
    )

    # User -> Video Tasks
    video_tasks = relationship(
        "VideoTask",
        back_populates="owner",
        cascade="all, delete-orphan",
    )


class Task(Base):
    """
    Represents the original image try-on task.
    """

    __tablename__ = "tasks"

    # Internal DB ID
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # External API task ID
    task_id = Column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    client_id = Column(
        String(255),
        nullable=True,
        index=True,
    )

    garment_category = Column(
        String(50),
        nullable=False,
        default="auto",
    )

    change_shoes = Column(
        Boolean,
        default=True,
        nullable=False,
    )

    status = Column(
        String(50),
        nullable=False,
        default="PENDING",
        index=True,
    )

    src_file_url = Column(
        Text,
        nullable=False,
    )

    ref_file_url = Column(
        Text,
        nullable=False,
    )

    result_url = Column(
        Text,
        nullable=True,
    )

    price_of_product = Column(
        Integer,
        nullable=True
    )

    url_of_product = Column(
        Text,
        nullable=True,
    )


    error_message = Column(
        Text,
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Task -> User
    owner = relationship(
        "User",
        back_populates="tasks",
    )

    # Task -> VideoTask
    video_task = relationship(
        "VideoTask",
        back_populates="image_task",
        uselist=False,
        cascade="all, delete-orphan",
    )


class VideoTask(Base):
    """
    Represents the video generation task created from an image try-on.
    """

    __tablename__ = "video_tasks"

    # Internal DB ID
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # Original image task's external task ID
    image_task_id = Column(
        String(255),
        ForeignKey("tasks.task_id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # External video API task ID
    video_task_id = Column(
        String(255),
        nullable=True,
        unique=True,
        index=True,
    )

    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    result_url = Column(
        Text,
        nullable=True,
    )

    status = Column(
        String(50),
        nullable=False,
        default="PENDING",
        index=True,
    )

    error_message = Column(
        Text,
        nullable=True,
    )

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # VideoTask -> Image Task
    image_task = relationship(
        "Task",
        back_populates="video_task",
    )

    # VideoTask -> User
    owner = relationship(
        "User",
        back_populates="video_tasks",
    )


class WebhookLog(Base):
    """
    Stores every webhook received from external services.
    """

    __tablename__ = "webhook_logs"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    task_id = Column(
        String(255),
        nullable=True,
        index=True,
    )

    webhook_id = Column(
        String(255),
        nullable=True,
        index=True,
    )

    event_type = Column(
        String(100),
        nullable=True,
    )

    payload = Column(
        JSONB,
        nullable=False,
    )

    received_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )