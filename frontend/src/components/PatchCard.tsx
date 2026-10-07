// Code patch preview: the unified diff JARVIS proposes, applied only on an explicit
// click. Applying takes a timestamped .bak backup next to the original file.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, FileCode2, Loader2, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError, apiPost } from "@/lib/api";
import type { Patch } from "@/lib/types";

function DiffView({ diff }: { diff: string }) {
  return (
    <pre
      className="thin-scroll max-h-56 overflow-auto rounded-lg border border-cyan-500/20 bg-[#020617] p-2.5 font-mono text-[0.72rem] leading-relaxed"
      data-testid="patch-diff"
    >
      {diff.split("\n").map((line, i) => {
        const added = line.startsWith("+") && !line.startsWith("+++");
        const removed = line.startsWith("-") && !line.startsWith("---");
        const meta = line.startsWith("@@");
        return (
          <div
            key={i}
            className={
              added
                ? "bg-emerald-500/10 text-emerald-300"
                : removed
                  ? "bg-rose-500/10 text-rose-300"
                  : meta
                    ? "text-cyan-400"
                    : "text-slate-500"
            }
          >
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

const STATUS_COPY: Record<Patch["status"], { label: string; tone: string }> = {
  pending: { label: "ONAY BEKLİYOR", tone: "border-amber-500/40 bg-amber-500/10 text-amber-200" },
  applied: { label: "UYGULANDI", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" },
  rejected: { label: "REDDEDİLDİ", tone: "border-slate-600/50 bg-white/[0.04] text-slate-400" },
  failed: { label: "BAŞARISIZ", tone: "border-rose-500/40 bg-rose-500/10 text-rose-200" },
};

export default function PatchCard({ patch }: { patch: Patch }) {
  const queryClient = useQueryClient();
  const status = STATUS_COPY[patch.status];
  const fileName = patch.path.split("/").slice(-2).join("/");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["patches"] });
    void queryClient.invalidateQueries({ queryKey: ["chat-history"] });
    void queryClient.invalidateQueries({ queryKey: ["activities"] });
  };

  const apply = useMutation({
    mutationFn: () => apiPost<Patch>(`/dev/patches/${patch.id}/apply`),
    onSuccess: (data) => {
      invalidate();
      toast.success("Yama uygulandı", {
        description: data.backup_path ? `Yedek: ${data.backup_path.split("/").pop()}` : undefined,
      });
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      invalidate();
      toast.error("Yama uygulanamadı", { description: detail || "Dosya değişmiş olabilir." });
    },
  });

  const reject = useMutation({
    mutationFn: () => apiPost<Patch>(`/dev/patches/${patch.id}/reject`),
    onSuccess: () => {
      invalidate();
      toast.info("Yama reddedildi");
    },
  });

  return (
    <div
      className="rounded-lg border border-violet-500/25 bg-[#070e1c]/85 p-2.5"
      data-testid={`patch-card-${patch.id}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FileCode2 size={13} className="text-violet-400" />
        <span className="font-mono text-[0.72rem] text-violet-200" data-testid="patch-target">
          {fileName}:{patch.line}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[0.55rem] tracking-widest ${status.tone}`}
          data-testid={`patch-status-${patch.status}`}
        >
          {status.label}
        </span>
      </div>

      {patch.explanation && (
        <p className="mb-2 text-xs text-slate-300">{patch.explanation}</p>
      )}

      <DiffView diff={patch.diff} />

      {patch.status === "applied" && patch.backup_path && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-emerald-300">
          <ShieldCheck size={12} /> Yedek alındı: {patch.backup_path.split("/").pop()}
        </p>
      )}
      {patch.status === "failed" && patch.error && (
        <p className="mt-2 text-[0.7rem] text-rose-300">{patch.error}</p>
      )}

      {patch.status === "pending" && (
        <div className="mt-2.5 flex gap-2">
          <Button
            size="sm"
            onClick={() => apply.mutate()}
            disabled={apply.isPending}
            className="gap-1.5 bg-emerald-500/90 text-[#041310] hover:bg-emerald-400"
            data-testid={`patch-apply-${patch.id}`}
          >
            {apply.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Uygula
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => reject.mutate()}
            disabled={reject.isPending}
            className="gap-1.5 border-slate-600 text-slate-300 hover:bg-white/[0.05]"
            data-testid={`patch-reject-${patch.id}`}
          >
            <X size={13} /> Reddet
          </Button>
        </div>
      )}
    </div>
  );
}
