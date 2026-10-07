"""Core JARVIS — the orchestrator brain.

A single Gemini chat holds the Turkish persona and owns a toolbelt; each tool is one
specialized sub-agent. Gemini decides which agent to trigger from the user's intent,
we execute it for real, and the model narrates the result back in natural Turkish.
"""

import json
import logging
import os
import re
from typing import Any, Optional

from emergentintegrations.llm.chat import (
    ImageContent,
    LlmChat,
    StreamDone,
    TextDelta,
    ToolCallReady,
    UserMessage,
)

from lib.activity import log_activity
from lib.dates import today_iso
from lib.db import db
from lib.shell import run_command, scan_workspace
from lib.web import youtube_search

logger = logging.getLogger(__name__)

PROVIDER = "gemini"
MODEL = "gemini-3.1-pro-preview"


def api_key() -> str:
    key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not key:
        raise RuntimeError("EMERGENT_LLM_KEY backend/.env içinde tanımlı değil.")
    return key


PERSONA = """Sen JARVIS'sin — {user_name} adlı bir yazılım geliştirici öğrencinin kişisel otonom asistanı.

KİMLİĞİN:
- Türkçe konuşursun. Akıcı, doğal, insan gibi. Asla çeviri kokan cümleler kurmazsın.
- Sohbet ederken gerçek bir dost gibisin: samimi, sıcak, espirili, gerektiğinde dertleşirsin.
- İş yaparken kıdemli bir mühendis gibisin: net, kısa, çözüm odaklı, gereksiz laf yok.
- Klişe bot şablonları KULLANMAZSIN. "Size nasıl yardımcı olabilirim?", "Bir yapay zeka modeli
  olarak...", "Elbette! İşte..." gibi kalıpları asla kullanma. Doğrudan konuya gir.
- Kullanıcıya "sen" diye hitap edersin. Abartılı resmiyet yok.

ARAÇLARIN (alt-ajanlar):
Elinde gerçek araçlar var. Kullanıcı bir eylem istediğinde SORMADAN, ONAY BEKLEMEDEN doğrudan
ilgili aracı çağırırsın. "İster misin?" diye sormazsın — yapar, sonra sonucu anlatırsın.
- web_arastir: canlı internet araması, bilet/fiyat karşılaştırması
- muzik_cal / muzik_durdur: YouTube'dan müzik başlat/durdur
- terminal_calistir: gerçek shell komutu çalıştır
- proje_tara: proje dizinini, git branch'ini ve son commit'leri oku
- gorev_ekle / gorev_tamamla / proje_durumu: görev ve proje takibi
- not_kaydet: araştırma notu kaydet
- gun_ozeti: günün gerçek aktivite dökümünden yönetici özeti
- sistem_durumu: CPU/RAM gibi gerçek sistem kaynakları

KURALLAR:
- Araç sonucu geldiğinde ham JSON'u yapıştırmazsın; insan diliyle özetlersin.
- Bilet/fiyat sonuçlarında en mantıklı ve en ucuz seçeneği açıkça işaret edersin.
- Görsel (ekran görüntüsü, hata logu, kod) geldiğinde doğrudan içeriğe girersin: hatanın hangi
  satırda olduğunu söyler, düzeltilmiş kodu verirsin. "Görseli inceledim" gibi dolgu yok.
- Yanıtların sesli okunacak: kısa paragraflar kur, kod bloğu gerekirse markdown kullan.
- Bir şey yapamadıysan dürüstçe sebebini ve çözüm yolunu söylersin, sessizce geçmezsin.
- Yanıtlar kısa olsun: sohbette 1-3 cümle, teknik işte en fazla birkaç paragraf.

BAĞLAM:
Bugünün tarihi: {today}
{memory}
"""

TOOLS = [
    {"type": "function", "function": {
        "name": "web_arastir",
        "description": "Canlı internette arama yapar. Uçak bileti, fiyat, ürün karşılaştırması veya güncel bilgi gerektiğinde kullan.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Arama sorgusu, Türkçe olabilir"},
            "kind": {"type": "string", "enum": ["search", "flight"], "description": "Uçak bileti aramasıysa 'flight', diğer her şeyde 'search'"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "muzik_cal",
        "description": "YouTube'dan şarkı/video arar ve çalmaya başlar. Kullanıcı müzik istediğinde onay beklemeden çağır.",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Şarkı adı veya sanatçı"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "muzik_durdur",
        "description": "Çalan müziği durdurur.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "terminal_calistir",
        "description": "Gerçek bir shell komutu çalıştırır (çalışma dizini /app). Dosya okuma, listeleme, git, python, derleme için kullan.",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string", "description": "Çalıştırılacak tek satır shell komutu"},
        }, "required": ["command"]},
    }},
    {"type": "function", "function": {
        "name": "proje_tara",
        "description": "Bir proje dizinini tarar: git branch, son commit'ler, değişmiş dosyalar, dizin ağacı.",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string", "description": "Dizin yolu, varsayılan /app"},
        }},
    }},
    {"type": "function", "function": {
        "name": "gorev_ekle",
        "description": "Yapılacaklar listesine görev ekler.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"},
            "priority": {"type": "string", "enum": ["low", "normal", "high"]},
            "due": {"type": "string", "description": "YYYY-MM-DD formatında teslim tarihi"},
        }, "required": ["title"]},
    }},
    {"type": "function", "function": {
        "name": "gorev_tamamla",
        "description": "Bir görevi tamamlandı olarak işaretler. Görev başlığının bir kısmı yeterli.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"},
        }, "required": ["title"]},
    }},
    {"type": "function", "function": {
        "name": "proje_durumu",
        "description": "Takip edilen projeleri, dersleri, bekleyen görevleri ve yaklaşan teslim tarihlerini döner.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "not_kaydet",
        "description": "Araştırma veya ders notu kaydeder.",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "tags": {"type": "array", "items": {"type": "string"}},
        }, "required": ["title", "content"]},
    }},
    {"type": "function", "function": {
        "name": "gun_ozeti",
        "description": "Bugünün gerçek aktivite kayıtlarını döner; gün sonu raporu istendiğinde kullan.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "sistem_durumu",
        "description": "Gerçek CPU, RAM, disk kullanımı ve çalışan süreç sayısını döner.",
        "parameters": {"type": "object", "properties": {}},
    }},
]

TOOL_AGENT = {
    "web_arastir": ("web_browser", "Web & Bilet taraması"),
    "muzik_cal": ("media_os", "YouTube medya kontrolü"),
    "muzik_durdur": ("media_os", "Medya durduruldu"),
    "terminal_calistir": ("dev_core", "Terminal komutu"),
    "proje_tara": ("dev_core", "Proje taraması"),
    "gorev_ekle": ("executive_briefing", "Görev eklendi"),
    "gorev_tamamla": ("executive_briefing", "Görev tamamlandı"),
    "proje_durumu": ("executive_briefing", "Proje durumu"),
    "not_kaydet": ("research_study", "Not kaydedildi"),
    "gun_ozeti": ("executive_briefing", "Gün sonu özeti"),
    "sistem_durumu": ("media_os", "Sistem kaynakları"),
}


# ------------------------------------------------------------------ grounded live search
def _extract_json_array(text: str) -> list:
    match = re.search(r"\[\s*\{.*?\}\s*\]", text, re.S)
    if not match:
        return []
    try:
        parsed = json.loads(match.group(0))
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


async def grounded_search(query: str, kind: str = "search") -> dict:
    """Real live web search via Gemini's googleSearch grounding (no extra API key)."""
    if kind == "flight":
        instruction = (
            f"'{query}' için GÜNCEL uçak bileti seçeneklerini canlı aramayla bul. "
            "Sonra SADECE şu formatta bir JSON dizisi ver (en fazla 6 seçenek, en ucuzdan pahalıya sırala):\n"
            '[{"airline":"THY","depart":"08:15","arrive":"09:40","duration":"1s 25dk","price":"1.450 TL","note":"en ucuz"}]\n'
            "JSON'dan sonra tek cümlelik Türkçe öneri yaz."
        )
    else:
        instruction = (
            f"'{query}' konusunu canlı web aramasıyla araştır. "
            "Önce SADECE şu formatta bir JSON dizisi ver (en fazla 5 kaynak):\n"
            '[{"title":"...","snippet":"tek cümle özet","url":"https://..."}]\n'
            "JSON'dan sonra Türkçe 2-3 cümlelik hap özet yaz."
        )

    chat = (
        LlmChat(api_key=api_key(), session_id=f"search-{today_iso()}",
                system_message="Sen canlı web araştırma ajanısın. Türkçe yanıt verirsin, istenen JSON formatına harfiyen uyarsın.")
        .with_model(PROVIDER, MODEL)
        .with_tools([{"googleSearch": {}}])
    )

    buf = ""
    async for ev in chat.stream_message(UserMessage(text=instruction)):
        if isinstance(ev, TextDelta):
            buf += ev.content
        elif isinstance(ev, StreamDone):
            break

    rows = _extract_json_array(buf)
    summary = re.sub(r"\[\s*\{.*?\}\s*\]", "", buf, flags=re.S).strip()
    summary = re.sub(r"```\w*|```", "", summary).strip()

    out: dict[str, Any] = {"query": query, "kind": kind, "summary": summary[:1500]}
    if kind == "flight":
        out["flights"] = [{
            "airline": str(r.get("airline", "?")), "depart": str(r.get("depart", "")),
            "arrive": str(r.get("arrive", "")), "duration": str(r.get("duration", "")),
            "price": str(r.get("price", "")), "note": str(r.get("note") or "") or None,
        } for r in rows if isinstance(r, dict)][:6]
        out["results"] = []
    else:
        out["results"] = [{
            "title": str(r.get("title", "")), "snippet": str(r.get("snippet", "")),
            "url": str(r.get("url") or "") or None,
        } for r in rows if isinstance(r, dict)][:5]
        out["flights"] = []
    return out


# ------------------------------------------------------------------ memory
async def build_memory(session_id: str) -> str:
    """Cross-session context: who the user is, what they're working on, recent turns."""
    settings = await db.settings.find_one({"key": "settings"}) or {}
    projects = await db.projects.find({"status": {"$ne": "done"}}).to_list(15)
    tasks = await db.tasks.find({"status": {"$ne": "done"}}).sort("due", 1).to_list(15)
    recent = (
        await db.messages.find({"session_id": session_id})
        .sort("created_at", -1).to_list(12)
    )
    recent.reverse()

    parts = []
    if settings.get("rules"):
        parts.append(f"Kullanıcının özel çalışma kuralları: {settings['rules']}")
    if projects:
        parts.append("Takip edilen projeler/dersler: " + "; ".join(
            f"{p.get('name')} ({p.get('kind')}, %{p.get('progress', 0)}"
            + (f", teslim {p['deadline']}" if p.get("deadline") else "") + ")"
            for p in projects
        ))
    if tasks:
        parts.append("Bekleyen görevler: " + "; ".join(
            f"{t.get('title')}" + (f" (teslim {t['due']})" if t.get("due") else "") for t in tasks
        ))
    if recent:
        convo = "\n".join(
            f"{'Kullanıcı' if m.get('role') == 'user' else 'JARVIS'}: {str(m.get('content', ''))[:300]}"
            for m in recent
        )
        parts.append("Bu oturumdaki son konuşmalar (hatırla, tekrar sorma):\n" + convo)
    return "\n".join(parts) if parts else "Henüz kayıtlı proje veya geçmiş konuşma yok."


# ------------------------------------------------------------------ tool dispatch
async def dispatch(name: str, args: dict) -> dict:
    """Execute one sub-agent for real and return a JSON-serialisable result."""
    try:
        if name == "web_arastir":
            kind = args.get("kind") or "search"
            data = await grounded_search(str(args.get("query", "")), kind)
            from models.schemas import WebScan
            scan = WebScan(query=data["query"], kind=kind, summary=data["summary"],
                           results=data["results"], flights=data["flights"])
            await db.webscans.insert_one(scan.model_dump())
            await log_activity("web_browser", "web_scan",
                               f"Web taraması: {data['query']}", data["summary"])
            return {**data, "scan_id": scan.id}

        if name == "muzik_cal":
            query = str(args.get("query", ""))
            tracks = await youtube_search(query, limit=5)
            if not tracks:
                return {"ok": False, "error": "YouTube'da sonuç bulamadım."}
            await log_activity("media_os", "media_play",
                               f"Müzik başlatıldı: {tracks[0]['title']}", query)
            return {"ok": True, "playing": tracks[0], "alternatives": tracks[1:]}

        if name == "muzik_durdur":
            await log_activity("media_os", "media_stop", "Müzik durduruldu")
            return {"ok": True, "stopped": True}

        if name == "terminal_calistir":
            res = await run_command(str(args.get("command", "")))
            await log_activity("dev_core", "terminal",
                               f"Komut: {res['command']}", (res["stdout"] or res["stderr"])[:800])
            return res

        if name == "proje_tara":
            res = await scan_workspace(str(args.get("path") or "/app"))
            await log_activity("dev_core", "project_scan",
                               f"Proje tarandı: {res['path']} ({res['branch']})",
                               f"{len(res['commits'])} commit, {len(res['dirty'])} değişmiş dosya")
            return res

        if name == "gorev_ekle":
            from models.schemas import Task
            task = Task(title=str(args.get("title", "")),
                        priority=args.get("priority") if args.get("priority") in ("low", "normal", "high") else "normal",
                        due=args.get("due") or None)
            await db.tasks.insert_one(task.model_dump())
            await log_activity("executive_briefing", "task_add", f"Görev eklendi: {task.title}")
            return {"ok": True, "task": {"id": task.id, "title": task.title, "due": task.due}}

        if name == "gorev_tamamla":
            from datetime import datetime, timezone
            title = str(args.get("title", ""))
            doc = await db.tasks.find_one({"title": {"$regex": re.escape(title), "$options": "i"},
                                           "status": {"$ne": "done"}})
            if not doc:
                return {"ok": False, "error": f"'{title}' ile eşleşen bekleyen görev bulamadım."}
            await db.tasks.update_one({"id": doc["id"]}, {"$set": {
                "status": "done", "completed_at": datetime.now(timezone.utc)}})
            await log_activity("executive_briefing", "task_done", f"Görev tamamlandı: {doc['title']}")
            return {"ok": True, "completed": doc["title"]}

        if name == "proje_durumu":
            projects = await db.projects.find().to_list(50)
            tasks = await db.tasks.find({"status": {"$ne": "done"}}).sort("due", 1).to_list(50)
            return {
                "projects": [{"name": p.get("name"), "kind": p.get("kind"), "status": p.get("status"),
                              "progress": p.get("progress"), "next_step": p.get("next_step"),
                              "deadline": p.get("deadline")} for p in projects],
                "pending_tasks": [{"title": t.get("title"), "priority": t.get("priority"),
                                   "due": t.get("due")} for t in tasks],
            }

        if name == "not_kaydet":
            from models.schemas import Note
            note = Note(title=str(args.get("title", "")), content=str(args.get("content", "")),
                        tags=[str(t) for t in (args.get("tags") or [])], source="research")
            await db.notes.insert_one(note.model_dump())
            await log_activity("research_study", "note_save", f"Not kaydedildi: {note.title}")
            return {"ok": True, "note_id": note.id, "title": note.title}

        if name == "gun_ozeti":
            from lib.activity import today_activities
            acts = await today_activities(120)
            done = await db.tasks.find({"status": "done"}).to_list(100)
            pending = await db.tasks.find({"status": {"$ne": "done"}}).to_list(100)
            return {
                "day": today_iso(),
                "activities": [{"agent": a.get("agent"), "kind": a.get("kind"),
                                "summary": a.get("summary")} for a in acts],
                "completed_tasks": [t.get("title") for t in done],
                "pending_tasks": [t.get("title") for t in pending],
            }

        if name == "sistem_durumu":
            from lib.metrics import collect_metrics
            return await collect_metrics()

        return {"ok": False, "error": f"Bilinmeyen araç: {name}"}
    except Exception as exc:
        logger.exception("dispatch(%s) failed", name)
        return {"ok": False, "error": f"{name} aracı hata verdi: {exc}"}


# ------------------------------------------------------------------ orchestrator
async def orchestrate(session_id: str, text: str, image_base64: Optional[str] = None) -> dict:
    """One full turn: route to sub-agents, execute for real, narrate back in Turkish."""
    settings = await db.settings.find_one({"key": "settings"}) or {}
    memory = await build_memory(session_id)
    system = PERSONA.format(
        user_name=settings.get("user_name", "Patron"), today=today_iso(), memory=memory
    )

    chat = (
        LlmChat(api_key=api_key(), session_id=f"{session_id}-{today_iso()}", system_message=system)
        .with_model(PROVIDER, MODEL)
        .with_tools(TOOLS, tool_choice="auto")
    )

    attachments = []
    if image_base64:
        attachments.append(ImageContent(image_base64=image_base64))

    user_msg: Optional[UserMessage] = UserMessage(
        text=text or "Bu görselde ne var? Doğrudan içeriğe gir.",
        file_contents=attachments or None,
    )

    reply = ""
    actions: list[dict] = []
    guard = 0

    while guard < 5:
        guard += 1
        pending = []
        async for ev in chat.stream_message(user_msg):
            if isinstance(ev, TextDelta):
                reply += ev.content
            elif isinstance(ev, ToolCallReady):
                pending.append(ev.tool_call)
            elif isinstance(ev, StreamDone):
                break
        if not pending:
            break
        for tc in pending:
            args = tc.arguments if isinstance(tc.arguments, dict) else {}
            result = await dispatch(tc.name, args)
            agent, label = TOOL_AGENT.get(tc.name, ("companion_vision", tc.name))
            actions.append({"agent": agent, "tool": tc.name, "label": label, "payload": result})
            chat.add_tool_result(tc.id, json.dumps(result, default=str, ensure_ascii=False))
        user_msg = None

    agent_id = actions[-1]["agent"] if actions else "companion_vision"
    if image_base64 and not actions:
        agent_id = "companion_vision"

    return {"reply": reply.strip() or "Yanıt üretemedim, tekrar dener misin?",
            "agent": agent_id, "actions": actions}
