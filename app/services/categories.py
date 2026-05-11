from datetime import datetime, time, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.saved import CategoryJob, SearchCategory
from app.schemas.category import CategoryCreate, CategoryRead, CategorySyncResult
from app.services.scraping import scrape_sources
from app.services.vacancies import mark_saved


def list_categories(db: Session) -> list[CategoryRead]:
    today_start = datetime.combine(datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc)
    categories = list(db.scalars(select(SearchCategory).order_by(SearchCategory.created_at.asc())))
    reads: list[CategoryRead] = []
    for category in categories:
        total = db.scalar(select(func.count()).where(CategoryJob.category_id == category.id)) or 0
        new_today = (
            db.scalar(
                select(func.count()).where(
                    CategoryJob.category_id == category.id,
                    CategoryJob.first_seen_at >= today_start,
                )
            )
            or 0
        )
        reads.append(_read_category(category, total=total, new_today=new_today))
    return reads


def create_category(db: Session, payload: CategoryCreate) -> CategoryRead:
    existing = db.scalar(select(SearchCategory).where(SearchCategory.name == payload.name))
    if existing:
        raise HTTPException(status_code=409, detail="Category with this name already exists")
    category = SearchCategory(
        name=payload.name,
        query=payload.query,
        city=payload.city,
        remote=payload.remote,
        salary_min=payload.salary_min,
        sources=",".join(payload.sources) if payload.sources else None,
    )
    db.add(category)
    db.flush()
    return _read_category(category)


def delete_category(db: Session, category_id: UUID) -> None:
    db.execute(delete(SearchCategory).where(SearchCategory.id == category_id))


def sync_category(db: Session, category_id: UUID, page_limit: int = 1) -> CategorySyncResult:
    category = db.get(SearchCategory, category_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")

    sources = category.sources.split(",") if category.sources else None
    summary = scrape_sources(db, query=category.query, sources=sources, page_limit=page_limit)
    linked = 0
    for job in summary.jobs or []:
        if category.city and category.city.lower() not in (job.city or "").lower():
            continue
        if category.remote is not None and job.remote != category.remote:
            continue
        if category.salary_min is not None and (job.salary_max is None or job.salary_max < category.salary_min):
            continue
        link = db.scalar(
            select(CategoryJob).where(CategoryJob.category_id == category.id, CategoryJob.job_id == job.internal_id)
        )
        if link:
            link.last_seen_at = datetime.now(timezone.utc)
        else:
            db.add(CategoryJob(category_id=category.id, job_id=job.internal_id))
            linked += 1

    category.last_synced_at = datetime.now(timezone.utc)
    db.flush()
    return CategorySyncResult(
        category_id=category.id,
        parsed=summary.parsed,
        created=summary.created,
        updated=summary.updated,
        linked=linked,
    )


def category_jobs(db: Session, category_id: UUID) -> list[Job]:
    if not db.get(SearchCategory, category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    jobs = list(
        db.scalars(
            select(Job)
            .join(CategoryJob, CategoryJob.job_id == Job.internal_id)
            .where(CategoryJob.category_id == category_id)
            .order_by(CategoryJob.first_seen_at.desc())
        )
    )
    mark_saved(db, jobs)
    return jobs


def _read_category(category: SearchCategory, total: int = 0, new_today: int = 0) -> CategoryRead:
    return CategoryRead(
        id=category.id,
        name=category.name,
        query=category.query,
        city=category.city,
        remote=category.remote,
        salary_min=float(category.salary_min) if category.salary_min is not None else None,
        sources=category.sources.split(",") if category.sources else None,
        created_at=category.created_at,
        last_synced_at=category.last_synced_at,
        total=total,
        new_today=new_today,
    )
