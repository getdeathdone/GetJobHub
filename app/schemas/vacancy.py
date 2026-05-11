from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class VacancyBase(BaseModel):
    source: str = Field(max_length=32)
    source_url: str
    external_id: str | None = None
    title: str
    company_name: str | None = None
    city: str | None = None
    remote: bool = False
    salary_raw: str | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    description: str | None = None
    description_hash: str | None = None
    posted_at: datetime | None = None


class VacancyCreate(VacancyBase):
    source_url: HttpUrl


class VacancyRead(VacancyBase):
    model_config = ConfigDict(from_attributes=True)

    internal_id: UUID
    scraped_at: datetime
    updated_at: datetime
    is_saved: bool = False
