from datetime import datetime, timezone
from hashlib import sha256
from re import search, sub
from urllib.parse import quote, urljoin

from bs4 import BeautifulSoup, Tag

from app.core.config import get_settings
from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class WorkUaScraper(BaseScraper):
    source = "workua"

    def __init__(self, timeout_seconds: int | None = None) -> None:
        settings = get_settings()
        super().__init__(timeout_seconds=timeout_seconds or settings.request_timeout_seconds)
        self.base_url = settings.workua_base_url.rstrip("/")

    def scrape(
        self,
        query: str = "python",
        city_slug: str | None = None,
        page_limit: int = 1,
    ) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        referer: str | None = None

        for page in range(1, page_limit + 1):
            url = self._build_search_url(query=query, city_slug=city_slug, page=page)
            response = self.get(url, referer=referer)
            referer = url
            soup = BeautifulSoup(response.text, "html.parser")
            cards = soup.select("div.card.card-hover, div.job-link, article, div[class*='job']")

            if not cards:
                break

            for card in cards:
                vacancy = self._parse_card(card)
                if vacancy:
                    vacancies.append(vacancy)

        return vacancies

    def _build_search_url(self, query: str, city_slug: str | None, page: int) -> str:
        location = f"/jobs-{city_slug}-" if city_slug else "/jobs-"
        slug = quote("+".join(query.split()))
        url = f"{self.base_url}{location}{slug}/"
        if page > 1:
            url = f"{url}?page={page}"
        return url

    def _parse_card(self, card: Tag) -> VacancyCreate | None:
        title_anchor = card.select_one("h2 a, h3 a, a[href*='/jobs/']")
        if not title_anchor or not title_anchor.get("href"):
            return None

        title = self.normalize_text(title_anchor.get_text(" ", strip=True))
        if not title:
            return None

        source_url = urljoin(self.base_url, str(title_anchor["href"]))
        external_id = self._extract_external_id(source_url)
        company = self.first_text(
            [
                self._select_text(card, "span.strong-600"),
                self._select_text(card, "div.add-top-xs span"),
                self._select_text(card, "[class*='company']"),
            ]
        )
        meta_text = self.normalize_text(card.get_text(" ", strip=True)) or ""
        salary_raw = self._extract_salary(meta_text)
        salary_min, salary_max = self._parse_salary_range(salary_raw)
        description = self._select_text(card, "p, div.overflow")
        description_hash = sha256(description.encode("utf-8")).hexdigest() if description else None

        return VacancyCreate(
            source=self.source,
            source_url=source_url,
            external_id=external_id,
            title=title,
            company_name=self.normalize_company(company),
            city=self._extract_city(meta_text),
            remote=self._is_remote(meta_text),
            salary_raw=salary_raw,
            salary_min=salary_min,
            salary_max=salary_max,
            description=description,
            description_hash=description_hash,
            posted_at=datetime.now(timezone.utc),
        )

    @staticmethod
    def _select_text(card: Tag, selector: str) -> str | None:
        element = card.select_one(selector)
        return element.get_text(" ", strip=True) if element else None

    @staticmethod
    def _extract_external_id(source_url: str) -> str | None:
        match = search(r"/jobs/(\d+)", source_url)
        return match.group(1) if match else None

    @staticmethod
    def _extract_salary(text: str) -> str | None:
        match = search(r"(\d[\d\s]*(?:–|-|—)?\s*\d*[\d\s]*\s*(?:грн|₴|\$|USD|EUR))", text)
        return " ".join(match.group(1).split()) if match else None

    @staticmethod
    def _parse_salary_range(salary_raw: str | None) -> tuple[float | None, float | None]:
        if not salary_raw:
            return None, None

        match = search(r"([\d\s]+)(?:\D+([\d\s]+))?", salary_raw)
        if not match:
            return None, None

        numbers = [float(sub(r"\D", "", part)) for part in match.groups() if part]
        if not numbers:
            return None, None
        if len(numbers) == 1:
            return numbers[0], numbers[0]
        return min(numbers), max(numbers)

    @staticmethod
    def _extract_city(text: str) -> str | None:
        for city in ("Київ", "Львів", "Дніпро", "Одеса", "Харків", "Вінниця", "Remote"):
            if city.lower() in text.lower():
                return city
        return None

    @staticmethod
    def _is_remote(text: str) -> bool:
        lowered = text.lower()
        return any(token in lowered for token in ("віддалено", "remote", "дистанційно"))
