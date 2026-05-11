from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.saved import SaveJobRequest, SavedJobRead
from app.services.saved import list_saved_jobs, save_job, unsave_job

router = APIRouter()


@router.get("", response_model=list[SavedJobRead])
def saved_jobs(db: Annotated[Session, Depends(get_db)]) -> list[SavedJobRead]:
    return list_saved_jobs(db)


@router.post("/{job_id}", response_model=dict[str, str])
def save(job_id: UUID, payload: SaveJobRequest, db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    save_job(db, job_id, payload)
    db.commit()
    return {"status": "saved"}


@router.delete("/{job_id}", status_code=204)
def unsave(job_id: UUID, db: Annotated[Session, Depends(get_db)]) -> Response:
    unsave_job(db, job_id)
    db.commit()
    return Response(status_code=204)
