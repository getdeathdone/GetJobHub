from abc import ABC, abstractmethod
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from random import uniform
from time import sleep

import requests

from app.schemas.vacancy import VacancyCreate


class CircuitOpenError(RuntimeError):
    pass


@dataclass
class CircuitBreaker:
    failure_threshold: int = 10
    cooldown: timedelta = timedelta(hours=1)
    failure_count: int = 0
    opened_until: datetime | None = None

    def guard(self) -> None:
        if self.opened_until and datetime.now(timezone.utc) < self.opened_until:
            raise CircuitOpenError(f"Circuit is open until {self.opened_until.isoformat()}")

    def record_success(self) -> None:
        self.failure_count = 0
        self.opened_until = None

    def record_failure(self) -> None:
        self.failure_count += 1
        if self.failure_count >= self.failure_threshold:
            self.opened_until = datetime.now(timezone.utc) + self.cooldown


class BaseScraper(ABC):
    source: str
    default_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        ),
    }

    def __init__(self, timeout_seconds: int = 15) -> None:
        self.timeout_seconds = timeout_seconds
        self.session = requests.Session()
        self.circuit_breaker = CircuitBreaker()

    @abstractmethod
    def scrape(self, *args: object, **kwargs: object) -> list[VacancyCreate]:
        raise NotImplementedError

    def get(self, url: str, referer: str | None = None) -> requests.Response:
        self.circuit_breaker.guard()
        headers = dict(self.default_headers)
        if referer:
            headers["Referer"] = referer

        sleep(uniform(1.5, 4.0))
        try:
            response = self.session.get(url, headers=headers, timeout=self.timeout_seconds)
        except requests.RequestException:
            self.circuit_breaker.record_failure()
            raise

        if response.status_code in {403, 429, 500, 502, 503, 504}:
            self.circuit_breaker.record_failure()
        else:
            self.circuit_breaker.record_success()

        response.raise_for_status()
        return response

    @staticmethod
    def normalize_text(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.split())
        return normalized or None

    @staticmethod
    def normalize_company(value: str | None) -> str | None:
        normalized = BaseScraper.normalize_text(value)
        return normalized.title() if normalized else None

    @staticmethod
    def first_text(values: Iterable[str | None]) -> str | None:
        for value in values:
            normalized = BaseScraper.normalize_text(value)
            if normalized:
                return normalized
        return None
