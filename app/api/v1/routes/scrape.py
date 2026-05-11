from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.scrape import ScrapeResult, TaskAccepted
from app.scrapers.workua import WorkUaScraper
from app.services.scraping import scrape_sources
from app.services.vacancies import upsert_job
from app.tasks.scrape import scrape_workua_task

router = APIRouter()


@router.post("/workua", response_model=ScrapeResult)
def scrape_workua(
    db: Annotated[Session, Depends(get_db)],
    q: str = "python",
    city_slug: str | None = None,
    page_limit: Annotated[int, Query(ge=1, le=10)] = 1,
) -> ScrapeResult:
    scraper = WorkUaScraper()
    parsed = scraper.scrape(query=q, city_slug=city_slug, page_limit=page_limit)

    created = 0
    updated = 0
    for item in parsed:
        was_created = upsert_job(db, item)
        created += int(was_created)
        updated += int(not was_created)

    db.commit()
    return ScrapeResult(source="workua", parsed=len(parsed), created=created, updated=updated)


@router.post("/all", response_model=ScrapeResult)
def scrape_all_sources(
    db: Annotated[Session, Depends(get_db)],
    q: str = "python",
    source: Annotated[list[str] | None, Query()] = None,
    page_limit: Annotated[int, Query(ge=1, le=5)] = 1,
) -> ScrapeResult:
    summary = scrape_sources(db=db, query=q, sources=source, page_limit=page_limit)
    db.commit()
    return ScrapeResult(
        source=",".join(source or ["workua", "dou", "djinni"]),
        parsed=summary.parsed,
        created=summary.created,
        updated=summary.updated,
    )


@router.post("/workua/enqueue", response_model=TaskAccepted)
def enqueue_workua_scrape(
    q: str = "python",
    city_slug: str | None = None,
    page_limit: Annotated[int, Query(ge=1, le=10)] = 1,
) -> TaskAccepted:
    task = scrape_workua_task.delay(query=q, city_slug=city_slug, page_limit=page_limit)
    return TaskAccepted(task_id=task.id, status="queued")
