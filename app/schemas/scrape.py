from pydantic import BaseModel


class ScrapeResult(BaseModel):
    source: str
    parsed: int
    created: int
    updated: int


class TaskAccepted(BaseModel):
    task_id: str
    status: str
