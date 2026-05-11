import logging
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.stats import StatsRead
from app.services.stats import get_stats

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=StatsRead)
def stats(db: Annotated[Session, Depends(get_db)]) -> StatsRead:
    logger.info("Fetching system statistics")
    results = get_stats(db)
    logger.info("Successfully fetched statistics")
    return results

