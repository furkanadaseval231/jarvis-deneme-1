"""Sub-agent routes callable directly from the dashboard panels (not only via chat)."""

import logging

from fastapi import APIRouter, HTTPException

from lib.activity import clean, log_activity
from lib.brain import grounded_search
from lib.db import db
from lib.metrics import collect_metrics
from lib.shell import classify, run_command, scan_workspace
from lib.web import youtube_search
from models.schemas import (
    CommandRequest,
    CommandResult,
    MediaSearchRequest,
    SystemMetrics,
    Track,
    WebScan,
    WebSearchRequest,
)

router = APIRouter(tags=["agents"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- Web & Browser Agent
@router.post("/web/search", response_model=WebScan)
async def web_search(req: WebSearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=422, detail="Arama sorgusu boş olamaz.")
    try:
        data = await grounded_search(req.query, req.kind)
    except Exception as exc:
        logger.exception("grounded_search failed")
        raise HTTPException(
            status_code=502,
            detail=f"Canlı web taraması yapılamadı: {exc}. İnternet bağlantısını kontrol et.",
        ) from exc

    scan = WebScan(query=req.query, kind=req.kind, summary=data["summary"],
                   results=data["results"], flights=data["flights"])
    await db.webscans.insert_one(scan.model_dump())
    await log_activity("web_browser", "web_scan", f"Web taraması: {req.query}", data["summary"])
    return scan


@router.get("/web/scans", response_model=list[WebScan])
async def web_scans(limit: int = 15):
    rows = await db.webscans.find().sort("created_at", -1).to_list(limit)
    return [WebScan(**clean(r)) for r in rows]


# ---------------------------------------------------------------- Media & OS Controller
@router.post("/media/search", response_model=list[Track])
async def media_search(req: MediaSearchRequest):
    if not req.query.strip():
        raise HTTPException(status_code=422, detail="Şarkı sorgusu boş olamaz.")
    try:
        tracks = await youtube_search(req.query, limit=8)
    except Exception as exc:
        logger.exception("youtube_search failed")
        raise HTTPException(
            status_code=502, detail=f"YouTube'a ulaşamadım: {exc}"
        ) from exc
    if not tracks:
        raise HTTPException(status_code=404, detail="YouTube'da sonuç bulunamadı.")
    await log_activity("media_os", "media_search", f"YouTube arama: {req.query}",
                       tracks[0]["title"])
    return [Track(**t) for t in tracks]


@router.post("/media/log")
async def media_log(body: dict):
    """The browser owns playback; it tells us what actually started/stopped so the
    briefing reflects real media activity."""
    action = str(body.get("action", "play"))
    title = str(body.get("title", ""))
    await log_activity("media_os", f"media_{action}",
                       f"Medya {'başlatıldı' if action == 'play' else 'durduruldu'}: {title}" if title
                       else f"Medya {action}")
    return {"ok": True}


# ---------------------------------------------------------------- Dev Core / terminal
@router.post("/system/exec", response_model=CommandResult)
async def exec_command(req: CommandRequest):
    if not req.command.strip():
        raise HTTPException(status_code=422, detail="Komut boş olamaz.")
    res = await run_command(req.command, confirm=req.confirm)
    if not res["needs_confirm"]:
        await log_activity("dev_core", "terminal", f"Komut: {req.command}",
                           (res["stdout"] or res["stderr"])[:800])
    return CommandResult(**res)


@router.get("/system/classify")
async def classify_command(command: str):
    verdict, reason = classify(command)
    return {"command": command, "verdict": verdict, "reason": reason}


@router.get("/system/scan")
async def system_scan(path: str = "/app"):
    res = await scan_workspace(path)
    await log_activity("dev_core", "project_scan", f"Proje tarandı: {path} ({res['branch']})",
                       f"{len(res['commits'])} commit, {len(res['dirty'])} değişmiş dosya")
    return res


@router.get("/system/metrics", response_model=SystemMetrics)
async def system_metrics():
    return SystemMetrics(**await collect_metrics())
