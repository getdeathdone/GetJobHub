from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.category import CategoryCreate, CategoryRead, CategorySyncResult
from app.schemas.vacancy import VacancyRead
from app.services.categories import (
    category_jobs,
    create_category,
    delete_category,
    list_categories,
    sync_category,
)

router = APIRouter()


@router.get("", response_model=list[CategoryRead])
def categories(db: Annotated[Session, Depends(get_db)]) -> list[CategoryRead]:
    return list_categories(db)


@router.post("", response_model=CategoryRead, status_code=201)
def create(payload: CategoryCreate, db: Annotated[Session, Depends(get_db)]) -> CategoryRead:
    category = create_category(db, payload)
    db.commit()
    return category


@router.delete("/{category_id}", status_code=204)
def delete(category_id: UUID, db: Annotated[Session, Depends(get_db)]) -> Response:
    delete_category(db, category_id)
    db.commit()
    return Response(status_code=204)


@router.post("/{category_id}/sync", response_model=CategorySyncResult)
def sync(
    category_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    page_limit: Annotated[int, Query(ge=1, le=5)] = 1,
) -> CategorySyncResult:
    result = sync_category(db, category_id, page_limit=page_limit)
    db.commit()
    return result


@router.get("/{category_id}/vacancies", response_model=list[VacancyRead])
def vacancies(category_id: UUID, db: Annotated[Session, Depends(get_db)]) -> list[VacancyRead]:
    return category_jobs(db, category_id)
