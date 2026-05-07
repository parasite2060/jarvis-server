from __future__ import annotations

from temporalio import activity

from app.activities.weekly._models import GatherIndexesInput, GatherIndexesResult
from app.services.memory_files import read_vault_file

_VAULT_INDEX_FOLDERS = (
    "decisions",
    "patterns",
    "concepts",
    "connections",
    "lessons",
    "projects",
)


@activity.defn(name="weekly.gather_indexes")
async def gather_indexes(inp: GatherIndexesInput) -> GatherIndexesResult:
    vault_indexes: dict[str, str] = {}
    for folder in _VAULT_INDEX_FOLDERS:
        content = await read_vault_file(f"{folder}/_index.md")
        if content:
            vault_indexes[folder] = content

    vault_guide = await read_vault_file("_guide.md") or ""

    activity.logger.info(
        "weekly.gather_indexes.completed",
        dream_id=inp.dream_id,
        index_count=len(vault_indexes),
    )
    return GatherIndexesResult(vault_indexes=vault_indexes, vault_guide=vault_guide)
