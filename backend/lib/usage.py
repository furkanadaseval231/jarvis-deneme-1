"""LLM spend tracking and the economy/quality model policy.

Every LLM call records its REAL token counts (emergentintegrations hands them back on
StreamDone.usage), so the credit gauge is computed from actual usage rather than guesses.

Important honesty note: Emergent exposes no API for the key's authoritative remaining
balance, so this is the spend THIS APP has caused, measured against a cap the user sets in
Ayarlar. The UI labels it as an estimate. When the provider itself reports the budget as
exhausted we flip a hard flag so the gauge tells the truth regardless of the estimate.
"""

import logging
from datetime import datetime, timezone

from lib.dates import today_iso
from lib.db import db

logger = logging.getLogger(__name__)

PROVIDER = "gemini"
QUALITY_MODEL = "gemini-3.1-pro-preview"
ECONOMY_MODEL = "gemini-2.5-flash"

# Credits per 1M tokens: (input, output). Flash tier is ~7x cheaper on input and
# ~5x cheaper on output than the Pro tier.
MODEL_PRICES: dict[str, tuple[float, float]] = {
    "gemini-3.1-pro-preview": (2.00, 12.00),
    "gemini-2.5-pro": (2.00, 12.00),
    "gemini-3.8-flash": (0.30, 2.50),
    "gemini-3.7-flash": (0.30, 2.50),
    "gemini-3.6-flash": (0.30, 2.50),
    "gemini-3.5-flash": (0.30, 2.50),
    "gemini-3-flash-preview": (0.30, 2.50),
    "gemini-2.5-flash": (0.30, 2.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
}
FLASH_FALLBACK = (0.30, 2.50)

SELECTABLE_MODELS = [
    {"id": "gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro (en yetenekli)", "tier": "quality"},
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash (hızlı, ucuz)", "tier": "economy"},
    {"id": "gemini-2.5-flash", "label": "Gemini 2.5 Flash (ucuz, dengeli)", "tier": "economy"},
    {"id": "gemini-2.5-flash-lite", "label": "Gemini 2.5 Flash Lite (en ucuz)", "tier": "economy"},
]

# Each extra googleSearch grounding request costs a small flat amount on top of tokens.
GROUNDING_COST = 0.014


def price_for(model: str) -> tuple[float, float]:
    return MODEL_PRICES.get(model, FLASH_FALLBACK)


def estimate_cost(model: str, input_tokens: int, output_tokens: int, grounded: bool = False) -> float:
    inp, out = price_for(model)
    cost = (input_tokens / 1_000_000) * inp + (output_tokens / 1_000_000) * out
    if grounded:
        cost += GROUNDING_COST
    return round(cost, 6)


async def record_usage(
    model: str, usage, purpose: str, grounded: bool = False
) -> float:
    """Persist one call's real token usage. Never raises — accounting must not break a reply."""
    try:
        input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
        output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        cost = estimate_cost(model, input_tokens, output_tokens, grounded)
        await db.llm_usage.insert_one({
            "model": model,
            "purpose": purpose,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "grounded": grounded,
            "cost": cost,
            "day": today_iso(),
            "created_at": datetime.now(timezone.utc),
        })
        return cost
    except Exception:
        logger.exception("record_usage failed (model=%s purpose=%s)", model, purpose)
        return 0.0


async def mark_exhausted(exhausted: bool) -> None:
    """Latch the provider's own 'budget exceeded' signal, independent of our estimate."""
    await db.llm_state.update_one(
        {"key": "budget"},
        {"$set": {"exhausted": exhausted, "at": datetime.now(timezone.utc)}},
        upsert=True,
    )


async def summary() -> dict:
    """Spend gauge: total + today, against the user's cap, with a per-model breakdown."""
    settings = await db.settings.find_one({"key": "settings"}) or {}
    cap = float(settings.get("credit_cap") or 1.0)

    rows = await db.llm_usage.aggregate([
        {"$group": {
            "_id": None,
            "cost": {"$sum": "$cost"},
            "calls": {"$sum": 1},
            "input_tokens": {"$sum": "$input_tokens"},
            "output_tokens": {"$sum": "$output_tokens"},
        }}
    ]).to_list(1)
    total = rows[0] if rows else {}

    today_rows = await db.llm_usage.aggregate([
        {"$match": {"day": today_iso()}},
        {"$group": {"_id": None, "cost": {"$sum": "$cost"}, "calls": {"$sum": 1}}},
    ]).to_list(1)
    today = today_rows[0] if today_rows else {}

    per_model = await db.llm_usage.aggregate([
        {"$group": {"_id": "$model", "cost": {"$sum": "$cost"}, "calls": {"$sum": 1}}},
        {"$sort": {"cost": -1}},
    ]).to_list(10)

    state_doc = await db.llm_state.find_one({"key": "budget"}) or {}
    exhausted = bool(state_doc.get("exhausted"))

    spent = round(float(total.get("cost") or 0.0), 4)
    percent = round(min(100.0, (spent / cap) * 100), 1) if cap > 0 else 0.0

    if exhausted:
        state = "exceeded"
    elif percent >= 95:
        state = "critical"
    elif percent >= 80:
        state = "warn"
    else:
        state = "ok"

    return {
        "spent": spent,
        "cap": round(cap, 4),
        "remaining": round(max(0.0, cap - spent), 4),
        "percent": percent,
        "state": state,
        "exhausted": exhausted,
        "calls": int(total.get("calls") or 0),
        "input_tokens": int(total.get("input_tokens") or 0),
        "output_tokens": int(total.get("output_tokens") or 0),
        "today_spent": round(float(today.get("cost") or 0.0), 4),
        "today_calls": int(today.get("calls") or 0),
        "per_model": [
            {"model": str(r["_id"]), "cost": round(float(r["cost"]), 4), "calls": int(r["calls"])}
            for r in per_model
            if r.get("_id")
        ],
    }


# ------------------------------------------------------------------ model policy
# Words that mean the turn will need real reasoning or tool orchestration. A simple
# greeting or a bit of venting does not — that is what the cheap model is for.
HEAVY_HINTS = [
    "kod", "hata", "debug", "düzelt", "refactor", "mimari", "terminal", "komut",
    "bilet", "uçak", "fiyat", "ara", "araştır", "analiz", "rapor", "özet", "brief",
    "commit", "git", "yama", "patch", "dosya", "script", "betik", "optimize",
    "algoritma", "veritabanı", "api", "deploy", "test", "çalıştır", "aç", "kapat",
    "görev", "proje", "ders", "sınav", "teslim", "not kaydet", "müzik", "şarkı",
    "youtube", "sistem", "cpu", "ram",
]


def choose_model(text: str, has_image: bool, settings: dict) -> tuple[str, str]:
    """Return (model_id, reason). Vision and tool-heavy turns need the quality tier."""
    mode = str(settings.get("model_mode") or "auto")
    quality = str(settings.get("quality_model") or QUALITY_MODEL)
    economy = str(settings.get("economy_model") or ECONOMY_MODEL)

    if mode == "quality":
        return quality, "ayar: her zaman kaliteli model"
    if mode == "economy":
        # Vision still needs the quality tier; flash image reasoning is too weak for
        # "which line is the bug" screenshots, which is the app's headline feature.
        if has_image:
            return quality, "görsel analizi kaliteli model gerektiriyor"
        return economy, "ayar: her zaman ekonomi modeli"

    # auto
    if has_image:
        return quality, "görsel analizi"
    low = (text or "").lower()
    if any(hint in low for hint in HEAVY_HINTS):
        return quality, "teknik/araç gerektiren istek"
    if len(low) > 220:
        return quality, "uzun ve karmaşık istek"
    return economy, "basit sohbet"
