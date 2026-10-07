"""Dev Core routes: code patch preview/apply, commit watching, notifications,
and the platform-cron endpoints behind the morning brief and the background watcher.
"""

import asyncio
import hmac
import logging
import os
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from lib.activity import clean, log_activity, today_activities
from lib.brain import MODEL, PROVIDER, api_key
from lib.dates import today_iso
from lib.db import db
from lib.devtools import PatchError, apply_patch, build_proposal, scan_commits
from lib.usage import record_usage
from models.schemas import (
    Briefing,
    CommitScanResult,
    Notification,
    Patch,
    PatchCreate,
)

router = APIRouter(tags=["devtools"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- patches
@router.post("/dev/patches", response_model=Patch)
async def propose_patch(body: PatchCreate):
    try:
        proposal = build_proposal(body.path, body.find, body.replace, body.explanation)
    except PatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    patch = Patch(**proposal)
    await db.patches.insert_one(patch.model_dump())
    await log_activity("dev_core", "patch_propose",
                       f"Yama önerildi: {patch.path.split('/')[-1]}:{patch.line}",
                       patch.explanation)
    return patch


@router.get("/dev/patches", response_model=list[Patch])
async def list_patches(limit: int = 30):
    rows = await db.patches.find().sort("created_at", -1).to_list(limit)
    return [Patch(**clean(r)) for r in rows]


@router.post("/dev/patches/{patch_id}/apply", response_model=Patch)
async def apply_patch_route(patch_id: str):
    doc = await db.patches.find_one({"id": patch_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Yama bulunamadı.")
    if doc.get("status") == "applied":
        return Patch(**clean(doc))

    try:
        result = await apply_patch(doc)
    except PatchError as exc:
        await db.patches.update_one(
            {"id": patch_id}, {"$set": {"status": "failed", "error": str(exc)}}
        )
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await db.patches.update_one({"id": patch_id}, {"$set": {
        "status": "applied", "backup_path": result["backup_path"],
        "applied_at": result["applied_at"], "error": None,
    }})
    await log_activity("dev_core", "patch_apply",
                       f"Yama uygulandı: {doc['path'].split('/')[-1]}:{doc.get('line', 0)}",
                       f"yedek: {result['backup_path']}")
    fresh = await db.patches.find_one({"id": patch_id})
    return Patch(**clean(fresh or doc))


@router.post("/dev/patches/{patch_id}/reject", response_model=Patch)
async def reject_patch(patch_id: str):
    doc = await db.patches.find_one_and_update(
        {"id": patch_id}, {"$set": {"status": "rejected"}}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Yama bulunamadı.")
    await log_activity("dev_core", "patch_reject", f"Yama reddedildi: {doc['path'].split('/')[-1]}")
    return Patch(**clean(doc))


# ---------------------------------------------------------------- commit watch
@router.post("/dev/commits/scan", response_model=CommitScanResult)
async def commits_scan():
    try:
        res = await scan_commits()
    except Exception as exc:
        logger.exception("scan_commits failed")
        raise HTTPException(status_code=502, detail=f"Commit taraması yapılamadı: {exc}") from exc
    return CommitScanResult(
        checked=res["checked"], new_commits=res["new_commits"], disabled=res.get("disabled", False)
    )


# ---------------------------------------------------------------- notifications
@router.get("/notifications", response_model=list[Notification])
async def list_notifications(limit: int = 30, unread_only: bool = False):
    query = {"read": False} if unread_only else {}
    rows = await db.notifications.find(query).sort("created_at", -1).to_list(limit)
    return [Notification(**clean(r)) for r in rows]


@router.post("/notifications/{notification_id}/read", response_model=Notification)
async def mark_read(notification_id: str):
    doc = await db.notifications.find_one_and_update(
        {"id": notification_id}, {"$set": {"read": True}}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Bildirim bulunamadı.")
    return Notification(**clean(doc))


@router.post("/notifications/read-all")
async def mark_all_read():
    res = await db.notifications.update_many({"read": False}, {"$set": {"read": True}})
    return {"updated": res.modified_count}


# ---------------------------------------------------------------- morning brief
async def build_morning_brief() -> Briefing:
    """Today's agenda from REAL data: deadlines, pending tasks, yesterday's activity."""
    settings = await db.settings.find_one({"key": "settings"}) or {}
    name = settings.get("user_name", "Patron")
    today = today_iso()

    projects = await db.projects.find({"status": {"$ne": "done"}}).to_list(50)
    tasks = await db.tasks.find({"status": {"$ne": "done"}}).sort("due", 1).to_list(50)
    recent = await db.activities.find().sort("created_at", -1).to_list(40)

    facts = {
        "bugun": today,
        "bekleyen_gorevler": [
            f"{t.get('title')}"
            + (f" (teslim {t['due']})" if t.get("due") else "")
            + (" [ACİL]" if t.get("priority") == "high" else "")
            for t in tasks
        ],
        "projeler_ve_dersler": [
            f"{p.get('name')} ({p.get('kind')}, %{p.get('progress', 0)}, sıradaki adım: "
            f"{p.get('next_step') or 'belirsiz'}"
            + (f", teslim {p['deadline']}" if p.get("deadline") else "") + ")"
            for p in projects
        ],
        "son_aktiviteler": [f"[{a.get('agent')}] {a.get('summary')}" for a in recent[:20]],
    }

    try:
        chat = (
            LlmChat(api_key=api_key(), session_id=f"morning-{today}",
                    system_message=(
                        "Sen JARVIS'sin. Sabah brifingi veriyorsun. SADECE verilen gerçek verileri "
                        "kullan, veri uydurma. Türkçe, kısa, net, bir dost gibi. Klişe bot "
                        "cümleleri kurma. Bu metin sesli okunacak: kısa paragraflar kullan."
                    ))
            .with_model(PROVIDER, MODEL)
        )
        prompt = (
            f"Kullanıcının adı {name}. Bugünün gerçek verileri:\n{facts}\n\n"
            "Sabah brifingi yaz. Format:\n"
            "## Günaydın\n(tek cümle selam + bugünün en kritik işi)\n"
            "## Bugünün Teslimleri\n(yaklaşan tarihler, yoksa 'bugün teslim yok')\n"
            "## İlk İşin\n(tek bir net öneri: hangi görevle başlamalı ve neden)\n"
            "## Dün Nerede Kalmıştık\n(son aktivitelerden kısa hatırlatma, kayıt yoksa 'kayıt yok')\n"
        )
        buf = ""
        async for ev in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(ev, TextDelta):
                buf += ev.content
            elif isinstance(ev, StreamDone):
                await record_usage(MODEL, ev.usage, "morning_brief")
                break
        report = buf.strip()
    except Exception as exc:
        logger.exception("morning brief llm failed")
        lines = [f"## Günaydın {name}", ""]
        urgent = [t for t in tasks if t.get("priority") == "high"]
        if urgent:
            lines.append(f"Bugünün en kritik işi: {urgent[0].get('title')}")
        lines += ["", "## Bugünün Teslimleri"]
        dated = [t for t in tasks if t.get("due")]
        lines += [f"- {t['title']} (teslim {t['due']})" for t in dated[:8]] or ["- teslim kaydı yok"]
        lines += ["", "## Bekleyen Görevler"]
        lines += [f"- {t.get('title')}" for t in tasks[:8]] or ["- bekleyen görev yok"]
        lines += ["", f"> AI özetleyici şu an erişilemiyor ({exc}). Brifing ham kayıtlardan derlendi."]
        report = "\n".join(lines)

    brief = Briefing(
        day=today, report=report or "Brifing üretilemedi.", kind="morning",
        activity_count=len(recent), completed_tasks=0, pending_tasks=len(tasks),
    )
    await db.briefings.insert_one(brief.model_dump())
    await db.notifications.insert_one(Notification(
        kind="morning_brief",
        title="Sabah brifingin hazır",
        body=f"{len(tasks)} bekleyen görev · bugünün planı çıkarıldı",
        meta={"briefing_id": brief.id, "day": today},
    ).model_dump())
    await log_activity("executive_briefing", "morning_brief", "Sabah brifingi üretildi",
                       f"{len(tasks)} bekleyen görev")
    return brief


@router.get("/briefing/morning", response_model=list[Briefing])
async def morning_brief_today():
    """Today's morning brief, if one has been produced — the UI greets with it once."""
    rows = (
        await db.briefings.find({"kind": "morning", "day": today_iso()})
        .sort("created_at", -1).to_list(1)
    )
    return [Briefing(**clean(r)) for r in rows]


@router.post("/briefing/morning", response_model=Briefing)
async def morning_brief_now():
    """Manual trigger, so the user never has to wait until 09:00 to see it work."""
    return await build_morning_brief()


@router.post("/briefing/{briefing_id}/spoken", response_model=Briefing)
async def mark_spoken(briefing_id: str):
    doc = await db.briefings.find_one_and_update(
        {"id": briefing_id}, {"$set": {"spoken": True}}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Brifing bulunamadı.")
    return Briefing(**clean(doc))


# ---------------------------------------------------------------- cron endpoints
def _authorize(authorization: str | None) -> None:
    secret = os.environ.get("WEBHOOK_CRON_SECRET", "")
    if not secret:
        raise HTTPException(status_code=401, detail="Cron secret yapılandırılmamış.")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Yetkisiz.")
    token = authorization.split(" ", 1)[1]
    if not hmac.compare_digest(token, secret):
        raise HTTPException(status_code=401, detail="Yetkisiz.")


async def _run_once(key: str, coro_factory) -> None:
    """Idempotency by webhook run id: a duplicate delivery does no second run."""
    try:
        await db.cron_runs.insert_one({"key": key, "created_at": datetime.now(timezone.utc)})
    except Exception:
        return  # duplicate run id — already handled
    try:
        await coro_factory()
    except Exception:
        logger.exception("cron job %s failed", key)


@router.post("/cron/morning-brief")
async def cron_morning_brief(
    request: Request,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    try:
        envelope = await request.json()
    except Exception:
        envelope = {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Geçersiz gövde.")

    run_id = x_webhook_id or str(envelope.get("run_id") or datetime.now(timezone.utc).isoformat())

    async def job():
        settings = await db.settings.find_one({"key": "settings"}) or {}
        if settings.get("morning_brief_enabled") is False:
            return
        existing = await db.briefings.find_one({"kind": "morning", "day": today_iso()})
        if existing:
            return
        await build_morning_brief()

    asyncio.create_task(_run_once(f"morning:{run_id}", job))
    return JSONResponse({"accepted": True, "run_id": run_id}, status_code=202)


@router.post("/cron/commit-watch")
async def cron_commit_watch(
    request: Request,
    authorization: str | None = Header(default=None),
    x_webhook_id: str | None = Header(default=None),
):
    # Cron endpoints must ack 2xx immediately; enqueue/background the actual work.
    _authorize(authorization)
    try:
        envelope = await request.json()
    except Exception:
        envelope = {}
    if not isinstance(envelope, dict):
        raise HTTPException(status_code=400, detail="Geçersiz gövde.")

    run_id = x_webhook_id or str(envelope.get("run_id") or datetime.now(timezone.utc).isoformat())
    asyncio.create_task(_run_once(f"commits:{run_id}", scan_commits))
    return JSONResponse({"accepted": True, "run_id": run_id}, status_code=202)
