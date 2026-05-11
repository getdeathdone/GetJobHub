from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.scrapers.workua import WorkUaScraper
from app.services.vacancies import upsert_job


@celery_app.task(name="scrape.workua")
def scrape_workua_task(
    query: str = "python",
    city_slug: str | None = None,
    page_limit: int = 1,
) -> dict[str, int | str]:
    db = SessionLocal()
    try:
        scraper = WorkUaScraper()
        parsed = scraper.scrape(query=query, city_slug=city_slug, page_limit=page_limit)

        created = 0
        updated = 0
        for item in parsed:
            was_created = upsert_job(db, item)
            created += int(was_created)
            updated += int(not was_created)

        db.commit()
        return {"source": "workua", "parsed": len(parsed), "created": created, "updated": updated}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

