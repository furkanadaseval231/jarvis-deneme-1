"""Pydantic v2 request/response models. Each one has a hand-written TS twin in frontend/src/lib/types.ts."""

import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field

AgentId = Literal[
    "companion_vision",
    "web_browser",
    "media_os",
    "dev_core",
    "research_study",
    "executive_briefing",
]


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- chat / orchestrator
class AgentAction(BaseModel):
    agent: AgentId
    tool: str
    label: str
    payload: dict = Field(default_factory=dict)


class ChatMessage(BaseModel):
    id: str = Field(default_factory=_uid)
    session_id: str
    role: Literal["user", "assistant"]
    content: str
    agent: AgentId = "companion_vision"
    has_image: bool = False
    actions: list[AgentAction] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)


class ChatRequest(BaseModel):
    session_id: str = "default"
    text: str
    image_base64: Optional[str] = None


class ChatResponse(BaseModel):
    reply: ChatMessage
    actions: list[AgentAction] = Field(default_factory=list)


# ---------------------------------------------------------------- voice
class SpeakRequest(BaseModel):
    text: str
    voice: str = "tr-TR-AhmetNeural"


# ---------------------------------------------------------------- web agent
class WebResult(BaseModel):
    title: str
    snippet: str
    url: Optional[str] = None


class FlightOption(BaseModel):
    airline: str
    depart: str
    arrive: str
    duration: str
    price: str
    note: Optional[str] = None


class WebScan(BaseModel):
    id: str = Field(default_factory=_uid)
    query: str
    kind: Literal["search", "flight"] = "search"
    summary: str = ""
    results: list[WebResult] = Field(default_factory=list)
    flights: list[FlightOption] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)


class WebSearchRequest(BaseModel):
    query: str
    kind: Literal["search", "flight"] = "search"


# ---------------------------------------------------------------- media agent
class Track(BaseModel):
    video_id: str
    title: str
    channel: str = ""
    duration: str = ""
    thumbnail: str = ""


class MediaSearchRequest(BaseModel):
    query: str


# ---------------------------------------------------------------- terminal
class CommandRequest(BaseModel):
    command: str
    confirm: bool = False


class CommandResult(BaseModel):
    command: str
    stdout: str = ""
    stderr: str = ""
    exit_code: int = 0
    blocked: bool = False
    needs_confirm: bool = False
    reason: Optional[str] = None


# ---------------------------------------------------------------- workspace
class Project(BaseModel):
    id: str = Field(default_factory=_uid)
    name: str
    kind: Literal["project", "course"] = "project"
    status: Literal["active", "paused", "done"] = "active"
    progress: int = 0
    next_step: str = ""
    deadline: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


class ProjectCreate(BaseModel):
    name: str
    kind: Literal["project", "course"] = "project"
    next_step: str = ""
    deadline: Optional[str] = None
    progress: int = 0


class ProjectUpdate(BaseModel):
    status: Optional[Literal["active", "paused", "done"]] = None
    progress: Optional[int] = None
    next_step: Optional[str] = None
    deadline: Optional[str] = None


class Task(BaseModel):
    id: str = Field(default_factory=_uid)
    title: str
    project_id: Optional[str] = None
    status: Literal["pending", "doing", "done"] = "pending"
    priority: Literal["low", "normal", "high"] = "normal"
    due: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    completed_at: Optional[datetime] = None


class TaskCreate(BaseModel):
    title: str
    priority: Literal["low", "normal", "high"] = "normal"
    due: Optional[str] = None
    project_id: Optional[str] = None


class TaskUpdate(BaseModel):
    status: Optional[Literal["pending", "doing", "done"]] = None
    priority: Optional[Literal["low", "normal", "high"]] = None
    due: Optional[str] = None


class Note(BaseModel):
    id: str = Field(default_factory=_uid)
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    source: Literal["research", "manual"] = "manual"
    created_at: datetime = Field(default_factory=_now)


class NoteCreate(BaseModel):
    title: str
    content: str
    tags: list[str] = Field(default_factory=list)
    source: Literal["research", "manual"] = "manual"


class ResearchRequest(BaseModel):
    topic: str


class Activity(BaseModel):
    id: str = Field(default_factory=_uid)
    agent: AgentId
    kind: str
    summary: str
    detail: str = ""
    day: str = ""
    created_at: datetime = Field(default_factory=_now)


# ---------------------------------------------------------------- system / briefing
class SystemMetrics(BaseModel):
    cpu_percent: float
    ram_used_gb: float
    ram_total_gb: float
    ram_percent: float
    disk_percent: float
    uptime_hours: float
    process_count: int
    active_projects: int
    running_tasks: int
    last_scan: Optional[str] = None
    today_activities: int


class Briefing(BaseModel):
    id: str = Field(default_factory=_uid)
    day: str
    report: str
    activity_count: int
    completed_tasks: int
    pending_tasks: int
    kind: Literal["evening", "morning"] = "evening"
    spoken: bool = False
    created_at: datetime = Field(default_factory=_now)


class Settings(BaseModel):
    user_name: str = "Patron"
    voice_enabled: bool = True
    voice: str = "tr-TR-AhmetNeural"
    auto_speak: bool = True
    wake_word_enabled: bool = False
    morning_brief_enabled: bool = True
    commit_watch_enabled: bool = True
    watch_dirs: list[str] = Field(default_factory=lambda: ["/app"])
    rules: str = ""


class SettingsUpdate(BaseModel):
    user_name: Optional[str] = None
    voice_enabled: Optional[bool] = None
    voice: Optional[str] = None
    auto_speak: Optional[bool] = None
    wake_word_enabled: Optional[bool] = None
    morning_brief_enabled: Optional[bool] = None
    commit_watch_enabled: Optional[bool] = None
    watch_dirs: Optional[list[str]] = None
    rules: Optional[str] = None


# ---------------------------------------------------------------- code patches
class Patch(BaseModel):
    id: str = Field(default_factory=_uid)
    path: str
    find: str
    replace: str
    explanation: str = ""
    diff: str = ""
    line: int = 0
    occurrences: int = 1
    status: Literal["pending", "applied", "rejected", "failed"] = "pending"
    backup_path: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)
    applied_at: Optional[datetime] = None


class PatchCreate(BaseModel):
    path: str
    find: str
    replace: str
    explanation: str = ""


# ---------------------------------------------------------------- notifications
class Notification(BaseModel):
    id: str = Field(default_factory=_uid)
    kind: Literal["commit", "morning_brief", "patch", "system"] = "system"
    title: str
    body: str = ""
    read: bool = False
    meta: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=_now)


class CommitScanResult(BaseModel):
    checked: int
    new_commits: int
    disabled: bool = False
