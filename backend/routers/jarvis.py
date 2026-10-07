"""Core JARVIS routes: orchestrator chat + Turkish Edge-TTS voice output."""

import io
import logging

import edge_tts
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from lib.activity import clean, log_activity
from lib.brain import friendly_llm_error, orchestrate
from lib.db import db
from models.schemas import ChatMessage, ChatRequest, ChatResponse, SpeakRequest

router = APIRouter(tags=["jarvis"])
logger = logging.getLogger(__name__)


@router.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not req.text.strip() and not req.image_base64:
        raise HTTPException(status_code=422, detail="Mesaj boş olamaz.")

    user_msg = ChatMessage(
        session_id=req.session_id, role="user",
        content=req.text or "[görsel yüklendi]", has_image=bool(req.image_base64),
    )
    await db.messages.insert_one(user_msg.model_dump())

    try:
        result = await orchestrate(req.session_id, req.text, req.image_base64)
    except Exception as exc:
        logger.exception("orchestrate failed")
        raise HTTPException(status_code=502, detail=friendly_llm_error(exc)) from exc

    reply = ChatMessage(
        session_id=req.session_id, role="assistant", content=result["reply"],
        agent=result["agent"], actions=result["actions"],
    )
    await db.messages.insert_one(reply.model_dump())
    await log_activity(
        result["agent"], "chat",
        (req.text or "Görsel analizi")[:120],
        result["reply"][:800],
    )
    return ChatResponse(reply=reply, actions=reply.actions)


@router.get("/chat/history", response_model=list[ChatMessage])
async def history(session_id: str = "default", limit: int = 60):
    rows = (
        await db.messages.find({"session_id": session_id})
        .sort("created_at", -1).to_list(limit)
    )
    rows.reverse()
    return [ChatMessage(**clean(r)) for r in rows]


@router.delete("/chat/history")
async def clear_history(session_id: str = "default"):
    res = await db.messages.delete_many({"session_id": session_id})
    return {"deleted": res.deleted_count}


@router.post("/voice/speak")
async def speak(req: SpeakRequest):
    """Turkish TTS via Edge-TTS (tr-TR-AhmetNeural). Returns an mp3 the browser plays."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Okunacak metin boş.")

    # Strip markdown noise so the voice doesn't read asterisks and backticks aloud.
    import re
    clean_text = re.sub(r"```[\s\S]*?```", " kod bloğu ", text)
    clean_text = re.sub(r"[*_`#>|]", "", clean_text)
    clean_text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", clean_text)
    clean_text = re.sub(r"\s+", " ", clean_text).strip()[:2500]

    try:
        comm = edge_tts.Communicate(clean_text, req.voice)
        buf = io.BytesIO()
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        data = buf.getvalue()
        if not data:
            raise RuntimeError("Edge-TTS boş ses döndü.")
    except Exception as exc:
        logger.exception("edge-tts failed")
        raise HTTPException(
            status_code=503,
            detail=f"Edge-TTS sesi üretemedi: {exc}. Tarayıcı sesine geçiyorum.",
        ) from exc

    return StreamingResponse(
        io.BytesIO(data),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/voice/voices")
async def voices():
    """Turkish voices available from Edge-TTS, so Settings can offer real options."""
    try:
        all_voices = await edge_tts.list_voices()
        tr = [
            {"name": v["ShortName"], "gender": v.get("Gender", ""), "locale": v.get("Locale", "")}
            for v in all_voices
            if str(v.get("Locale", "")).startswith("tr")
        ]
        return {"voices": tr, "available": True}
    except Exception as exc:
        logger.warning("list_voices failed: %s", exc)
        return {"voices": [{"name": "tr-TR-AhmetNeural", "gender": "Male", "locale": "tr-TR"}],
                "available": False}
