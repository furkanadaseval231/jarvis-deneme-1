// Terminal & Console — a real sandboxed shell. Safe commands run immediately;
// destructive ones surface a confirm dialog before JARVIS will touch them.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Play, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiPost } from "@/lib/api";
import type { CommandResult } from "@/lib/types";

interface Line {
  kind: "cmd" | "out" | "err" | "info";
  text: string;
}

const QUICK = ["ls -la", "git status --short", "git log --oneline -5", "python --version", "df -h /"];

export default function TerminalPanel() {
  const [command, setCommand] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { kind: "info", text: "JARVIS sandbox terminali · çalışma dizini /app" },
    { kind: "info", text: "Güvenli komutlar doğrudan çalışır. Yıkıcı komutlarda onay isterim." },
  ]);
  const [confirmCmd, setConfirmCmd] = useState<{ cmd: string; reason: string } | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [lines]);

  const push = (next: Line[]) => setLines((prev) => [...prev, ...next]);

  const run = useMutation({
    mutationFn: (vars: { cmd: string; confirm: boolean }) =>
      apiPost<CommandResult>("/system/exec", { command: vars.cmd, confirm: vars.confirm }),
    onMutate: (vars) => {
      if (!vars.confirm) push([{ kind: "cmd", text: vars.cmd }]);
    },
    onSuccess: (res) => {
      if (res.needs_confirm) {
        setConfirmCmd({ cmd: res.command, reason: res.reason ?? "Yıkıcı komut." });
        push([{ kind: "err", text: `⚠ ${res.reason ?? "Onay gerekiyor."}` }]);
        return;
      }
      if (res.blocked) {
        push([{ kind: "err", text: `⛔ ${res.reason ?? "Komut reddedildi."}` }]);
        return;
      }
      const out: Line[] = [];
      if (res.stdout.trim()) out.push({ kind: "out", text: res.stdout.replace(/\s+$/, "") });
      if (res.stderr.trim()) out.push({ kind: "err", text: res.stderr.replace(/\s+$/, "") });
      if (out.length === 0) out.push({ kind: "info", text: `(çıktı yok · exit ${res.exit_code})` });
      else out.push({ kind: "info", text: `exit ${res.exit_code}` });
      push(out);
    },
    onError: () => push([{ kind: "err", text: "Komut gönderilemedi — arka uca ulaşamadım." }]),
  });

  const submit = (cmd: string) => {
    const value = cmd.trim();
    if (!value || run.isPending) return;
    setCommand("");
    run.mutate({ cmd: value, confirm: false });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="terminal-panel">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-sm font-semibold text-slate-100">Terminal & Konsol</h2>
        <span className="mono-label">SANDBOX · /app</span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              className="rounded border border-cyan-500/25 bg-cyan-500/[0.06] px-2 py-1 font-mono text-[0.68rem] text-cyan-200 transition-colors duration-150 hover:bg-cyan-500/15"
              data-testid={`terminal-quick-${q.split(" ")[0]}`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      <div
        className="thin-scroll min-h-0 flex-1 overflow-y-auto rounded-xl border border-cyan-500/20 bg-[#020617] p-3 font-mono text-[0.76rem] leading-relaxed"
        data-testid="terminal-output"
        aria-live="polite"
      >
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.kind === "cmd"
                ? "text-cyan-400"
                : line.kind === "err"
                  ? "whitespace-pre-wrap text-rose-400"
                  : line.kind === "info"
                    ? "text-slate-600"
                    : "whitespace-pre-wrap text-slate-300"
            }
          >
            {line.kind === "cmd" ? `$ ${line.text}` : line.text}
          </div>
        ))}
        {run.isPending && (
          <div className="flex items-center gap-1.5 text-cyan-500">
            <Loader2 size={11} className="animate-spin" /> çalışıyor...
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(command);
        }}
      >
        <span className="grid place-items-center px-1 font-mono text-cyan-400">$</span>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="komut yaz ve Enter'a bas..."
          className="border-cyan-500/20 bg-[#050b17] font-mono text-sm placeholder:text-slate-600"
          data-testid="terminal-input"
        />
        <Button
          type="submit"
          disabled={run.isPending || !command.trim()}
          className="shrink-0 bg-cyan-500 text-[#021018] hover:bg-cyan-400"
          data-testid="terminal-run-button"
        >
          <Play size={15} />
        </Button>
      </form>

      <Dialog open={confirmCmd !== null} onOpenChange={(open) => !open && setConfirmCmd(null)}>
        <DialogContent className="border-amber-500/30 bg-[#0b1528]" data-testid="terminal-confirm-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-300">
              <AlertTriangle size={18} /> Yıkıcı komut onayı
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {confirmCmd?.reason}
            </DialogDescription>
          </DialogHeader>
          <pre className="rounded-lg border border-amber-500/25 bg-[#020617] p-2.5 font-mono text-xs text-amber-200">
            $ {confirmCmd?.cmd}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmCmd(null)}
              className="border-slate-600 text-slate-300"
              data-testid="terminal-confirm-cancel"
            >
              Vazgeç
            </Button>
            <Button
              onClick={() => {
                const cmd = confirmCmd?.cmd;
                setConfirmCmd(null);
                if (cmd) {
                  push([{ kind: "cmd", text: `${cmd}  (onaylandı)` }]);
                  run.mutate({ cmd, confirm: true });
                }
              }}
              className="gap-2 bg-amber-500 text-[#201400] hover:bg-amber-400"
              data-testid="terminal-confirm-run"
            >
              <ShieldAlert size={15} /> Onayla ve çalıştır
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
