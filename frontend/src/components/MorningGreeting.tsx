// Morning greeting: when the 09:00 cron has produced today's brief, JARVIS greets with it
// the first time you open the dashboard — unprompted, which is the whole point.
//
// Browsers refuse audio before a user gesture, so it speaks on the first interaction and
// meanwhile shows a banner you can trigger by hand. Marked `spoken` so it greets once a day.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sunrise, Volume2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiGet, apiPost } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import type { Briefing } from "@/lib/types";

export default function MorningGreeting({ onOpenBrief }: { onOpenBrief: () => void }) {
  const { speak, settings } = useJarvis();
  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(false);
  const triggered = useRef(false);

  const { data } = useQuery({
    queryKey: ["morning-brief"],
    queryFn: () => apiGet<Briefing[]>("/briefing/morning"),
    refetchInterval: 300000,
  });

  const markSpoken = useMutation({
    mutationFn: (id: string) => apiPost<Briefing>(`/briefing/${id}/spoken`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["morning-brief"] }),
  });

  const brief = data?.[0] ?? null;
  const pending = brief !== null && !brief.spoken && !dismissed;

  const announce = (b: Briefing) => {
    if (triggered.current) return;
    triggered.current = true;
    markSpoken.mutate(b.id);
    void speak(b.report.slice(0, 1200));
  };

  // Arm a one-shot gesture listener so the greeting fires on the user's first click/key.
  useEffect(() => {
    if (!pending || !brief) return;
    if (settings?.voice_enabled === false || settings?.auto_speak === false) return;

    const fire = () => announce(brief);
    window.addEventListener("pointerdown", fire, { once: true });
    window.addEventListener("keydown", fire, { once: true });
    return () => {
      window.removeEventListener("pointerdown", fire);
      window.removeEventListener("keydown", fire);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, brief?.id, settings?.voice_enabled, settings?.auto_speak]);

  if (!pending || !brief) return null;

  const headline =
    brief.report
      .split("\n")
      .map((l) => l.replace(/^#+\s*/, "").trim())
      .find((l) => l.length > 12 && !l.startsWith("##")) ?? "Bugünün planı hazır.";

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/35 bg-amber-400/[0.08] px-3 py-2.5"
      data-testid="morning-greeting-banner"
      role="status"
    >
      <Sunrise size={16} className="shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-100">
          Günaydın {settings?.user_name ?? "Patron"} — sabah brifingin hazır
        </p>
        <p className="truncate text-xs text-amber-200/70">{headline}</p>
      </div>
      <Button
        size="sm"
        onClick={() => announce(brief)}
        className="shrink-0 gap-1.5 bg-amber-500 text-[#201400] hover:bg-amber-400"
        data-testid="morning-greeting-listen"
      >
        <Volume2 size={13} /> Dinle
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={onOpenBrief}
        className="shrink-0 border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
        data-testid="morning-greeting-open"
      >
        Aç
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setDismissed(true)}
        className="shrink-0 text-amber-200/60 hover:text-amber-100"
        aria-label="Kapat"
        data-testid="morning-greeting-dismiss"
      >
        <X size={14} />
      </Button>
    </div>
  );
}
