from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.vacancy import VacancyRead
from app.services.vacancies import search_vacancies

router = APIRouter()


@router.get("/search", response_model=list[VacancyRead])
def search(
    db: Annotated[Session, Depends(get_db)],
    q: str | None = None,
    city: str | None = None,
    remote: bool | None = None,
    source: Annotated[list[str] | None, Query()] = None,
    salary_min: float | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[VacancyRead]:
    return search_vacancies(
        db=db,
        q=q,
        city=city,
        remote=remote,
        sources=source,
        salary_min=salary_min,
        limit=limit,
        offset=offset,
    )

