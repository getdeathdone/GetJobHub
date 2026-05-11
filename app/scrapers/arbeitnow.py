from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from re import sub

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class ArbeitnowScraper(BaseScraper):
    source = "arbeitnow"
    base_url = "https://www.arbeitnow.com"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        for page in range(1, page_limit + 1):
            response = self.get(f"{self.base_url}/api/job-board-api?page={page}")
            payload = response.json()
            for item in payload.get("data", []):
                title = self.normalize_text(item.get("title"))
                source_url = self.normalize_text(item.get("url") or item.get("slug"))
                if not title or not source_url:
                    continue
                if source_url.startswith("/"):
                    source_url = f"{self.base_url}{source_url}"

                description = self._clean_html(item.get("description") or "")
                company = self.normalize_company(item.get("company_name"))
                tag_text = " ".join(item.get("tags") or [])
                text = f"{title} {company or ''} {description or ''} {tag_text}"
                if query.lower() not in text.lower() and not any(
                    token in text.lower() for token in query.lower().split()
                ):
                    continue

                vacancies.append(
                    VacancyCreate(
                        source=self.source,
                        source_url=source_url,
                        external_id=str(item.get("slug") or item.get("id") or source_url),
                        title=title,
                        company_name=company,
                        city=self.normalize_text(item.get("location")),
                        remote=bool(item.get("remote")),
                        salary_raw=None,
                        salary_min=None,
                        salary_max=None,
                        description=description,
                        description_hash=sha256(description.encode("utf-8")).hexdigest() if description else None,
                        posted_at=self._parse_timestamp(item.get("created_at")),
                    )
                )
        return vacancies

    @staticmethod
    def _clean_html(value: str) -> str | None:
        text = unescape(sub(r"<[^>]+>", " ", value))
        return " ".join(text.split())[:3000] or None

    @staticmethod
    def _parse_timestamp(value: int | str | None) -> datetime:
        try:
            return datetime.fromtimestamp(int(value), tz=timezone.utc)
        except (TypeError, ValueError):
            return datetime.now(timezone.utc)
