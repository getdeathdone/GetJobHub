from datetime import datetime, timezone
from hashlib import sha256
from re import search, sub
from urllib.parse import quote, urlencode, urljoin

from bs4 import BeautifulSoup, Tag

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class DjinniScraper(BaseScraper):
    source = "djinni"
    base_url = "https://djinni.co"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        for page in range(1, page_limit + 1):
            slug = quote("-".join(query.lower().split()))
            url = f"{self.base_url}/jobs/keyword-{slug}/?{urlencode({'page': page})}"
            soup = BeautifulSoup(self.get(url).text, "html.parser")
            anchors = soup.select("a[href^='/jobs/']")
            if not anchors:
                break
            seen: set[str] = set()
            for anchor in anchors:
                href = str(anchor.get("href", ""))
                if href in seen or not search(r"^/jobs/\d+", href):
                    continue
                seen.add(href)
                vacancy = self._parse_anchor(anchor)
                if vacancy and self._matches_query(vacancy, query):
                    vacancies.append(vacancy)
        return vacancies

    def _parse_anchor(self, anchor: Tag) -> VacancyCreate | None:
        title = self.normalize_text(anchor.get_text(" ", strip=True))
        if not title or title.lower() in {"jobs", "hire talent"}:
            return None

        source_url = urljoin(self.base_url, str(anchor["href"]))
        card = anchor.find_parent(["li", "article", "div"]) or anchor
        text = self.normalize_text(card.get_text(" ", strip=True)) or ""
        description = self._select_text(card, ".js-truncated-text, .job-list-item__description, p")
        salary_raw = self._extract_salary(text)
        salary_min, salary_max = self._parse_salary_range(salary_raw)
        description_hash = sha256(description.encode("utf-8")).hexdigest() if description else None

        return VacancyCreate(
            source=self.source,
            source_url=source_url,
            external_id=source_url.rstrip("/").split("/")[-1],
            title=title,
            company_name=self._extract_company(text),
            city=self._extract_city(text),
            remote=self._is_remote(text),
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
    def _extract_salary(text: str) -> str | None:
        match = search(r"(\$?\d[\d\s]*(?:–|-|—)?\s*\$?\d*[\d\s]*\s*(?:USD|EUR|\$|€)?)", text)
        return " ".join(match.group(1).split()) if match else None

    @staticmethod
    def _parse_salary_range(salary_raw: str | None) -> tuple[float | None, float | None]:
        if not salary_raw:
            return None, None
        numbers = [float(value) for value in sub(r"[^\d\s-]", "", salary_raw).replace("-", " ").split()]
        if not numbers:
            return None, None
        return min(numbers), max(numbers)

    @staticmethod
    def _extract_company(text: str) -> str | None:
        match = search(r"Company:\s*([^,]+)", text)
        return match.group(1).strip() if match else None

    @staticmethod
    def _extract_city(text: str) -> str | None:
        for city in ("Kyiv", "Київ", "Lviv", "Львів", "Remote", "Europe", "Worldwide"):
            if city.lower() in text.lower():
                return city
        return None

    @staticmethod
    def _is_remote(text: str) -> bool:
        return any(token in text.lower() for token in ("remote", "remotely", "віддалено"))

    @staticmethod
    def _matches_query(vacancy: VacancyCreate, query: str) -> bool:
        tokens = [token.lower() for token in query.split() if len(token) > 2]
        if not tokens:
            return True
        haystack = f"{vacancy.title} {vacancy.description or ''}".lower()
        return any(token in haystack for token in tokens)
