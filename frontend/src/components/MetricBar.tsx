// Top telemetry strip — real psutil numbers plus live workspace counters.

import { useQuery } from "@tanstack/react-query";
import { Activity, Cpu, Globe2, HardDrive, Layers, Mic, MicOff, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";
import { apiGet } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import type { SystemMetrics } from "@/lib/types";

function Tile({
  icon,
  label,
  value,
  sub,
  testid,
  accent = "#00f0ff",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  testid: string;
  accent?: string;
}) {
  return (
    <div
      className="glass-soft flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-cyan-400/40"
      data-testid={testid}
    >
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
        style={{ background: `${accent}1f`, color: accent }}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="mono-label truncate" style={{ color: accent }}>
          {label}
        </div>
        <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
        {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

export default function MetricBar() {
  const { listening, toggleListening, settings, setSettings, voiceSupported, wakeArmed } =
    useJarvis();

  const { data: metrics, isError } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => apiGet<SystemMetrics>("/system/metrics"),
    refetchInterval: 5000,
  });

  const offline = isError || !metrics;
  const muted = settings ? !settings.voice_enabled : false;

  const toggleVoice = () => {
    if (!settings) return;
    const next = { ...settings, voice_enabled: !settings.voice_enabled };
    setSettings(next);
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_enabled: next.voice_enabled }),
    });
  };

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b border-cyan-500/15 bg-[#060a14]/85 px-4 py-2.5 backdrop-blur-xl"
      data-testid="metric-bar"
    >
      <div className="flex items-center gap-2.5 pr-2">
        <span className="relative grid h-9 w-9 place-items-center rounded-lg border border-cyan-400/40 bg-cyan-500/10">
          <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 shadow-[0_0_12px_#00f0ff]" />
        </span>
        <div className="hidden sm:block">
          <div className="font-heading text-sm font-bold tracking-wide text-slate-100 cyan-text-glow">
            J A R V I S
          </div>
          <div className="mono-label" data-testid="core-status">
            {offline ? "ÇEKİRDEK OFFLINE" : "ÇEKİRDEK AKTİF"}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto thin-scroll">
        <Tile
          testid="metric-projects"
          icon={<Layers size={15} />}
          label="Aktif Proje / Ders"
          value={offline ? "—" : String(metrics.active_projects)}
          sub={offline ? "veri yok" : `${metrics.running_tasks} bekleyen görev`}
        />
        <Tile
          testid="metric-tasks"
          icon={<Activity size={15} />}
          label="Arka Plan Görevleri"
          value={offline ? "—" : String(metrics.today_activities)}
          sub="bugünkü otonom işlem"
          accent="#22c55e"
        />
        <Tile
          testid="metric-last-scan"
          icon={<Globe2 size={15} />}
          label="Son Web Taraması"
          value={offline ? "—" : (metrics.last_scan ?? "tarama yok")}
          sub="web & bilet ajanı"
          accent="#0070f3"
        />
        <Tile
          testid="metric-cpu"
          icon={<Cpu size={15} />}
          label="CPU"
          value={offline ? "—" : `%${metrics.cpu_percent}`}
          sub={offline ? "" : `${metrics.process_count} süreç`}
          accent="#f59e0b"
        />
        <Tile
          testid="metric-ram"
          icon={<HardDrive size={15} />}
          label="RAM"
          value={offline ? "—" : `${metrics.ram_used_gb} / ${metrics.ram_total_gb} GB`}
          sub={offline ? "" : `disk %${metrics.disk_percent} · ${metrics.uptime_hours}s açık`}
          accent="#a78bfa"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {wakeArmed && (
          <span
            className="hidden items-center gap-1.5 rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 md:flex"
            title='Uyandırma sözcüğü dinlemede — "Hey Jarvis" de'
            data-testid="wake-word-indicator"
          >
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff]" />
            <span className="mono-label">HEY JARVIS</span>
          </span>
        )}
        <NotificationBell watchEnabled={settings?.commit_watch_enabled !== false} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleVoice}
          aria-pressed={!muted}
          title={muted ? "Sesi aç" : "Sesi kapat"}
          className="text-slate-300 hover:text-cyan-300"
          data-testid="voice-mute-toggle"
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </Button>
        <Button
          onClick={toggleListening}
          disabled={!voiceSupported}
          className={
            listening
              ? "gap-2 bg-rose-500 text-white hover:bg-rose-400"
              : "gap-2 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
          }
          data-testid="voice-mic-button"
          title={voiceSupported ? "Türkçe sesli komut" : "Tarayıcın sesli komutu desteklemiyor"}
        >
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
          <span className="hidden md:inline">{listening ? "Dinlemeyi Bitir" : "Konuş"}</span>
        </Button>
      </div>
    </header>
  );
}
