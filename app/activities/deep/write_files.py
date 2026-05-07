from __future__ import annotations

from datetime import date

from temporalio import activity

from app.activities.deep._models import WriteFilesInput, WriteFilesResult
from app.services.deep_dream import validate_consolidated_output, write_consolidated_files
from app.services.memory_files import append_vault_log
from app.services.vault_updater import update_file_manifest, update_vault_folders


@activity.defn(name="deep.write_files")
async def write_files(inp: WriteFilesInput) -> WriteFilesResult:
    source_date = date.fromisoformat(inp.source_date_iso)

    validated = await validate_consolidated_output(inp.consolidation_json)
    files_modified = await write_consolidated_files(validated, source_date)

    # Vault folder updates
    vault_updates = inp.consolidation_json.get("vault_updates")
    if vault_updates is not None and any(
        vault_updates.get(f)
        for f in (
            "decisions",
            "projects",
            "patterns",
            "templates",
            "concepts",
            "connections",
            "lessons",
            "topics",
        )
    ):
        try:
            vault_files = await update_vault_folders(vault_updates, source_date)
            files_modified.extend(vault_files)
        except Exception as exc:
            activity.logger.warning("deep.write_files.vault_update_failed: %s", exc)

    try:
        await update_file_manifest(files_modified)
    except Exception as exc:
        activity.logger.warning("deep.write_files.manifest_failed: %s", exc)

    try:
        for fm in files_modified:
            path = fm.get("path", "") if isinstance(fm, dict) else str(fm)
            action = fm.get("action", "update") if isinstance(fm, dict) else "update"
            if action == "create":
                await append_vault_log("create", str(path))
            else:
                await append_vault_log("update", str(path))
    except Exception as exc:
        activity.logger.warning("deep.write_files.vault_log_failed: %s", exc)

    return WriteFilesResult(files_modified=files_modified)
