from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.schemas.vacancy import VacancyRead


class SaveJobRequest(BaseModel):
    notes: str | None = None


class SavedJobRead(BaseModel):
    id: UUID
    saved_at: datetime
    notes: str | None = None
    job: VacancyRead
