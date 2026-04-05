from typing import Literal

from pydantic import BaseModel, Field

ALLOWED_VAULT_TARGETS = ("memory", "decisions", "patterns", "projects", "templates")

VaultTarget = Literal["memory", "decisions", "patterns", "projects", "templates"]


class MemoryItem(BaseModel):
    content: str = Field(max_length=200)
    reasoning: str | None = None
    vault_target: VaultTarget
    source_date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")


class DreamExtraction(BaseModel):
    no_extract: bool = False
    summary: str = ""
    decisions: list[MemoryItem] = Field(default_factory=list)
    preferences: list[MemoryItem] = Field(default_factory=list)
    patterns: list[MemoryItem] = Field(default_factory=list)
    corrections: list[MemoryItem] = Field(default_factory=list)
    facts: list[MemoryItem] = Field(default_factory=list)
