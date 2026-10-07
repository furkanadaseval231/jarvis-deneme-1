"""Dev Core tooling: code patch proposals with preview + backup, and git commit watching.

Patches are never written blind — a proposal records the exact unified diff first, and
writing only happens on an explicit apply call, after taking a timestamped backup.
"""

import difflib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from lib.db import db
from lib.shell import run_command

logger = logging.getLogger(__name__)

# A patch may only touch files under these roots — never /etc, /root, the venv, ...
ALLOWED_ROOTS = ["/app"]
FORBIDDEN_PARTS = ["node_modules", "/.git/", "/.venv/", "__pycache__", "/.emergent/"]
MAX_FILE_BYTES = 400_000


class PatchError(Exception):
    """Carries a Turkish, user-facing reason the patch cannot be prepared or applied."""


def resolve_target(path: str) -> Path:
    raw = (path or "").strip()
    if not raw:
        raise PatchError("Dosya yolu boş.")
    target = Path(raw).expanduser()
    if not target.is_absolute():
        target = Path("/app") / raw
    target = Path(os.path.normpath(str(target)))

    if not any(str(target).startswith(root + "/") or str(target) == root for root in ALLOWED_ROOTS):
        raise PatchError(f"Güvenlik: {target} proje dizini (/app) dışında, dokunmam.")
    if any(part in str(target) for part in FORBIDDEN_PARTS):
        raise PatchError(f"Güvenlik: {target} korumalı bir klasörde (bağımlılık/git iç dosyası).")
    return target


def build_proposal(path: str, find: str, replace: str, explanation: str) -> dict:
    """Read the file, locate `find`, and render the unified diff WITHOUT writing anything."""
    target = resolve_target(path)
    if not target.is_file():
        raise PatchError(f"{target} diye bir dosya yok. Yolu kontrol et.")
    if target.stat().st_size > MAX_FILE_BYTES:
        raise PatchError(f"{target} çok büyük ({target.stat().st_size} byte), yama uygulayamam.")

    original = target.read_text("utf-8", "replace")
    if not find:
        raise PatchError("Değiştirilecek metin (find) boş olamaz.")

    occurrences = original.count(find)
    if occurrences == 0:
        raise PatchError(
            f"Aradığım kod parçası {target.name} içinde bulunamadı. Dosya değişmiş olabilir."
        )

    patched = original.replace(find, replace, 1)
    if patched == original:
        raise PatchError("Yama dosyayı değiştirmiyor (find ve replace aynı).")

    diff = "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            patched.splitlines(keepends=True),
            fromfile=f"a/{target.name}",
            tofile=f"b/{target.name}",
            n=3,
        )
    )

    first_line = original[: original.index(find)].count("\n") + 1

    return {
        "path": str(target),
        "find": find,
        "replace": replace,
        "explanation": explanation,
        "diff": diff,
        "line": first_line,
        "occurrences": occurrences,
        "status": "pending",
    }


async def apply_patch(patch: dict) -> dict:
    """Write the patch, after backing the original up next to it."""
    target = resolve_target(str(patch["path"]))
    if not target.is_file():
        raise PatchError(f"{target} artık yok, yama uygulanamadı.")

    original = target.read_text("utf-8", "replace")
    find = str(patch["find"])
    if find not in original:
        raise PatchError(
            "Dosya yama hazırlandıktan sonra değişmiş; eski kod parçası artık yok. "
            "Yamayı yeniden önerdirmen gerekiyor."
        )

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    backup = target.with_name(f"{target.name}.bak-{stamp}")
    backup.write_text(original, "utf-8")
    target.write_text(original.replace(find, str(patch["replace"]), 1), "utf-8")

    return {"backup_path": str(backup), "applied_at": datetime.now(timezone.utc)}


# ------------------------------------------------------------------ commit watching
async def git_head(path: str) -> dict:
    """Read HEAD + recent commits for one directory. Returns {} when it is not a repo."""
    res = await run_command(
        f"cd {path!r} 2>/dev/null && git rev-parse HEAD 2>/dev/null && "
        f"git log -n 5 --pretty=format:'%H|%h|%an|%ar|%s' 2>/dev/null",
        confirm=True,
    )
    lines = [line for line in res["stdout"].splitlines() if line.strip()]
    if not lines:
        return {}
    head = lines[0].strip()
    commits = []
    for line in lines[1:]:
        parts = line.split("|", 4)
        if len(parts) == 5:
            commits.append({
                "sha": parts[0], "hash": parts[1], "author": parts[2],
                "when": parts[3], "subject": parts[4],
            })
    return {"head": head, "commits": commits}


async def scan_commits() -> dict:
    """Compare each watched dir's HEAD against the stored state; notify on anything new.

    The first sight of a repo only records its HEAD — it never floods the feed with
    history that existed before watching started.
    """
    settings = await db.settings.find_one({"key": "settings"}) or {}
    if settings.get("commit_watch_enabled") is False:
        return {"checked": 0, "new_commits": 0, "notifications": [], "disabled": True}

    dirs = settings.get("watch_dirs") or ["/app"]
    created: list[dict] = []
    checked = 0

    for raw in dirs[:8]:
        path = str(raw).strip()
        if not path:
            continue
        try:
            info = await git_head(path)
        except Exception as exc:
            logger.warning("git_head(%s) failed: %s", path, exc)
            continue
        if not info:
            continue
        checked += 1

        state = await db.repo_state.find_one({"path": path})
        if not state:
            await db.repo_state.insert_one({"path": path, "head": info["head"]})
            continue
        if state.get("head") == info["head"]:
            continue

        known = {c["sha"] for c in info["commits"]}
        fresh = []
        for commit in info["commits"]:
            if commit["sha"] == state.get("head"):
                break
            fresh.append(commit)
        if not fresh and state.get("head") not in known:
            fresh = info["commits"][:1]

        await db.repo_state.update_one({"path": path}, {"$set": {"head": info["head"]}})

        from lib.activity import log_activity
        from models.schemas import Notification

        for commit in fresh[:5]:
            note = Notification(
                kind="commit",
                title=f"Yeni commit: {commit['subject'][:80]}",
                body=f"{path} · {commit['hash']} · {commit['author']} · {commit['when']}",
                meta={"path": path, "hash": commit["hash"], "subject": commit["subject"]},
            )
            await db.notifications.insert_one(note.model_dump())
            await log_activity(
                "dev_core", "commit",
                f"Yeni commit algılandı: {commit['subject'][:70]}",
                f"{path} · {commit['hash']} · {commit['author']}",
            )
            created.append({"title": note.title, "hash": commit["hash"]})

    return {"checked": checked, "new_commits": len(created), "notifications": created}
