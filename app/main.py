from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import app.models  # noqa: F401
from app.api.v1.router import api_router
from app.core.database import Base, engine

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="GetJobHub API", version="0.1.0")
    app.include_router(api_router, prefix="/api/v1")
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def dashboard() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.on_event("startup")
    def create_tables() -> None:
        Base.metadata.create_all(bind=engine)

    return app


app = create_app()
