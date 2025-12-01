from pydantic import BaseModel, AnyHttpUrl, field_validator
from urllib.parse import urlsplit, urlunsplit

class SourceCreate(BaseModel):
    name: str
    base_url: AnyHttpUrl

    @field_validator("base_url")
    @classmethod
    def normalize(cls, v: AnyHttpUrl) -> str:
        p = urlsplit(str(v))
        netloc = p.netloc.lower()
        path = p.path or "/"
        return urlunsplit((p.scheme, netloc, path.rstrip("/") or "/", p.query, ""))

class SourceOut(BaseModel):
    id: int
    name: str
    base_url: str
    class Config:
        from_attributes = True
