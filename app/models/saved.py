from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class SavedJob(Base):
    __tablename__ = "saved_jobs"
    __table_args__ = (UniqueConstraint("job_id", name="uq_saved_jobs_job_id"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.internal_id", ondelete="CASCADE"), index=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    saved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SearchCategory(Base):
    __tablename__ = "search_categories"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    query: Mapped[str] = mapped_column(String(255), index=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remote: Mapped[bool | None] = mapped_column(nullable=True)
    salary_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    sources: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CategoryJob(Base):
    __tablename__ = "category_jobs"
    __table_args__ = (UniqueConstraint("category_id", "job_id", name="uq_category_jobs_pair"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    category_id: Mapped[UUID] = mapped_column(
        ForeignKey("search_categories.id", ondelete="CASCADE"),
        index=True,
    )
    job_id: Mapped[UUID] = mapped_column(ForeignKey("jobs.internal_id", ondelete="CASCADE"), index=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
