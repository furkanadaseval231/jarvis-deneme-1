// Renders the REAL payload of an autonomous agent action inline in the chat stream:
// flight comparison matrix, web sources, terminal output, git scan, task/note receipts.

import { CheckCircle2, ExternalLink, Music4, Plane, TerminalSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useJarvis } from "@/lib/jarvis";
import type { AgentAction, FlightOption, Track, WebResult } from "@/lib/types";

function Shell({
  icon,
  title,
  children,
  testid,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  testid: string;
}) {
  return (
    <div className="rounded-lg border border-cyan-500/20 bg-[#070e1c]/80 p-2.5" data-testid={testid}>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-cyan-400">{icon}</span>
        <span className="mono-label">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function ActionResult({ action }: { action: AgentAction }) {
  const { playTrack } = useJarvis();
  const p = action.payload;

  if (action.tool === "web_arastir") {
    const flights = (p.flights as FlightOption[] | undefined) ?? [];
    const results = (p.results as WebResult[] | undefined) ?? [];

    if (flights.length > 0) {
      return (
        <Shell icon={<Plane size={13} />} title="Bilet Karşılaştırma" testid="action-flight-table">
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-cyan-500/20 text-slate-500">
                  <th className="py-1.5 pr-2 font-medium">Firma</th>
                  <th className="py-1.5 pr-2 font-medium">Kalkış</th>
                  <th className="py-1.5 pr-2 font-medium">Varış</th>
                  <th className="py-1.5 pr-2 font-medium">Süre</th>
                  <th className="py-1.5 font-medium">Fiyat</th>
                </tr>
              </thead>
              <tbody>
                {flights.map((f, i) => (
                  <tr
                    key={`${f.airline}-${f.depart}-${i}`}
                    className={`border-b border-white/5 last:border-0 ${
                      i === 0 ? "bg-emerald-500/[0.07]" : ""
                    }`}
                    data-testid={`flight-row-${i}`}
                  >
                    <td className="py-1.5 pr-2 font-medium text-slate-100">{f.airline}</td>
                    <td className="py-1.5 pr-2 font-mono text-cyan-200">{f.depart}</td>
                    <td className="py-1.5 pr-2 font-mono text-cyan-200">{f.arrive}</td>
                    <td className="py-1.5 pr-2 text-slate-400">{f.duration}</td>
                    <td className="py-1.5 font-semibold text-emerald-300">
                      {f.price}
                      {i === 0 && <span className="ml-1 text-[0.6rem] text-emerald-400">en uygun</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Shell>
      );
    }

    if (results.length > 0) {
      return (
        <Shell icon={<ExternalLink size={13} />} title="Canlı Web Kaynakları" testid="action-web-results">
          <ul className="space-y-1.5">
            {results.map((r, i) => (
              <li key={`${r.title}-${i}`} className="text-xs">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-cyan-300 underline-offset-2 hover:underline"
                    data-testid={`web-result-link-${i}`}
                  >
                    {r.title}
                  </a>
                ) : (
                  <span className="font-medium text-slate-100">{r.title}</span>
                )}
                <p className="text-slate-500">{r.snippet}</p>
              </li>
            ))}
          </ul>
        </Shell>
      );
    }
    return null;
  }

  if (action.tool === "terminal_calistir") {
    const out = String(p.stdout ?? "");
    const err = String(p.stderr ?? "");
    return (
      <Shell icon={<TerminalSquare size={13} />} title="Terminal Çıktısı" testid="action-terminal">
        <div className="font-mono text-[0.72rem]">
          <div className="text-cyan-400">$ {String(p.command ?? "")}</div>
          {out && (
            <pre className="thin-scroll mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-slate-300">
              {out}
            </pre>
          )}
          {err && <pre className="mt-1 whitespace-pre-wrap text-rose-400">{err}</pre>}
          {Boolean(p.needs_confirm) && (
            <p className="mt-1 text-amber-300">Onay bekleniyor: {String(p.reason ?? "")}</p>
          )}
        </div>
      </Shell>
    );
  }

  if (action.tool === "proje_tara") {
    const commits = (p.commits as { hash: string; when: string; subject: string }[] | undefined) ?? [];
    const dirty = (p.dirty as string[] | undefined) ?? [];
    return (
      <Shell icon={<TerminalSquare size={13} />} title="Proje Taraması" testid="action-project-scan">
        <div className="space-y-1 text-xs">
          <p className="text-slate-400">
            <span className="text-slate-500">dizin:</span> {String(p.path ?? "")}
            {p.branch ? (
              <>
                {" · "}
                <span className="text-slate-500">branch:</span>{" "}
                <span className="font-mono text-cyan-300">{String(p.branch)}</span>
              </>
            ) : null}
          </p>
          {commits.slice(0, 5).map((c) => (
            <p key={c.hash} className="truncate text-slate-400">
              <span className="font-mono text-violet-300">{c.hash}</span> {c.subject}
              <span className="text-slate-600"> · {c.when}</span>
            </p>
          ))}
          {dirty.length > 0 && (
            <p className="text-amber-300">{dirty.length} değişmiş dosya var</p>
          )}
        </div>
      </Shell>
    );
  }

  if (action.tool === "muzik_cal") {
    const playing = p.playing as Track | undefined;
    const alts = (p.alternatives as Track[] | undefined) ?? [];
    if (!playing) return null;
    return (
      <Shell icon={<Music4 size={13} />} title="Medya Başlatıldı" testid="action-media">
        <p className="text-xs font-medium text-emerald-300">{playing.title}</p>
        <p className="text-[0.7rem] text-slate-500">{playing.channel}</p>
        {alts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {alts.slice(0, 3).map((t) => (
              <Button
                key={t.video_id}
                size="xs"
                variant="outline"
                onClick={() => playTrack(t)}
                className="h-6 border-emerald-500/30 px-2 text-[0.65rem] text-emerald-200 hover:bg-emerald-500/10"
                data-testid={`action-media-alt-${t.video_id}`}
              >
                {t.title.slice(0, 26)}
              </Button>
            ))}
          </div>
        )}
      </Shell>
    );
  }

  if (action.tool === "gorev_ekle" || action.tool === "gorev_tamamla" || action.tool === "not_kaydet") {
    const label =
      action.tool === "gorev_ekle"
        ? `Görev eklendi: ${String((p.task as { title?: string } | undefined)?.title ?? "")}`
        : action.tool === "gorev_tamamla"
          ? `Tamamlandı: ${String(p.completed ?? p.error ?? "")}`
          : `Not kaydedildi: ${String(p.title ?? "")}`;
    return (
      <div
        className="flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-1.5 text-xs text-emerald-200"
        data-testid="action-receipt"
      >
        <CheckCircle2 size={13} />
        {label}
      </div>
    );
  }

  return null;
}
