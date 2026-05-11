from pydantic import BaseModel


class SourceStats(BaseModel):
    source: str
    total: int
    today: int


class SalaryRangeStats(BaseModel):
    label: str
    count: int


class CategoryStats(BaseModel):
    id: str
    name: str
    total: int
    new_today: int


class StatsRead(BaseModel):
    total: int
    saved_total: int = 0
    by_source: list[SourceStats]
    salary_ranges: list[SalaryRangeStats] = []
    categories: list[CategoryStats] = []
