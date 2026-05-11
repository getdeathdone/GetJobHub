from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.job import Job
from app.models.saved import CategoryJob, SavedJob, SearchCategory
from app.schemas.stats import CategoryStats, SalaryRangeStats, SourceStats, StatsRead


def get_stats(db: Session) -> StatsRead:
    today_start = datetime.combine(datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc)

    total = db.scalar(select(func.count()).select_from(Job)) or 0
    saved_total = db.scalar(select(func.count()).select_from(SavedJob)) or 0
    rows = db.execute(
        select(
            Job.source,
            func.count(Job.internal_id),
            func.count(Job.internal_id).filter(Job.scraped_at >= today_start),
        ).group_by(Job.source)
    ).all()

    salary_ranges = [
        SalaryRangeStats(label="No salary", count=_count_salary(db, None, None, no_salary=True)),
        SalaryRangeStats(label="0-2000", count=_count_salary(db, 0, 2000)),
        SalaryRangeStats(label="2000-4000", count=_count_salary(db, 2000, 4000)),
        SalaryRangeStats(label="4000+", count=_count_salary(db, 4000, None)),
    ]

    categories = []
    for category in db.scalars(select(SearchCategory).order_by(SearchCategory.created_at.asc())):
        category_total = db.scalar(select(func.count()).where(CategoryJob.category_id == category.id)) or 0
        category_today = (
            db.scalar(
                select(func.count()).where(
                    CategoryJob.category_id == category.id,
                    CategoryJob.first_seen_at >= today_start,
                )
            )
            or 0
        )
        categories.append(
            CategoryStats(
                id=str(category.id),
                name=category.name,
                total=category_total,
                new_today=category_today,
            )
        )

    return StatsRead(
        total=total,
        saved_total=saved_total,
        by_source=[
            SourceStats(source=source, total=source_total, today=today_total)
            for source, source_total, today_total in rows
        ],
        salary_ranges=salary_ranges,
        categories=categories,
    )


def _count_salary(
    db: Session,
    minimum: int | None,
    maximum: int | None,
    no_salary: bool = False,
) -> int:
    statement = select(func.count()).select_from(Job)
    if no_salary:
        return db.scalar(statement.where(Job.salary_max.is_(None))) or 0
    if minimum is not None:
        statement = statement.where(Job.salary_max >= minimum)
    if maximum is not None:
        statement = statement.where(Job.salary_max < maximum)
    return db.scalar(statement) or 0
