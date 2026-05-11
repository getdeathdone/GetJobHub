from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from urllib.parse import urlencode, urljoin
from xml.etree import ElementTree

from bs4 import BeautifulSoup, Tag

from app.schemas.vacancy import VacancyCreate
from app.scrapers.base import BaseScraper


class DouScraper(BaseScraper):
    source = "dou"
    base_url = "https://jobs.dou.ua"

    def scrape(self, query: str = "python", page_limit: int = 1) -> list[VacancyCreate]:
        vacancies = self._scrape_rss(query)
        if vacancies:
            return vacancies
        return self._scrape_html(query=query, page_limit=page_limit)

    def _scrape_rss(self, query: str) -> list[VacancyCreate]:
        url = f"{self.base_url}/vacancies/feeds/?{urlencode({'search': query})}"
        response = self.get(url)
        try:
            root = ElementTree.fromstring(response.content)
        except ElementTree.ParseError:
            return []

        vacancies: list[VacancyCreate] = []
        for item in root.findall(".//item"):
            title = self.normalize_text(item.findtext("title"))
            link = self.normalize_text(item.findtext("link"))
            description = self.normalize_text(item.findtext("description"))
            if not title or not link:
                continue
            posted_at = self._parse_date(item.findtext("pubDate"))
            company = self._extract_company(title)
            clean_title = title.split(" в ", 1)[0].split(" at ", 1)[0]
            vacancies.append(self._vacancy(clean_title, link, company, description, posted_at))
        return vacancies

    def _scrape_html(self, query: str, page_limit: int) -> list[VacancyCreate]:
        vacancies: list[VacancyCreate] = []
        for _ in range(page_limit):
            url = f"{self.base_url}/vacancies/?{urlencode({'search': query})}"
            soup = BeautifulSoup(self.get(url).text, "html.parser")
            for card in soup.select("li.l-vacancy, div.vacancy, article"):
                vacancy = self._parse_card(card)
                if vacancy:
                    vacancies.append(vacancy)
            break
        return vacancies

    def _parse_card(self, card: Tag) -> VacancyCreate | None:
        anchor = card.select_one("a.vt, a[href*='/vacancies/']")
        if not anchor or not anchor.get("href"):
            return None
        title = self.normalize_text(anchor.get_text(" ", strip=True))
        if not title:
            return None
        company = self.first_text(
            [
                self._select_text(card, "a.company"),
                self._select_text(card, ".company"),
                self._select_text(card, ".sh-info"),
            ]
        )
        description = self._select_text(card, ".sh-info, .text, p")
        return self._vacancy(title, urljoin(self.base_url, str(anchor["href"])), company, description)

    def _vacancy(
        self,
        title: str,
        source_url: str,
        company: str | None,
        description: str | None,
        posted_at: datetime | None = None,
    ) -> VacancyCreate:
        description_hash = sha256(description.encode("utf-8")).hexdigest() if description else None
        text = f"{title} {company or ''} {description or ''}"
        return VacancyCreate(
            source=self.source,
            source_url=source_url,
            external_id=source_url.rstrip("/").split("/")[-1],
            title=title,
            company_name=self.normalize_company(company),
            city=self._extract_city(text),
            remote=self._is_remote(text),
            salary_raw=None,
            salary_min=None,
            salary_max=None,
            description=description,
            description_hash=description_hash,
            posted_at=posted_at or datetime.now(timezone.utc),
        )

    @staticmethod
    def _select_text(card: Tag, selector: str) -> str | None:
        element = card.select_one(selector)
        return element.get_text(" ", strip=True) if element else None

    @staticmethod
    def _parse_date(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _extract_company(title: str) -> str | None:
        for splitter in (" в ", " at ", " у "):
            if splitter in title:
                return title.rsplit(splitter, 1)[-1]
        return None

    @staticmethod
    def _extract_city(text: str) -> str | None:
        for city in ("Kyiv", "Київ", "Lviv", "Львів", "Dnipro", "Дніпро", "Remote"):
            if city.lower() in text.lower():
                return city
        return None

    @staticmethod
    def _is_remote(text: str) -> bool:
        return any(token in text.lower() for token in ("remote", "віддалено", "remotely"))
