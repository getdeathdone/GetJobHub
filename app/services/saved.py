from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.saved import SavedJob
from app.schemas.saved import SaveJobRequest, SavedJobRead
from app.services.vacancies import mark_saved


def list_saved_jobs(db: Session) -> list[SavedJobRead]:
    rows = db.execute(
        select(SavedJob, Job).join(Job, Job.internal_id == SavedJob.job_id).order_by(SavedJob.saved_at.desc())
    ).all()
    jobs = [job for _, job in rows]
    mark_saved(db, jobs)
    return [
        SavedJobRead(id=saved.id, saved_at=saved.saved_at, notes=saved.notes, job=job)
        for saved, job in rows
    ]


def save_job(db: Session, job_id: UUID, payload: SaveJobRequest) -> SavedJob:
    job = db.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Vacancy not found")

    saved = db.scalar(select(SavedJob).where(SavedJob.job_id == job_id))
    if saved:
        saved.notes = payload.notes
        return saved

    saved = SavedJob(job_id=job_id, notes=payload.notes)
    db.add(saved)
    db.flush()
    return saved


def unsave_job(db: Session, job_id: UUID) -> None:
    db.execute(delete(SavedJob).where(SavedJob.job_id == job_id))
