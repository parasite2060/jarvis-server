from typing import Any

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class MemorySearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    query: str
    method: str = "rag"


class MemorySearchResultItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    relevance: float
    source: str | None = None
    metadata: dict[str, Any] | None = None


class MemorySearchData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    results: list[MemorySearchResultItem]
    query: str
    method: str


class MemorySearchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: MemorySearchData


class MemoryAddRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    content: str
    metadata: dict[str, Any] | None = None


class MemoryAddData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    memory_id: str
    status: str


class MemoryAddResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: MemoryAddData
