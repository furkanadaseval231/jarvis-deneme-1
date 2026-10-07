// Right rail: deadline radar, pending task queue and the live autonomous event feed.

import { useQuery } from "@tanstack/react-query";
import { AlarmClock, ListChecks, Radio } from "lucide-react";

import { apiGet } from "@/lib/api";
import { AGENT_META } from "@/lib/types";
import type { Activity, Project, Task } from "@/lib/types";

function daysLeft(date: string): number {
  const target = new Date(`${date}T00:00:00Z`).getTime();
  const now = Date.now();
  return Math.ceil((target - now) / 86_400_000);
}

export default function SidePanels() {
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiGet<Project[]>("/projects") });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => apiGet<Task[]>("/tasks") });
  const activities = useQuery({
    queryKey: ["activities"],
    queryFn: () => apiGet<Activity[]>("/activities?limit=25"),
    refetchInterval: 10000,
  });

  const deadlines = [
    ...(projects.data ?? [])
      .filter((p) => p.deadline && p.status !== "done")
      .map((p) => ({ id: p.id, label: p.name, date: p.deadline as string, tag: p.kind === "course" ? "DERS" : "PROJE" })),
    ...(tasks.data ?? [])
      .filter((t) => t.due && t.status !== "done")
      .map((t) => ({ id: t.id, label: t.title, date: t.due as string, tag: "GÖREV" })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const pending = (tasks.data ?? []).filter((t) => t.status !== "done").slice(0, 6);

  return (
    <aside
      className="thin-scroll flex w-full shrink-0 flex-col gap-3 overflow-y-auto xl:w-[352px]"
      data-testid="side-panels"
    >
      <section className="glass-panel rounded-xl p-3" data-testid="deadline-radar">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <AlarmClock size={15} className="text-rose-400" />
          Yaklaşan Teslimler
        </h3>
        <div className="space-y-1.5">
          {deadlines.slice(0, 6).map((d) => {
            const left = daysLeft(d.date);
            const urgent = left <= 7;
            return (
              <div
                key={`${d.tag}-${d.id}`}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5"
                data-testid={`deadline-item-${d.id}`}
              >
                <span className="shrink-0 rounded border border-slate-600/50 px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider text-slate-400">
                  {d.tag}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">{d.label}</span>
                <span
                  className={`shrink-0 font-mono text-[0.65rem] ${
                    urgent ? "text-rose-300" : "text-slate-500"
                  }`}
                >
                  {left < 0 ? "gecikti" : left === 0 ? "bugün" : `${left}g`}
                </span>
              </div>
            );
          })}
          {deadlines.length === 0 && (
            <p className="text-xs text-slate-500">
              {projects.isError ? "Veri yüklenemedi." : "Yaklaşan teslim yok."}
            </p>
          )}
        </div>
      </section>

      <section className="glass-panel rounded-xl p-3" data-testid="pending-tasks-panel">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <ListChecks size={15} className="text-cyan-400" />
          Bekleyen Görevler
        </h3>
        <div className="space-y-1">
          {pending.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 text-xs text-slate-300"
              data-testid={`pending-task-${t.id}`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  t.priority === "high" ? "bg-rose-400" : "bg-cyan-400"
                }`}
              />
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.due && <span className="shrink-0 text-[0.62rem] text-slate-600">{t.due}</span>}
            </div>
          ))}
          {pending.length === 0 && (
            <p className="text-xs text-slate-500">
              {tasks.isError ? "Veri yüklenemedi." : "Bekleyen görev yok."}
            </p>
          )}
        </div>
      </section>

      <section className="glass-panel flex min-h-[180px] flex-1 flex-col rounded-xl p-3" data-testid="live-log-panel">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Radio size={15} className="text-emerald-400" />
          Otonom İşlem Akışı
          <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_#22c55e]" />
        </h3>
        <div className="thin-scroll min-h-0 flex-1 space-y-1 overflow-y-auto" aria-live="polite">
          {(activities.data ?? []).map((a) => {
            const meta = AGENT_META[a.agent] ?? AGENT_META.companion_vision;
            return (
              <div
                key={a.id}
                className="flex items-start gap-2 py-1"
                data-testid={`log-row-${a.id}`}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1 py-0.5 font-mono text-[0.5rem] tracking-wider ${meta.tone}`}
                >
                  {meta.short}
                </span>
                <span className="min-w-0 flex-1 text-[0.72rem] leading-snug text-slate-400">
                  {a.summary}
                </span>
                <span className="shrink-0 font-mono text-[0.58rem] text-slate-700">
                  {new Date(a.created_at).toLocaleTimeString("tr-TR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })}
          {activities.data?.length === 0 && (
            <p className="text-xs text-slate-500">
              Henüz otonom işlem yok. Bir komut ver, akış buradan canlı aksın.
            </p>
          )}
          {activities.isError && (
            <p className="text-xs text-amber-400">Akış kesildi — arka uca ulaşamıyorum.</p>
          )}
        </div>
      </section>
    </aside>
  );
}
