from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from re import sub

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class RemotiveScraper(BaseScraper):
    source = "remotive"
    base_url = "https://remotive.com"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        response = self.get(f"{self.base_url}/api/remote-jobs?search={query}")
        payload = response.json()
        vacancies: list[VacancyCreate] = []

        for item in payload.get("jobs", [])[: page_limit * 50]:
            title = self.normalize_text(item.get("title"))
            source_url = self.normalize_text(item.get("url"))
            if not title or not source_url:
                continue

            description = self._clean_html(item.get("description") or "")
            company = self.normalize_company(item.get("company_name"))
            vacancies.append(
                VacancyCreate(
                    source=self.source,
                    source_url=source_url,
                    external_id=str(item.get("id")) if item.get("id") else None,
                    title=title,
                    company_name=company,
                    city=self.normalize_text(item.get("candidate_required_location")) or "Remote",
                    remote=True,
                    salary_raw=self.normalize_text(item.get("salary")),
                    salary_min=None,
                    salary_max=None,
                    description=description,
                    description_hash=sha256(description.encode("utf-8")).hexdigest() if description else None,
                    posted_at=self._parse_date(item.get("publication_date")),
                )
            )

        return vacancies

    @staticmethod
    def _clean_html(value: str) -> str | None:
        text = unescape(sub(r"<[^>]+>", " ", value))
        return " ".join(text.split())[:3000] or None

    @staticmethod
    def _parse_date(value: str | None) -> datetime:
        if not value:
            return datetime.now(timezone.utc)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.now(timezone.utc)
