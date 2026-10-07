"""Workspace routes: projects, tasks, notes, activity log, briefing, settings."""

import logging
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
from fastapi import APIRouter, HTTPException

from lib.activity import clean, log_activity, today_activities
from lib.brain import MODEL, PROVIDER, api_key
from lib.dates import today_iso
from lib.db import db
from models.schemas import (
    Activity,
    Briefing,
    Note,
    NoteCreate,
    Project,
    ProjectCreate,
    ProjectUpdate,
    ResearchRequest,
    Settings,
    SettingsUpdate,
    Task,
    TaskCreate,
    TaskUpdate,
)

router = APIRouter(tags=["workspace"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- projects
@router.get("/projects", response_model=list[Project])
async def list_projects():
    rows = await db.projects.find().sort("created_at", -1).to_list(100)
    return [Project(**clean(r)) for r in rows]


@router.post("/projects", response_model=Project)
async def create_project(body: ProjectCreate):
    project = Project(**body.model_dump())
    await db.projects.insert_one(project.model_dump())
    await log_activity("dev_core", "project_add", f"Yeni kayıt: {project.name}")
    return project


@router.patch("/projects/{project_id}", response_model=Project)
async def update_project(project_id: str, body: ProjectUpdate):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=422, detail="Güncellenecek alan yok.")
    doc = await db.projects.find_one_and_update(
        {"id": project_id}, {"$set": patch}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Proje bulunamadı.")
    await log_activity("dev_core", "project_update", f"Güncellendi: {doc.get('name')}", str(patch))
    return Project(**clean(doc))


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    res = await db.projects.delete_one({"id": project_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Proje bulunamadı.")
    return {"deleted": project_id}


# ---------------------------------------------------------------- tasks
@router.get("/tasks", response_model=list[Task])
async def list_tasks():
    rows = await db.tasks.find().sort("created_at", -1).to_list(200)
    return [Task(**clean(r)) for r in rows]


@router.post("/tasks", response_model=Task)
async def create_task(body: TaskCreate):
    task = Task(**body.model_dump())
    await db.tasks.insert_one(task.model_dump())
    await log_activity("executive_briefing", "task_add", f"Görev eklendi: {task.title}")
    return task


@router.patch("/tasks/{task_id}", response_model=Task)
async def update_task(task_id: str, body: TaskUpdate):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=422, detail="Güncellenecek alan yok.")
    if patch.get("status") == "done":
        patch["completed_at"] = datetime.now(timezone.utc)
    doc = await db.tasks.find_one_and_update(
        {"id": task_id}, {"$set": patch}, return_document=True
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Görev bulunamadı.")
    if patch.get("status") == "done":
        await log_activity("executive_briefing", "task_done", f"Görev tamamlandı: {doc.get('title')}")
    return Task(**clean(doc))


@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    res = await db.tasks.delete_one({"id": task_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Görev bulunamadı.")
    return {"deleted": task_id}


# ---------------------------------------------------------------- notes & research
@router.get("/notes", response_model=list[Note])
async def list_notes():
    rows = await db.notes.find().sort("created_at", -1).to_list(100)
    return [Note(**clean(r)) for r in rows]


@router.post("/notes", response_model=Note)
async def create_note(body: NoteCreate):
    note = Note(**body.model_dump())
    await db.notes.insert_one(note.model_dump())
    await log_activity("research_study", "note_save", f"Not kaydedildi: {note.title}")
    return note


@router.delete("/notes/{note_id}")
async def delete_note(note_id: str):
    res = await db.notes.delete_one({"id": note_id})
    if not res.deleted_count:
        raise HTTPException(status_code=404, detail="Not bulunamadı.")
    return {"deleted": note_id}


@router.post("/research", response_model=Note)
async def research(body: ResearchRequest):
    """Research & Study Agent: live-grounded digest, saved straight into notes."""
    topic = body.topic.strip()
    if not topic:
        raise HTTPException(status_code=422, detail="Araştırma konusu boş olamaz.")
    try:
        chat = (
            LlmChat(api_key=api_key(), session_id=f"research-{today_iso()}",
                    system_message="Sen teknik araştırma ajanısın. Türkçe, yoğun ve pratik hap "
                                   "özetler çıkarırsın. Madde işaretleri kullan, laf kalabalığı yapma.")
            .with_model(PROVIDER, MODEL)
            .with_tools([{"googleSearch": {}}])
        )
        prompt = (
            f"'{topic}' konusunu canlı web aramasıyla araştır ve hap özet çıkar.\n"
            "Format:\n## Özet (3 cümle)\n## Kilit Noktalar (5 madde)\n"
            "## Pratik Kullanım\n## Dikkat Edilmesi Gerekenler\n## Kaynaklar (link listesi)"
        )
        buf = ""
        async for ev in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(ev, TextDelta):
                buf += ev.content
            elif isinstance(ev, StreamDone):
                break
    except Exception as exc:
        logger.exception("research failed")
        raise HTTPException(
            status_code=502,
            detail=f"Araştırma ajanı çalışmadı: {exc}. Ağ bağlantısını kontrol et.",
        ) from exc

    note = Note(title=topic, content=buf.strip() or "Araştırma sonucu boş döndü.",
                tags=["araştırma", "hap-özet"], source="research")
    await db.notes.insert_one(note.model_dump())
    await log_activity("research_study", "research", f"Araştırma: {topic}", note.content[:600])
    return note


# ---------------------------------------------------------------- activity & briefing
@router.get("/activities", response_model=list[Activity])
async def list_activities(limit: int = 80, today_only: bool = False):
    query = {"day": today_iso()} if today_only else {}
    rows = await db.activities.find(query).sort("created_at", -1).to_list(limit)
    return [Activity(**clean(r)) for r in rows]


@router.post("/briefing", response_model=Briefing)
async def generate_briefing():
    """Executive Briefing Agent: one-page end-of-day report from REAL activity rows."""
    acts = await today_activities(150)
    done = await db.tasks.find({"status": "done"}).to_list(200)
    pending = await db.tasks.find({"status": {"$ne": "done"}}).sort("due", 1).to_list(200)
    projects = await db.projects.find().to_list(100)

    today_done = [
        t for t in done
        if t.get("completed_at") and str(t["completed_at"])[:10] == today_iso()
    ]

    if not acts and not today_done:
        report = (
            f"## {today_iso()} — Gün Özeti\n\n"
            "Bugün henüz kayda değer bir aktivite yok. Sohbet et, terminal komutu çalıştır, "
            "web taraması yap veya görev tamamla; hepsini buraya işleyip akşam gerçek bir "
            "döküm çıkarayım."
        )
        brief = Briefing(day=today_iso(), report=report, activity_count=0,
                         completed_tasks=0, pending_tasks=len(pending))
        return brief

    facts = {
        "aktiviteler": [f"[{a.get('agent')}/{a.get('kind')}] {a.get('summary')}" for a in acts],
        "bugun_tamamlanan_gorevler": [t.get("title") for t in today_done],
        "bekleyen_gorevler": [
            f"{t.get('title')}" + (f" (teslim {t['due']})" if t.get("due") else "")
            for t in pending
        ],
        "projeler": [
            f"{p.get('name')} ({p.get('kind')}, %{p.get('progress', 0)}, durum {p.get('status')}"
            + (f", teslim {p['deadline']}" if p.get("deadline") else "") + ")"
            for p in projects
        ],
    }

    try:
        chat = (
            LlmChat(api_key=api_key(), session_id=f"brief-{today_iso()}",
                    system_message="Sen JARVIS'in yönetici brief ajanısın. SADECE verilen gerçek "
                                   "verilerden rapor yazarsın; veri uydurmak yasak. Türkçe, net, "
                                   "madde madde, tek sayfa.")
            .with_model(PROVIDER, MODEL)
        )
        prompt = (
            f"Bugün ({today_iso()}) şu gerçek olaylar kaydedildi:\n"
            f"{facts}\n\n"
            "Bu verilerden tek sayfalık gün sonu raporu yaz. Format:\n"
            "## Bugün Ne Yaptık\n## Neler İlerledi\n## Tamamlananlar\n"
            "## Sırada Ne Var\n## Kritik Uyarılar (yaklaşan teslim, hata varsa)\n\n"
            "Veri yoksa o başlığa 'kayıt yok' yaz. Sonunda bana 1 cümlelik tavsiye ver."
        )
        buf = ""
        async for ev in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(ev, TextDelta):
                buf += ev.content
            elif isinstance(ev, StreamDone):
                break
        report = buf.strip()
    except Exception as exc:
        logger.exception("briefing llm failed")
        # Degrade to a real, data-backed plain report rather than failing the request.
        lines = [f"## {today_iso()} — Gün Özeti (yerel derleme)", ""]
        lines.append(f"**Kayıtlı aktivite:** {len(acts)}")
        for a in acts[:25]:
            lines.append(f"- [{a.get('agent')}] {a.get('summary')}")
        lines.append("")
        lines.append(f"**Bugün tamamlanan görevler:** {len(today_done)}")
        for t in today_done:
            lines.append(f"- {t.get('title')}")
        lines.append("")
        lines.append(f"**Bekleyen görevler:** {len(pending)}")
        for t in pending[:15]:
            lines.append(f"- {t.get('title')}" + (f" (teslim {t['due']})" if t.get("due") else ""))
        lines.append("")
        lines.append(f"> Not: AI özetleyici şu an erişilemiyor ({exc}). Rapor ham kayıtlardan derlendi.")
        report = "\n".join(lines)

    brief = Briefing(day=today_iso(), report=report or "Rapor üretilemedi.",
                     activity_count=len(acts), completed_tasks=len(today_done),
                     pending_tasks=len(pending))
    await db.briefings.insert_one(brief.model_dump())
    await log_activity("executive_briefing", "briefing", "Gün sonu raporu üretildi",
                       f"{len(acts)} aktivite, {len(today_done)} tamamlanan görev")
    return brief


@router.get("/briefing/latest", response_model=list[Briefing])
async def latest_briefings(limit: int = 7):
    rows = await db.briefings.find().sort("created_at", -1).to_list(limit)
    return [Briefing(**clean(r)) for r in rows]


# ---------------------------------------------------------------- settings
@router.get("/settings", response_model=Settings)
async def get_settings():
    doc = await db.settings.find_one({"key": "settings"})
    if not doc:
        defaults = Settings()
        await db.settings.insert_one({"key": "settings", **defaults.model_dump()})
        return defaults
    return Settings(**{k: v for k, v in clean(doc).items() if k != "key"})


@router.patch("/settings", response_model=Settings)
async def update_settings(body: SettingsUpdate):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    if not patch:
        raise HTTPException(status_code=422, detail="Güncellenecek ayar yok.")
    await db.settings.update_one({"key": "settings"}, {"$set": patch}, upsert=True)
    doc = await db.settings.find_one({"key": "settings"}) or {}
    await log_activity("companion_vision", "settings", "Ayarlar güncellendi", str(patch))
    return Settings(**{k: v for k, v in clean(doc).items() if k != "key"})
