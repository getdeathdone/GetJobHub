import logging
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.saved import SaveJobRequest, SavedJobRead
from app.services.saved import list_saved_jobs, save_job, unsave_job

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=list[SavedJobRead])
def saved_jobs(db: Annotated[Session, Depends(get_db)]) -> list[SavedJobRead]:
    logger.info("Fetching all saved jobs")
    results = list_saved_jobs(db)
    logger.info(f"Found {len(results)} saved jobs")
    return results


@router.post("/{job_id}", response_model=dict[str, str])
def save(job_id: UUID, payload: SaveJobRequest, db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    logger.info(f"Saving job with ID: {job_id}")
    save_job(db, job_id, payload)
    db.commit()
    logger.info(f"Successfully saved job with ID: {job_id}")
    return {"status": "saved"}


@router.delete("/{job_id}", status_code=204)
def unsave(job_id: UUID, db: Annotated[Session, Depends(get_db)]) -> Response:
    logger.info(f"Unsaving job with ID: {job_id}")
    unsave_job(db, job_id)
    db.commit()
    logger.info(f"Successfully unsaved job with ID: {job_id}")
    return Response(status_code=204)
