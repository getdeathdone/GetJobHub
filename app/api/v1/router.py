from fastapi import APIRouter

from app.api.v1.routes import categories, saved, scrape, stats, vacancies

api_router = APIRouter()
api_router.include_router(vacancies.router, prefix="/vacancies", tags=["vacancies"])
api_router.include_router(stats.router, prefix="/stats", tags=["stats"])
api_router.include_router(scrape.router, prefix="/scrape", tags=["scrape"])
api_router.include_router(saved.router, prefix="/saved", tags=["saved"])
api_router.include_router(categories.router, prefix="/categories", tags=["categories"])
