// Credit gauge for the top strip. Built from REAL token usage recorded on every LLM call
// (emergentintegrations returns the counts), priced with the published per-model rates and
// measured against the cap set in Ayarlar.
//
// Honesty: Emergent exposes no API for the key's authoritative remaining balance, so this
// is the spend THIS APP caused — labelled as an estimate. When the provider itself reports
// the budget as exhausted, the gauge switches to that hard truth.

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Coins } from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet } from "@/lib/api";
import type { UsageSummary } from "@/lib/types";

const TONE: Record<UsageSummary["state"], { bar: string; text: string; ring: string }> = {
  ok: { bar: "bg-cyan-400", text: "text-cyan-300", ring: "border-cyan-500/25" },
  warn: { bar: "bg-amber-400", text: "text-amber-300", ring: "border-amber-500/40" },
  critical: { bar: "bg-orange-500", text: "text-orange-300", ring: "border-orange-500/50" },
  exceeded: { bar: "bg-rose-500", text: "text-rose-300", ring: "border-rose-500/60" },
};

const LABEL: Record<UsageSummary["state"], string> = {
  ok: "LLM KREDİSİ",
  warn: "KREDİ AZALIYOR",
  critical: "KREDİ KRİTİK",
  exceeded: "KREDİ BİTTİ",
};

export default function CreditGauge() {
  const warned = useRef<Record<string, boolean>>({});

  const { data: usage, isError } = useQuery({
    queryKey: ["usage"],
    queryFn: () => apiGet<UsageSummary>("/usage"),
    refetchInterval: 15000,
  });

  // Warn BEFORE it runs out, once per threshold per session.
  useEffect(() => {
    if (!usage) return;
    if (usage.state === "exceeded" && !warned.current.exceeded) {
      warned.current.exceeded = true;
      toast.error("LLM kredisi bitti", {
        description:
          "Sohbet, görsel analizi ve raporlar duracak. Emergent panelinden kredi yükle. Ses, terminal, medya ve commit izleme çalışmaya devam ediyor.",
        duration: 15000,
      });
      return;
    }
    if (usage.state === "critical" && !warned.current.critical) {
      warned.current.critical = true;
      toast.warning(`Kredinin %${usage.percent}'i harcandı`, {
        description: `Tahmini ${usage.remaining.toFixed(3)} kredi kaldı. Ayarlar'dan Ekonomi moduna geçmek ömrünü uzatır.`,
        duration: 12000,
      });
      return;
    }
    if (usage.state === "warn" && !warned.current.warn) {
      warned.current.warn = true;
      toast.warning(`Kredinin %${usage.percent}'i harcandı`, {
        description: "Basit sohbetleri Flash modeline almak için Ayarlar → Model Politikası.",
        duration: 10000,
      });
    }
  }, [usage]);

  if (isError || !usage) {
    return (
      <div
        className="glass-soft flex items-center gap-2 rounded-xl px-2.5 py-2"
        data-testid="credit-gauge-offline"
      >
        <Coins size={14} className="text-slate-500" />
        <span className="mono-label text-slate-500">KREDİ —</span>
      </div>
    );
  }

  const tone = TONE[usage.state];

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className={`glass-soft flex shrink-0 items-center gap-2 rounded-xl border px-2.5 py-1.5 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 ${tone.ring}`}
            data-testid="credit-gauge"
            data-state={usage.state}
            aria-label={`LLM kredisi: tahmini ${usage.spent} / ${usage.cap}`}
          />
        }
      >
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] ${tone.text}`}>
          {usage.state === "ok" ? <Coins size={14} /> : <AlertTriangle size={14} />}
        </span>
        <span className="min-w-[88px]">
          <span className={`mono-label block ${tone.text}`}>{LABEL[usage.state]}</span>
          <span className="block text-[0.72rem] font-semibold text-slate-100" data-testid="credit-gauge-value">
            {usage.state === "exceeded"
              ? "yükleme gerekli"
              : `${usage.spent.toFixed(3)} / ${usage.cap.toFixed(2)}`}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <span
              className={`block h-full rounded-full transition-[width] duration-500 ${tone.bar}`}
              style={{ width: `${Math.max(2, usage.percent)}%` }}
              data-testid="credit-gauge-bar"
            />
          </span>
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[330px] border-cyan-500/25 bg-[#0b1528] p-3"
        data-testid="credit-detail-panel"
      >
        <div className="mono-label mb-2">LLM HARCAMA DÖKÜMÜ</div>

        {usage.state === "exceeded" && (
          <p className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-[0.72rem] text-rose-200">
            Emergent anahtarının bütçesi doldu. Account Settings → Universal Key → Add API Key
            Balance ile kredi yükle, sonra aşağıdaki sayacı sıfırla.
          </p>
        )}

        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <dt className="text-slate-500">Toplam harcama (tahmini)</dt>
            <dd className="font-mono text-slate-100">{usage.spent.toFixed(4)} kredi</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Kalan</dt>
            <dd className="font-mono text-slate-100">{usage.remaining.toFixed(4)} kredi</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Bugün</dt>
            <dd className="font-mono text-slate-100">
              {usage.today_spent.toFixed(4)} · {usage.today_calls} çağrı
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Toplam çağrı</dt>
            <dd className="font-mono text-slate-100">{usage.calls}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Token (girdi / çıktı)</dt>
            <dd className="font-mono text-slate-100">
              {usage.input_tokens.toLocaleString("tr-TR")} / {usage.output_tokens.toLocaleString("tr-TR")}
            </dd>
          </div>
        </dl>

        {usage.per_model.length > 0 && (
          <div className="mt-2.5 border-t border-cyan-500/15 pt-2">
            <div className="mono-label mb-1.5">MODEL BAŞINA</div>
            {usage.per_model.map((m) => (
              <div
                key={m.model}
                className="flex items-center justify-between py-0.5 text-[0.7rem]"
                data-testid={`credit-model-${m.model}`}
              >
                <span className="truncate font-mono text-slate-400">{m.model}</span>
                <span className="ml-2 shrink-0 font-mono text-slate-200">
                  {m.cost.toFixed(4)} · {m.calls}×
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="mt-2.5 border-t border-cyan-500/15 pt-2 text-[0.66rem] leading-relaxed text-slate-500">
          Bu sayaç, bu uygulamanın gerçek token kullanımından hesaplanır; Emergent'ın resmi
          bakiyesi değildir. Sınırı ve modelleri Ayarlar'dan değiştirebilirsin.
        </p>
      </PopoverContent>
    </Popover>
  );
}
