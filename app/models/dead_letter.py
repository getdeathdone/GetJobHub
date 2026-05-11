from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class DeadLetter(Base):
    __tablename__ = "dead_letters"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    source: Mapped[str] = mapped_column(String(32), index=True)
    source_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    reason: Mapped[str] = mapped_column(String(255))
    raw_payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

