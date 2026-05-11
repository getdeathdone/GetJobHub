from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.job import Job
from app.schemas.vacancy import VacancyCreate
from app.scrapers.registry import get_scrapers
from app.services.matching import job_matches_query, query_variants
from app.services.vacancies import upsert_job


@dataclass
class ScrapeSummary:
    parsed: int = 0
    created: int = 0
    updated: int = 0
    jobs: list[Job] | None = None


def scrape_sources(
    db: Session,
    query: str,
    sources: list[str] | None = None,
    page_limit: int = 1,
) -> ScrapeSummary:
    summary = ScrapeSummary(jobs=[])
    scraped_urls: list[str] = []
    for variant in query_variants(query):
        for scraper in get_scrapers(sources):
            try:
                vacancies = scraper.scrape(query=variant, page_limit=page_limit)
            except Exception:
                continue

            vacancies = [vacancy for vacancy in vacancies if job_matches_query(vacancy, query)]
            summary.parsed += len(vacancies)
            for vacancy in vacancies:
                source_url = str(vacancy.source_url)
                if source_url in scraped_urls:
                    continue
                was_created = upsert_job(db, vacancy)
                summary.created += int(was_created)
                summary.updated += int(not was_created)
                scraped_urls.append(source_url)

    db.flush()
    from app.models.job import Job
    from sqlalchemy import select

    jobs = []
    if scraped_urls:
        jobs = list(db.scalars(select(Job).where(Job.source_url.in_(scraped_urls)).order_by(Job.scraped_at.desc())))
        jobs = [job for job in jobs if job_matches_query(job, query)]
    summary.jobs = jobs
    return summary
