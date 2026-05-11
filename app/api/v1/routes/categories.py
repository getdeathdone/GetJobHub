import logging
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

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=list[CategoryRead])
def categories(db: Annotated[Session, Depends(get_db)]) -> list[CategoryRead]:
    logger.info("Fetching all categories")
    results = list_categories(db)
    logger.info(f"Found {len(results)} categories")
    return results


@router.post("", response_model=CategoryRead, status_code=201)
def create(payload: CategoryCreate, db: Annotated[Session, Depends(get_db)]) -> CategoryRead:
    logger.info(f"Creating category: {payload.name}")
    category = create_category(db, payload)
    db.commit()
    logger.info(f"Created category with ID: {category.id}")
    return category


@router.delete("/{category_id}", status_code=204)
def delete(category_id: UUID, db: Annotated[Session, Depends(get_db)]) -> Response:
    logger.info(f"Deleting category with ID: {category_id}")
    delete_category(db, category_id)
    db.commit()
    logger.info(f"Deleted category with ID: {category_id}")
    return Response(status_code=204)


@router.post("/{category_id}/sync", response_model=CategorySyncResult)
def sync(
    category_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    page_limit: Annotated[int, Query(ge=1, le=5)] = 1,
) -> CategorySyncResult:
    logger.info(f"Syncing category ID: {category_id} with page_limit: {page_limit}")
    result = sync_category(db, category_id, page_limit=page_limit)
    db.commit()
    logger.info(f"Synced category ID: {category_id}. Result: {result.status}")
    return result


@router.get("/{category_id}/vacancies", response_model=list[VacancyRead])
def vacancies(category_id: UUID, db: Annotated[Session, Depends(get_db)]) -> list[VacancyRead]:
    logger.info(f"Fetching vacancies for category ID: {category_id}")
    results = category_jobs(db, category_id)
    logger.info(f"Found {len(results)} vacancies for category ID: {category_id}")
    return results
