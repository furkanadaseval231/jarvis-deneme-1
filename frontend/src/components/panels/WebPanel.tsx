// Web & Browser Agent surface: live grounded search and the flight comparison matrix.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plane, Search } from "lucide-react";
import { toast } from "sonner";

import Markdown from "@/components/Markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, apiGet, apiPost } from "@/lib/api";
import type { WebScan } from "@/lib/types";

export default function WebPanel() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"search" | "flight">("flight");
  const [active, setActive] = useState<WebScan | null>(null);
  const queryClient = useQueryClient();

  const { data: scans, isError } = useQuery({
    queryKey: ["web-scans"],
    queryFn: () => apiGet<WebScan[]>("/web/scans"),
  });

  const scan = useMutation({
    mutationFn: (vars: { query: string; kind: "search" | "flight" }) =>
      apiPost<WebScan>("/web/search", vars),
    onSuccess: (data) => {
      setActive(data);
      void queryClient.invalidateQueries({ queryKey: ["web-scans"] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      toast.error("Tarama başarısız", {
        description: detail || "Canlı web taraması yapılamadı. Ağ bağlantını kontrol et.",
      });
    },
  });

  const shown = active ?? scans?.[0] ?? null;

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" data-testid="web-panel">
      <div>
        <h2 className="font-heading text-sm font-semibold text-slate-100">Web & Bilet Ajanı</h2>
        <p className="text-xs text-slate-500">
          Canlı arama ile en uygun seçeneği bulur, dağınık link yerine temiz tablo verir.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) scan.mutate({ query: query.trim(), kind });
        }}
      >
        <div className="flex overflow-hidden rounded-lg border border-cyan-500/25">
          {(["flight", "search"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              data-selected={kind === k ? "true" : undefined}
              className={`px-3 py-2 text-xs transition-colors duration-150 ${
                kind === k ? "bg-cyan-500/20 font-semibold text-cyan-200" : "text-slate-500 hover:text-slate-200"
              }`}
              data-testid={`web-kind-${k}`}
            >
              {k === "flight" ? "Bilet" : "Araştırma"}
            </button>
          ))}
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            kind === "flight"
              ? "örn. 20 Haziran İstanbul - Ankara tek yön"
              : "örn. React 19 server components"
          }
          className="min-w-[200px] flex-1 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
          data-testid="web-query-input"
        />
        <Button
          type="submit"
          disabled={scan.isPending || !query.trim()}
          className="gap-2 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
          data-testid="web-search-button"
        >
          {scan.isPending ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
          Tara
        </Button>
      </form>

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto">
        {scan.isPending && (
          <div className="glass-soft flex items-center gap-2 rounded-xl p-3 text-sm text-cyan-300" data-testid="web-loading">
            <Loader2 size={14} className="animate-spin" /> Canlı web taraması sürüyor...
          </div>
        )}

        {!shown && !scan.isPending && (
          <p className="glass-soft rounded-xl p-4 text-sm text-slate-400" data-testid="web-empty">
            {isError
              ? "Geçmiş taramalar yüklenemedi, ama yeni bir tarama başlatabilirsin."
              : "Henüz tarama yok. Bir güzergah ya da konu yaz, ajan canlı veriyle gelsin."}
          </p>
        )}

        {shown && (
          <div className="glass-panel rounded-xl p-3.5" data-testid="web-scan-result">
            <div className="mb-2 flex items-center gap-2">
              <Plane size={14} className="text-cyan-400" />
              <span className="text-sm font-semibold text-slate-100">{shown.query}</span>
              <span className="mono-label ml-auto">
                {shown.kind === "flight" ? "BİLET" : "ARAŞTIRMA"}
              </span>
            </div>

            {shown.flights.length > 0 && (
              <div className="thin-scroll mb-3 overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="flight-matrix">
                  <thead>
                    <tr className="border-b border-cyan-500/20 text-slate-500">
                      <th className="py-2 pr-3 font-medium">Havayolu</th>
                      <th className="py-2 pr-3 font-medium">Kalkış</th>
                      <th className="py-2 pr-3 font-medium">Varış</th>
                      <th className="py-2 pr-3 font-medium">Süre</th>
                      <th className="py-2 pr-3 font-medium">Fiyat</th>
                      <th className="py-2 font-medium">Not</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.flights.map((f, i) => (
                      <tr
                        key={`${f.airline}-${i}`}
                        className={`border-b border-white/5 last:border-0 transition-colors duration-150 hover:bg-white/[0.03] ${
                          i === 0 ? "bg-emerald-500/[0.07]" : ""
                        }`}
                        data-testid={`web-flight-row-${i}`}
                      >
                        <td className="py-2 pr-3 font-medium text-slate-100">{f.airline}</td>
                        <td className="py-2 pr-3 font-mono text-cyan-200">{f.depart}</td>
                        <td className="py-2 pr-3 font-mono text-cyan-200">{f.arrive}</td>
                        <td className="py-2 pr-3 text-slate-400">{f.duration}</td>
                        <td className="py-2 pr-3 font-semibold text-emerald-300">{f.price}</td>
                        <td className="py-2 text-[0.7rem] text-slate-500">
                          {i === 0 ? (f.note ?? "en uygun") : (f.note ?? "")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {shown.results.length > 0 && (
              <ul className="mb-3 space-y-2" data-testid="web-source-list">
                {shown.results.map((r, i) => (
                  <li key={`${r.title}-${i}`} className="text-xs">
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-cyan-300 underline-offset-2 hover:underline"
                      >
                        {r.title} <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="font-medium text-slate-100">{r.title}</span>
                    )}
                    <p className="text-slate-500">{r.snippet}</p>
                  </li>
                ))}
              </ul>
            )}

            {shown.summary && <Markdown text={shown.summary} />}
          </div>
        )}

        {scans && scans.length > 1 && (
          <div data-testid="web-history">
            <div className="mono-label mb-1.5">Geçmiş Taramalar</div>
            <div className="space-y-1">
              {scans.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setActive(s)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-slate-100"
                  data-testid={`web-history-item-${s.id}`}
                >
                  <span className="truncate">{s.query}</span>
                  <span className="ml-auto shrink-0 text-slate-600">
                    {new Date(s.created_at).toLocaleTimeString("tr-TR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
