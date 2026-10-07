"""Idempotent bootstrap: settings + a starter workspace so the panels open with content.

Run: cd /app/backend && python seed.py
Deadlines are anchored to the SERVER's today (lib/dates.today_iso), never hardcoded — a
fixed date would read as "overdue" the moment the pod clock moves past it.
Operational data (activities, web scans, terminal output, briefings) is NEVER seeded —
that is produced only by real JARVIS actions.
"""

import asyncio
from datetime import date, timedelta

from lib.db import db, ensure_indexes
from models.schemas import Project, Settings, Task


def in_days(days: int) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def projects() -> list[dict]:
    return [
        {"name": "JARVIS AI OS", "kind": "project", "progress": 70,
         "next_step": "Sesli komut akışını uçtan uca test et", "deadline": None},
        {"name": "Bitirme Projesi — Mobil Uygulama", "kind": "project", "progress": 35,
         "next_step": "API katmanını yaz", "deadline": in_days(45)},
        {"name": "Veri Yapıları ve Algoritmalar", "kind": "course", "progress": 60,
         "next_step": "Graf algoritmaları tekrarı", "deadline": in_days(21)},
        {"name": "İşletim Sistemleri", "kind": "course", "progress": 45,
         "next_step": "Scheduling ödevini bitir", "deadline": in_days(6)},
    ]


def tasks() -> list[dict]:
    return [
        {"title": "İşletim Sistemleri scheduling ödevini teslim et", "priority": "high",
         "due": in_days(6)},
        {"title": "Bitirme projesi API uç noktalarını tasarla", "priority": "high",
         "due": in_days(12)},
        {"title": "Graf algoritmaları için 20 soru çöz", "priority": "normal", "due": None},
        {"title": "JARVIS ses motorunu Türkçe telaffuz için ince ayar yap", "priority": "normal",
         "due": None},
    ]


async def main() -> None:
    await ensure_indexes()

    if not await db.settings.find_one({"key": "settings"}):
        await db.settings.insert_one({"key": "settings", **Settings().model_dump()})
        print("settings: created")
    else:
        print("settings: already present")

    for spec in projects():
        existing = await db.projects.find_one({"name": spec["name"]})
        if existing:
            # Re-anchor a stale deadline so the radar never shows a seeded row as overdue.
            if spec["deadline"] and str(existing.get("deadline") or "") < date.today().isoformat():
                await db.projects.update_one(
                    {"id": existing["id"]}, {"$set": {"deadline": spec["deadline"]}}
                )
                print(f"project: {spec['name']} deadline re-anchored -> {spec['deadline']}")
            continue
        await db.projects.insert_one(Project(**spec).model_dump())
        print(f"project: {spec['name']}")

    for spec in tasks():
        existing = await db.tasks.find_one({"title": spec["title"]})
        if existing:
            if spec["due"] and str(existing.get("due") or "") < date.today().isoformat():
                await db.tasks.update_one({"id": existing["id"]}, {"$set": {"due": spec["due"]}})
                print(f"task: {spec['title'][:40]}... due re-anchored -> {spec['due']}")
            continue
        await db.tasks.insert_one(Task(**spec).model_dump())
        print(f"task: {spec['title']}")

    print("seed complete")


if __name__ == "__main__":
    asyncio.run(main())
