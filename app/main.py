import mimetypes
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")

import app.models  # noqa: F401
from app.api.v1.router import api_router
from app.core.database import Base, engine

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="GetJobHub API", version="0.1.0")
    app.include_router(api_router, prefix="/api/v1")

    # Ensure STATIC_DIR exists and is used correctly
    print(f"Static directory: {STATIC_DIR}")
    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    else:
        print(f"WARNING: Static directory not found at {STATIC_DIR}")

    @app.get("/", include_in_schema=False)
    def dashboard() -> FileResponse:
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return {"error": "index.html not found", "path": str(index_path)}

    @app.on_event("startup")
    def create_tables() -> None:
        Base.metadata.create_all(bind=engine)

    return app


app = create_app()
