// Dev Core surface: tracked projects/courses, task board, and a real git workspace scan.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, GitBranch, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { Project, Task, WorkspaceScan } from "@/lib/types";

export default function ProjectsPanel() {
  const queryClient = useQueryClient();
  const [newProject, setNewProject] = useState("");
  const [newTask, setNewTask] = useState("");
  const [scanPath, setScanPath] = useState("/app");
  const [scan, setScan] = useState<WorkspaceScan | null>(null);

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => apiGet<Project[]>("/projects") });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => apiGet<Task[]>("/tasks") });

  const invalidate = (key: string) => {
    void queryClient.invalidateQueries({ queryKey: [key] });
    void queryClient.invalidateQueries({ queryKey: ["metrics"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
  };

  const addProject = useMutation({
    mutationFn: (name: string) => apiPost<Project>("/projects", { name, kind: "project" }),
    onSuccess: () => {
      setNewProject("");
      invalidate("projects");
      toast.success("Kayıt eklendi");
    },
    onError: () => toast.error("Eklenemedi"),
  });

  const patchProject = useMutation({
    mutationFn: (vars: { id: string; progress?: number; status?: Project["status"] }) =>
      apiPatch<Project>(`/projects/${vars.id}`, { progress: vars.progress, status: vars.status }),
    onSuccess: () => invalidate("projects"),
  });

  const removeProject = useMutation({
    mutationFn: (id: string) => apiDelete(`/projects/${id}`),
    onSuccess: () => invalidate("projects"),
  });

  const addTask = useMutation({
    mutationFn: (title: string) => apiPost<Task>("/tasks", { title }),
    onSuccess: () => {
      setNewTask("");
      invalidate("tasks");
      toast.success("Görev eklendi");
    },
    onError: () => toast.error("Görev eklenemedi"),
  });

  const completeTask = useMutation({
    mutationFn: (id: string) => apiPatch<Task>(`/tasks/${id}`, { status: "done" }),
    onSuccess: () => invalidate("tasks"),
  });

  const removeTask = useMutation({
    mutationFn: (id: string) => apiDelete(`/tasks/${id}`),
    onSuccess: () => invalidate("tasks"),
  });

  const runScan = useMutation({
    mutationFn: (path: string) => apiGet<WorkspaceScan>(`/system/scan?path=${encodeURIComponent(path)}`),
    onSuccess: (data) => {
      setScan(data);
      invalidate("activities");
    },
    onError: () => toast.error("Dizin taranamadı", { description: "Yolu kontrol et." }),
  });

  const pending = (tasks.data ?? []).filter((t) => t.status !== "done");
  const done = (tasks.data ?? []).filter((t) => t.status === "done");

  return (
    <section className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="projects-panel">
      <div>
        <h2 className="font-heading text-sm font-semibold text-slate-100">Projeler & Kodlama</h2>
        <p className="text-xs text-slate-500">
          Takip edilen projeler, dersler ve gerçek git durumu.
        </p>
      </div>

      {/* workspace scan */}
      <div className="glass-panel rounded-xl p-3" data-testid="workspace-scan-card">
        <div className="mb-2 flex items-center gap-2">
          <GitBranch size={14} className="text-violet-400" />
          <span className="mono-label text-violet-400">GERÇEK DİZİN TARAMASI</span>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            runScan.mutate(scanPath);
          }}
        >
          <Input
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            className="h-9 border-cyan-500/20 bg-[#050b17] font-mono text-xs"
            data-testid="scan-path-input"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={runScan.isPending}
            className="h-9 w-9 shrink-0 bg-violet-500/90 text-white hover:bg-violet-400"
            data-testid="scan-run-button"
          >
            {runScan.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </Button>
        </form>
        {scan && (
          <div className="mt-2.5 space-y-1 text-xs" data-testid="scan-result">
            <p className="text-slate-400">
              branch: <span className="font-mono text-cyan-300">{scan.branch || "—"}</span>
              {" · "}
              {scan.dirty.length} değişmiş dosya
            </p>
            {scan.commits.slice(0, 6).map((c) => (
              <p key={c.hash} className="truncate text-slate-400">
                <span className="font-mono text-violet-300">{c.hash}</span> {c.subject}
                <span className="text-slate-600"> · {c.when}</span>
              </p>
            ))}
            {scan.commits.length === 0 && <p className="text-slate-600">commit kaydı okunamadı</p>}
          </div>
        )}
      </div>

      {/* projects */}
      <div className="glass-panel rounded-xl p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="mono-label">PROJELER & DERSLER</span>
          <span className="text-[0.7rem] text-slate-500">{projects.data?.length ?? 0} kayıt</span>
        </div>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newProject.trim()) addProject.mutate(newProject.trim());
          }}
        >
          <Input
            value={newProject}
            onChange={(e) => setNewProject(e.target.value)}
            placeholder="Yeni proje veya ders adı..."
            className="h-9 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="project-name-input"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={addProject.isPending || !newProject.trim()}
            className="h-9 w-9 shrink-0 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
            data-testid="project-add-button"
          >
            <Plus size={15} />
          </Button>
        </form>

        <div className="space-y-2" data-testid="project-list">
          {projects.isError && (
            <p className="text-xs text-amber-400">Projeler yüklenemedi — arka uç yanıt vermiyor.</p>
          )}
          {(projects.data ?? []).map((p) => (
            <div
              key={p.id}
              className="glass-soft rounded-lg p-2.5 transition-[border-color] duration-150 hover:border-cyan-400/35"
              data-testid={`project-item-${p.id}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[0.58rem] tracking-wider ${
                    p.kind === "course"
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      : "border-violet-500/40 bg-violet-500/10 text-violet-200"
                  }`}
                >
                  {p.kind === "course" ? "DERS" : "PROJE"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                  {p.name}
                </span>
                {p.deadline && (
                  <span className="shrink-0 text-[0.68rem] text-rose-300">teslim {p.deadline}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeProject.mutate(p.id)}
                  className="shrink-0 text-slate-600 hover:text-rose-300"
                  data-testid={`project-delete-${p.id}`}
                >
                  <Trash2 size={12} />
                </Button>
              </div>
              {p.next_step && (
                <p className="mt-1 truncate text-[0.72rem] text-slate-500">
                  sıradaki: {p.next_step}
                </p>
              )}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-[width] duration-300"
                    style={{ width: `${Math.max(2, p.progress)}%` }}
                  />
                </div>
                <span className="w-9 shrink-0 text-right font-mono text-[0.68rem] text-cyan-300">
                  %{p.progress}
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() =>
                    patchProject.mutate({ id: p.id, progress: Math.min(100, p.progress + 10) })
                  }
                  className="h-6 border-cyan-500/30 px-2 text-[0.62rem] text-cyan-200 hover:bg-cyan-500/10"
                  data-testid={`project-progress-${p.id}`}
                >
                  +10
                </Button>
              </div>
            </div>
          ))}
          {projects.data?.length === 0 && (
            <p className="text-xs text-slate-500">Henüz kayıt yok. Yukarıdan ekle.</p>
          )}
        </div>
      </div>

      {/* tasks */}
      <div className="glass-panel rounded-xl p-3">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="mono-label">GÖREVLER</span>
          <span className="text-[0.7rem] text-slate-500">
            {pending.length} bekleyen · {done.length} tamam
          </span>
        </div>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (newTask.trim()) addTask.mutate(newTask.trim());
          }}
        >
          <Input
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            placeholder="Yeni görev..."
            className="h-9 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
            data-testid="task-title-input"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={addTask.isPending || !newTask.trim()}
            className="h-9 w-9 shrink-0 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
            data-testid="task-add-button"
          >
            <Plus size={15} />
          </Button>
        </form>

        <div className="space-y-1.5" data-testid="task-list">
          {pending.map((t) => (
            <div
              key={t.id}
              className="group flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition-[border-color] duration-150 hover:border-cyan-400/30"
              data-testid={`task-item-${t.id}`}
            >
              <button
                type="button"
                onClick={() => completeTask.mutate(t.id)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded border border-cyan-500/40 text-transparent transition-colors duration-150 hover:bg-cyan-500/20 hover:text-cyan-300"
                title="Tamamlandı işaretle"
                data-testid={`task-complete-${t.id}`}
              >
                <Check size={12} />
              </button>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{t.title}</span>
              {t.priority === "high" && (
                <span className="shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[0.58rem] text-rose-200">
                  ACİL
                </span>
              )}
              {t.due && <span className="shrink-0 text-[0.68rem] text-slate-500">{t.due}</span>}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => removeTask.mutate(t.id)}
                className="shrink-0 text-slate-700 hover:text-rose-300"
                data-testid={`task-delete-${t.id}`}
              >
                <Trash2 size={12} />
              </Button>
            </div>
          ))}
          {pending.length === 0 && (
            <p className="text-xs text-slate-500">Bekleyen görev yok. Temiz masa.</p>
          )}
          {done.slice(0, 5).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 px-2.5 py-1 text-xs text-slate-600 line-through"
              data-testid={`task-done-${t.id}`}
            >
              <Check size={11} className="text-emerald-500" />
              <span className="truncate">{t.title}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
