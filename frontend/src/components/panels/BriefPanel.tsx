// Executive Briefing Agent surface: the one-page end-of-day report, built from the
// real activity log — plus a speak button so JARVIS reads it out loud.

import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { FileText, Loader2, Sunrise, Volume2 } from "lucide-react";
import { toast } from "sonner";

import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import { AGENT_META } from "@/lib/types";
import type { Activity, Briefing } from "@/lib/types";

export default function BriefPanel() {
  const queryClient = useQueryClient();
  const { speak, stopSpeaking, orbState } = useJarvis();

  const briefings = useQuery({
    queryKey: ["briefings"],
    queryFn: () => apiGet<Briefing[]>("/briefing/latest"),
  });

  const morning = useQuery({
    queryKey: ["morning-brief"],
    queryFn: () => apiGet<Briefing[]>("/briefing/morning"),
  });

  const makeMorning = useMutation({
    mutationFn: () => apiPost<Briefing>("/briefing/morning"),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["morning-brief"] });
      void queryClient.invalidateQueries({ queryKey: ["briefings"] });
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success("Sabah brifingi hazır");
      void speak(data.report.slice(0, 1200));
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      toast.error("Sabah brifingi üretilemedi", { description: detail || "Arka uca ulaşamadım." });
    },
  });

  const activities = useQuery({
    queryKey: ["activities"],
    queryFn: () => apiGet<Activity[]>("/activities?limit=60&today_only=true"),
    refetchInterval: 15000,
  });

  const generate = useMutation({
    mutationFn: () => apiPost<Briefing>("/briefing"),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["briefings"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Gün sonu raporu hazır");
      void speak(data.report.slice(0, 1200));
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      toast.error("Rapor üretilemedi", { description: detail || "Arka uca ulaşamadım." });
    },
  });

  const latest = briefings.data?.find((b) => b.kind !== "morning") ?? null;
  const morningBrief = morning.data?.[0] ?? null;

  return (
    <section className="thin-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto" data-testid="brief-panel">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-sm font-semibold text-slate-100">Günlük Brief & Rapor</h2>
          <p className="text-xs text-slate-500">
            Rapor yalnızca bugünün gerçek aktivite kayıtlarından derlenir.
          </p>
        </div>
        {orbState === "speaking" ? (
          <Button
            variant="outline"
            onClick={stopSpeaking}
            className="gap-2 border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
            data-testid="brief-stop-speak"
          >
            Okumayı Durdur
          </Button>
        ) : (
          latest && (
            <Button
              variant="outline"
              onClick={() => void speak(latest.report.slice(0, 1200))}
              className="gap-2 border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10"
              data-testid="brief-speak-button"
            >
              <Volume2 size={15} /> Sesli Oku
            </Button>
          )
        )}
        <Button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="gap-2 bg-rose-500/90 text-white hover:bg-rose-400"
          data-testid="brief-generate-button"
        >
          {generate.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
          Gün Sonu Raporu Çıkar
        </Button>
      </div>

      {/* morning brief — produced by the 09:00 cron, or on demand here */}
      <div className="glass-panel rounded-xl p-3.5" data-testid="morning-brief-card">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Sunrise size={15} className="text-amber-400" />
          <span className="mono-label text-amber-400">SABAH BRIFINGI · 09:00</span>
          <div className="ml-auto flex gap-2">
            {morningBrief && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void speak(morningBrief.report.slice(0, 1200))}
                className="gap-1.5 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
                data-testid="morning-speak-button"
              >
                <Volume2 size={13} /> Sesli Oku
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => makeMorning.mutate()}
              disabled={makeMorning.isPending}
              className="gap-1.5 bg-amber-500 text-[#201400] hover:bg-amber-400"
              data-testid="morning-generate-button"
            >
              {makeMorning.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sunrise size={13} />
              )}
              Şimdi Üret
            </Button>
          </div>
        </div>
        {morningBrief ? (
          <Markdown text={morningBrief.report} />
        ) : (
          <p className="text-xs text-slate-500" data-testid="morning-brief-empty">
            Bugünün sabah brifingi henüz üretilmedi. Her sabah 09:00'da (İstanbul) sunucuda
            otomatik hazırlanır — beklemek istemezsen "Şimdi Üret"e bas.
          </p>
        )}
      </div>

      {latest ? (
        <div className="glass-panel rounded-xl p-4" data-testid="brief-report">
          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-cyan-500/15 pb-2.5">
            <span className="mono-label text-rose-300">{latest.day}</span>
            <span className="text-[0.7rem] text-slate-500">
              {latest.activity_count} aktivite · {latest.completed_tasks} tamamlanan ·{" "}
              {latest.pending_tasks} bekleyen
            </span>
          </div>
          <Markdown text={latest.report} />
        </div>
      ) : (
        <p className="glass-soft rounded-xl p-4 text-sm text-slate-400" data-testid="brief-empty">
          Henüz rapor yok. "Gün Sonu Raporu Çıkar"a bas ya da JARVIS'e "bugün neler yaptın?" diye sor.
        </p>
      )}

      <div data-testid="activity-log-card">
        <div className="mono-label mb-2">BUGÜNÜN CANLI LOG DÖKÜMÜ</div>
        <div className="space-y-1">
          {activities.isError && (
            <p className="text-xs text-amber-400">Log yüklenemedi — arka uç yanıt vermiyor.</p>
          )}
          {(activities.data ?? []).map((a) => {
            const meta = AGENT_META[a.agent] ?? AGENT_META.companion_vision;
            return (
              <div
                key={a.id}
                className="flex items-start gap-2 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5"
                data-testid={`activity-row-${a.id}`}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 font-mono text-[0.55rem] tracking-wider ${meta.tone}`}
                >
                  {meta.short}
                </span>
                <span className="min-w-0 flex-1 text-xs text-slate-300">{a.summary}</span>
                <span className="shrink-0 font-mono text-[0.62rem] text-slate-600">
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
              Bugün henüz kayıt yok. Sohbet et, komut çalıştır, tarama yap — hepsi buraya işlenir.
            </p>
          )}
        </div>
      </div>

      {briefings.data && briefings.data.length > 1 && (
        <div data-testid="brief-history">
          <div className="mono-label mb-1.5">ÖNCEKİ RAPORLAR</div>
          {briefings.data.slice(1, 6).map((b) => (
            <p key={b.id} className="px-1 py-0.5 text-xs text-slate-500">
              {b.day} · {b.activity_count} aktivite
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
