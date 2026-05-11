from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from re import sub

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class RemoteOkScraper(BaseScraper):
    source = "remoteok"
    base_url = "https://remoteok.com"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        response = self.get(f"{self.base_url}/api")
        payload = response.json()
        vacancies: list[VacancyCreate] = []
        query_terms = [term.lower() for term in query.split() if term]

        for item in payload[1 : 1 + page_limit * 100]:
            title = self.normalize_text(item.get("position"))
            source_url = self.normalize_text(item.get("url"))
            if not title or not source_url:
                continue

            description = self._clean_html(item.get("description") or "")
            tags = " ".join(item.get("tags") or [])
            text = f"{title} {item.get('company') or ''} {description or ''} {tags}".lower()
            if query_terms and not all(term in text for term in query_terms):
                continue

            salary_min = item.get("salary_min") or None
            salary_max = item.get("salary_max") or None
            salary_raw = None
            if salary_min or salary_max:
                salary_raw = f"{salary_min or 0} - {salary_max or salary_min} USD"

            vacancies.append(
                VacancyCreate(
                    source=self.source,
                    source_url=source_url,
                    external_id=str(item.get("id")) if item.get("id") else None,
                    title=title,
                    company_name=self.normalize_company(item.get("company")),
                    city=self.normalize_text(item.get("location")) or "Remote",
                    remote=True,
                    salary_raw=salary_raw,
                    salary_min=float(salary_min) if salary_min else None,
                    salary_max=float(salary_max) if salary_max else None,
                    description=description,
                    description_hash=sha256(description.encode("utf-8")).hexdigest() if description else None,
                    posted_at=self._parse_date(item.get("date")),
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
