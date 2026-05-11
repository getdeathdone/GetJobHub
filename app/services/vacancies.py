from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.saved import SavedJob
from app.schemas.vacancy import VacancyCreate
from app.services.matching import job_matches_query


def search_vacancies(
    db: Session,
    q: str | None = None,
    city: str | None = None,
    remote: bool | None = None,
    sources: list[str] | None = None,
    salary_min: float | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[Job]:
    statement: Select[tuple[Job]] = select(Job).order_by(Job.posted_at.desc().nullslast())

    if city:
        statement = statement.where(Job.city.ilike(f"%{city}%"))
    if remote is not None:
        statement = statement.where(Job.remote.is_(remote))
    if sources:
        statement = statement.where(Job.source.in_(sources))
    if salary_min is not None:
        statement = statement.where(Job.salary_max >= salary_min)

    if q:
        candidates = list(db.scalars(statement.limit(2000)))
        jobs = [job for job in candidates if job_matches_query(job, q)][offset : offset + limit]
    else:
        jobs = list(db.scalars(statement.limit(limit).offset(offset)))

    mark_saved(db, jobs)
    return jobs


def upsert_job(db: Session, vacancy: VacancyCreate) -> bool:
    existing = db.scalar(select(Job).where(Job.source_url == str(vacancy.source_url)))
    values = vacancy.model_dump()
    values["source_url"] = str(vacancy.source_url)

    if existing is None:
        db.add(Job(**values))
        return True

    for field, value in values.items():
        setattr(existing, field, value)
    return False


def mark_saved(db: Session, jobs: list[Job]) -> None:
    if not jobs:
        return
    ids = [job.internal_id for job in jobs]
    saved_ids = set(db.scalars(select(SavedJob.job_id).where(SavedJob.job_id.in_(ids))))
    for job in jobs:
        setattr(job, "is_saved", job.internal_id in saved_ids)


def get_job(db: Session, job_id: UUID) -> Job | None:
    job = db.get(Job, job_id)
    if job:
        mark_saved(db, [job])
    return job
