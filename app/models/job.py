from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Index, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("source_url", name="uq_jobs_source_url"),
        Index("ix_jobs_title_company", "title", "company_name"),
        Index("ix_jobs_source_posted", "source", "posted_at"),
    )

    internal_id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source: Mapped[str] = mapped_column(String(32), index=True)
    source_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), index=True)
    company_name: Mapped[str | None] = mapped_column(String(255), index=True, nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), index=True, nullable=True)
    remote: Mapped[bool] = mapped_column(default=False, index=True)
    salary_raw: Mapped[str | None] = mapped_column(String(255), nullable=True)
    salary_min: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    salary_max: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    description_hash: Mapped[str | None] = mapped_column(String(64), index=True, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    scraped_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

