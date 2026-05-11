from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from re import sub

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class RemoteJobsScraper(BaseScraper):
    source = "remotejobs"
    base_url = "https://remotejobs.org"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        for page in range(page_limit):
            offset = page * 50
            response = self.get(f"{self.base_url}/api/v1/jobs?q={query}&limit=50&offset={offset}")
            payload = response.json()
            for item in payload.get("data", []):
                title = self.normalize_text(item.get("title"))
                source_url = self.normalize_text(item.get("apply_url") or item.get("url"))
                if not title or not source_url:
                    continue

                company = item.get("company") or {}
                description = self._clean_html(item.get("description") or "")
                vacancies.append(
                    VacancyCreate(
                        source=self.source,
                        source_url=source_url,
                        external_id=str(item.get("id")) if item.get("id") else None,
                        title=title,
                        company_name=self.normalize_company(company.get("name")),
                        city=self.normalize_text(item.get("location")) or "Remote",
                        remote=True,
                        salary_raw=self.normalize_text(item.get("salary_text")),
                        salary_min=float(item.get("salary_min")) if item.get("salary_min") else None,
                        salary_max=float(item.get("salary_max")) if item.get("salary_max") else None,
                        description=description,
                        description_hash=sha256(description.encode("utf-8")).hexdigest() if description else None,
                        posted_at=self._parse_date(item.get("posted_at")),
                    )
                )
        return vacancies

    @staticmethod
    def _clean_html(value: str) -> str | None:
        text = unescape(sub(r"<[^>]+>", " ", value))
        return " ".join(text.split())[:3000] or None

    @staticmethod
    def _parse_date(value: str | None) -> datetime:
        if value:
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now(timezone.utc)
