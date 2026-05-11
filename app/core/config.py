from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = Field(default="sqlite:///./getjobhub.db", alias="DATABASE_URL")
    request_timeout_seconds: int = Field(default=15, alias="REQUEST_TIMEOUT_SECONDS")
    workua_base_url: str = Field(default="https://www.work.ua", alias="WORKUA_BASE_URL")
    celery_broker_url: str = Field(default="redis://localhost:6379/0", alias="CELERY_BROKER_URL")
    celery_result_backend: str = Field(
        default="redis://localhost:6379/1",
        alias="CELERY_RESULT_BACKEND",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
