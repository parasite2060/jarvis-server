from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

DEFAULT_AUTO_MERGE = True
DEFAULT_DEEP_DREAM_CRON = "0 20 * * *"
DEFAULT_WEEKLY_REVIEW_CRON = "0 20 * * 0"
DEFAULT_MAX_MEMORY_LINES = 200
MIN_MEMORY_LINES = 50
MAX_MEMORY_LINES = 500


class ConfigData(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    auto_merge: bool = DEFAULT_AUTO_MERGE
    deep_dream_cron: str = DEFAULT_DEEP_DREAM_CRON
    weekly_review_cron: str = DEFAULT_WEEKLY_REVIEW_CRON
    max_memory_lines: int = DEFAULT_MAX_MEMORY_LINES


class ConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    auto_merge: bool | None = None
    deep_dream_cron: str | None = None
    weekly_review_cron: str | None = None
    max_memory_lines: int | None = Field(default=None, ge=MIN_MEMORY_LINES, le=MAX_MEMORY_LINES)


class ConfigResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)

    status: str
    data: ConfigData
