from app.scrapers.base import BaseScraper
from app.scrapers.arbeitnow import ArbeitnowScraper
from app.scrapers.djinni import DjinniScraper
from app.scrapers.dou import DouScraper
from app.scrapers.himalayas import HimalayasScraper
from app.scrapers.remoteok import RemoteOkScraper
from app.scrapers.remotejobs import RemoteJobsScraper
from app.scrapers.remotive import RemotiveScraper
from app.scrapers.workua import WorkUaScraper


def get_scrapers(sources: list[str] | None = None) -> list[BaseScraper]:
    registry: dict[str, type[BaseScraper]] = {
        "workua": WorkUaScraper,
        "dou": DouScraper,
        "djinni": DjinniScraper,
        "remotive": RemotiveScraper,
        "arbeitnow": ArbeitnowScraper,
        "remoteok": RemoteOkScraper,
        "himalayas": HimalayasScraper,
        "remotejobs": RemoteJobsScraper,
    }
    selected = sources or list(registry)
    return [registry[source]() for source in selected if source in registry]
