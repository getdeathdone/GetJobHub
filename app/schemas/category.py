from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    query: str = Field(min_length=1, max_length=255)
    city: str | None = None
    remote: bool | None = None
    salary_min: float | None = None
    sources: list[str] | None = None


class CategoryRead(CategoryCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    created_at: datetime
    last_synced_at: datetime | None = None
    total: int = 0
    new_today: int = 0


class CategorySyncResult(BaseModel):
    category_id: UUID
    parsed: int
    created: int
    updated: int
    linked: int
