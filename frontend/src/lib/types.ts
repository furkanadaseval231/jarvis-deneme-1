// Hand-written mirrors of the Pydantic models in backend/models/schemas.py.
// Nothing infers across the Python boundary — when a model changes, change it here too.

export type AgentId =
  | "companion_vision"
  | "web_browser"
  | "media_os"
  | "dev_core"
  | "research_study"
  | "executive_briefing";

export interface AgentAction {
  agent: AgentId;
  tool: string;
  label: string;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  agent: AgentId;
  has_image: boolean;
  actions: AgentAction[];
  created_at: string;
}

export interface ChatResponse {
  reply: ChatMessage;
  actions: AgentAction[];
}

export interface WebResult {
  title: string;
  snippet: string;
  url: string | null;
}

export interface FlightOption {
  airline: string;
  depart: string;
  arrive: string;
  duration: string;
  price: string;
  note: string | null;
}

export interface WebScan {
  id: string;
  query: string;
  kind: "search" | "flight";
  summary: string;
  results: WebResult[];
  flights: FlightOption[];
  created_at: string;
}

export interface Track {
  video_id: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
}

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  blocked: boolean;
  needs_confirm: boolean;
  reason: string | null;
}

export interface Project {
  id: string;
  name: string;
  kind: "project" | "course";
  status: "active" | "paused" | "done";
  progress: number;
  next_step: string;
  deadline: string | null;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  project_id: string | null;
  status: "pending" | "doing" | "done";
  priority: "low" | "normal" | "high";
  due: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: "research" | "manual";
  created_at: string;
}

export interface Activity {
  id: string;
  agent: AgentId;
  kind: string;
  summary: string;
  detail: string;
  day: string;
  created_at: string;
}

export interface SystemMetrics {
  cpu_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  disk_percent: number;
  uptime_hours: number;
  process_count: number;
  active_projects: number;
  running_tasks: number;
  last_scan: string | null;
  today_activities: number;
}

export interface Briefing {
  id: string;
  day: string;
  report: string;
  activity_count: number;
  completed_tasks: number;
  pending_tasks: number;
  created_at: string;
}

export interface Settings {
  user_name: string;
  voice_enabled: boolean;
  voice: string;
  auto_speak: boolean;
  watch_dirs: string[];
  rules: string;
}

export interface WorkspaceScan {
  path: string;
  branch: string;
  commits: { hash: string; when: string; subject: string }[];
  dirty: string[];
  tree: string[];
}

export interface TrVoice {
  name: string;
  gender: string;
  locale: string;
}

export const AGENT_META: Record<AgentId, { label: string; short: string; tone: string }> = {
  companion_vision: {
    label: "Sohbet & Görsel Ajanı",
    short: "SOHBET",
    tone: "border-cyan-500/40 bg-cyan-500/15 text-cyan-200",
  },
  web_browser: {
    label: "Web & Bilet Ajanı",
    short: "WEB",
    tone: "border-blue-500/40 bg-blue-500/15 text-blue-200",
  },
  media_os: {
    label: "Medya & Sistem Ajanı",
    short: "MEDYA",
    tone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  },
  dev_core: {
    label: "Dev Core Ajanı",
    short: "DEV",
    tone: "border-violet-500/40 bg-violet-500/15 text-violet-200",
  },
  research_study: {
    label: "Araştırma Ajanı",
    short: "ARAŞTIRMA",
    tone: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  },
  executive_briefing: {
    label: "Brief & Rapor Ajanı",
    short: "BRIEF",
    tone: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  },
};
