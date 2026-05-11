import mimetypes
from pathlib import Path

import logging
import time

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/javascript", ".js")

import app.models  # noqa: F401
from app.api.v1.router import api_router
from app.core.database import Base, engine

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="GetJobHub API", version="0.1.0")

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start_time = time.time()
        response = await call_next(request)
        process_time = (time.time() - start_time) * 1000
        formatted_process_time = "{0:.2f}ms".format(process_time)
        logger.info(
            f"RID: {request.scope.get('root_path')} - {request.method} {request.url.path} - Status: {response.status_code} - Completed in {formatted_process_time}"
        )
        return response

    app.include_router(api_router, prefix="/api/v1")

    # Ensure STATIC_DIR exists and is used correctly
    logger.info(f"Static directory: {STATIC_DIR}")
    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
    else:
        logger.warning(f"Static directory not found at {STATIC_DIR}")

    @app.get("/", include_in_schema=False)
    def dashboard() -> FileResponse:
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        return {"error": "index.html not found", "path": str(index_path)}

    @app.on_event("startup")
    def on_startup() -> None:
        logger.info("Application starting up...")
        try:
            logger.info("Initializing database tables...")
            Base.metadata.create_all(bind=engine)
            logger.info("Database initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}", exc_info=True)
            # In a worker environment, we might want to continue even if DB fails 
            # to at least serve some routes or meaningful errors.

        logger.info("Registered routes:")
        for route in app.routes:
            methods = getattr(route, 'methods', 'N/A')
            logger.info(f"Route: {route.path} - Methods: {methods}")

    return app


app = create_app()
