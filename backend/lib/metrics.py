"""Real system telemetry for the top metric bar — psutil, not fabricated numbers."""

import time

import psutil

from lib.dates import today_iso
from lib.db import db

GB = 1024 ** 3
_BOOT = psutil.boot_time()


async def collect_metrics() -> dict:
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    cpu = psutil.cpu_percent(interval=0.15)

    active_projects = await db.projects.count_documents({"status": "active"})
    running_tasks = await db.tasks.count_documents({"status": {"$in": ["pending", "doing"]}})
    today_count = await db.activities.count_documents({"day": today_iso()})
    last = await db.webscans.find().sort("created_at", -1).to_list(1)

    last_scan = None
    if last:
        doc = last[0]
        flights = doc.get("flights") or []
        if flights:
            cheapest = flights[0]
            last_scan = f"{doc.get('query')} → {cheapest.get('airline')} {cheapest.get('price')}"
        else:
            last_scan = str(doc.get("query"))

    return {
        "cpu_percent": round(cpu, 1),
        "ram_used_gb": round((mem.total - mem.available) / GB, 2),
        "ram_total_gb": round(mem.total / GB, 2),
        "ram_percent": round(mem.percent, 1),
        "disk_percent": round(disk.percent, 1),
        "uptime_hours": round((time.time() - _BOOT) / 3600, 1),
        "process_count": len(psutil.pids()),
        "active_projects": active_projects,
        "running_tasks": running_tasks,
        "last_scan": last_scan,
        "today_activities": today_count,
    }
