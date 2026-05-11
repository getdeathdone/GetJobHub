from datetime import datetime, timezone
from hashlib import sha256
from html import unescape
from re import sub

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class HimalayasScraper(BaseScraper):
    source = "himalayas"
    base_url = "https://himalayas.app"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        for page in range(1, page_limit + 1):
            response = self.get(f"{self.base_url}/jobs/api/search?q={query}&page={page}")
            payload = response.json()
            for item in payload.get("jobs", []):
                title = self.normalize_text(item.get("title"))
                source_url = self.normalize_text(item.get("applicationLink"))
                if not title or not source_url:
                    continue

                description = self._clean_html(item.get("description") or item.get("excerpt") or "")
                min_salary = item.get("minSalary")
                max_salary = item.get("maxSalary")
                currency = item.get("currency") or "USD"
                salary_raw = None
                if min_salary or max_salary:
                    salary_raw = f"{currency} {min_salary or 0} - {max_salary or min_salary}"

                location_restrictions = item.get("locationRestrictions") or []
                city = "Worldwide" if not location_restrictions else ", ".join(
                    location.get("name", "") for location in location_restrictions if location.get("name")
                )

                vacancies.append(
                    VacancyCreate(
                        source=self.source,
                        source_url=source_url,
                        external_id=str(item.get("guid")) if item.get("guid") else None,
                        title=title,
                        company_name=self.normalize_company(item.get("companyName")),
                        city=city or "Remote",
                        remote=True,
                        salary_raw=salary_raw,
                        salary_min=float(min_salary) if min_salary else None,
                        salary_max=float(max_salary) if max_salary else None,
                        description=description,
                        description_hash=sha256(description.encode("utf-8")).hexdigest() if description else None,
                        posted_at=self._parse_date(item.get("pubDate")),
                    )
                )
        return vacancies

    @staticmethod
    def _clean_html(value: str) -> str | None:
        text = unescape(sub(r"<[^>]+>", " ", value))
        return " ".join(text.split())[:3000] or None

    @staticmethod
    def _parse_date(value: int | str | None) -> datetime:
        if isinstance(value, int):
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        if isinstance(value, str):
            try:
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.now(timezone.utc)
