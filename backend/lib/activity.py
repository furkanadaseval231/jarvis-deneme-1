"""Activity log — the single source of truth the Executive Briefing Agent reports from.

Every autonomous action JARVIS takes writes one row here, so the end-of-day report is
built from real events, never invented.
"""

from datetime import datetime, timezone

from lib.dates import today_iso
from lib.db import db
from models.schemas import Activity


async def log_activity(agent: str, kind: str, summary: str, detail: str = "") -> Activity:
    act = Activity(agent=agent, kind=kind, summary=summary, detail=detail[:4000], day=today_iso())
    await db.activities.insert_one(act.model_dump())
    return act


def as_utc(value):
    """Motor hands back naive datetimes; make them aware so Pydantic emits an offset."""
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def clean(doc: dict) -> dict:
    """Drop Mongo's _id and normalise every datetime to aware UTC."""
    out = {k: as_utc(v) for k, v in doc.items() if k != "_id"}
    return out


async def today_activities(limit: int = 200) -> list[dict]:
    rows = (
        await db.activities.find({"day": today_iso()})
        .sort("created_at", -1)
        .to_list(limit)
    )
    return [clean(r) for r in rows]
