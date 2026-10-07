// Notification bell: background commit detections and the morning brief land here.
// New arrivals raise a toast once, so JARVIS tells you without being asked.

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, FileText, GitCommitHorizontal, Info, Wrench } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiGet, apiPost } from "@/lib/api";
import type { CommitScanResult, Notification } from "@/lib/types";

const ICON: Record<Notification["kind"], React.ReactNode> = {
  commit: <GitCommitHorizontal size={13} className="text-violet-300" />,
  morning_brief: <FileText size={13} className="text-rose-300" />,
  patch: <Wrench size={13} className="text-emerald-300" />,
  system: <Info size={13} className="text-cyan-300" />,
};

export default function NotificationBell({ watchEnabled }: { watchEnabled: boolean }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const announced = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiGet<Notification[]>("/notifications"),
    refetchInterval: 20000,
  });

  // Background commit sweep while the dashboard is open (the platform cron covers the
  // hours it is closed). Idempotent: only genuinely new commits create a notification.
  useQuery({
    queryKey: ["commit-scan"],
    queryFn: async () => {
      const res = await apiPost<CommitScanResult>("/dev/commits/scan");
      if (res.new_commits > 0) {
        void queryClient.invalidateQueries({ queryKey: ["notifications"] });
        void queryClient.invalidateQueries({ queryKey: ["activities"] });
      }
      return res;
    },
    enabled: watchEnabled,
    refetchInterval: 120000,
    refetchOnWindowFocus: true,
  });

  const markAll = useMutation({
    mutationFn: () => apiPost("/notifications/read-all"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOne = useMutation({
    mutationFn: (id: string) => apiPost(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = (notifications ?? []).filter((n) => !n.read);

  useEffect(() => {
    if (!notifications) return;
    // First load only seeds the "seen" set — no toast storm for a backlog.
    if (!primed.current) {
      notifications.forEach((n) => announced.current.add(n.id));
      primed.current = true;
      return;
    }
    for (const n of notifications) {
      if (n.read || announced.current.has(n.id)) continue;
      announced.current.add(n.id);
      toast(n.title, { description: n.body, duration: 8000 });
    }
  }, [notifications]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative text-slate-300 hover:text-cyan-300"
            aria-label={`Bildirimler${unread.length > 0 ? ` (${unread.length} okunmamış)` : ""}`}
            data-testid="notification-bell"
          />
        }
      >
        <Bell size={16} />
        {unread.length > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[0.58rem] font-bold text-white shadow-[0_0_8px_rgba(244,63,94,0.7)]"
            data-testid="notification-badge"
          >
            {unread.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[340px] border-cyan-500/25 bg-[#0b1528] p-0"
        data-testid="notification-panel"
      >
        <div className="flex items-center justify-between border-b border-cyan-500/15 px-3 py-2">
          <span className="mono-label">BİLDİRİMLER</span>
          {unread.length > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => markAll.mutate()}
              className="h-6 text-[0.65rem] text-cyan-300 hover:bg-cyan-500/10"
              data-testid="notification-mark-all"
            >
              Tümünü okundu işaretle
            </Button>
          )}
        </div>
        <div className="thin-scroll max-h-[320px] overflow-y-auto p-1.5">
          {(notifications ?? []).map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.read && markOne.mutate(n.id)}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors duration-150 hover:bg-white/[0.05] ${
                n.read ? "opacity-55" : ""
              }`}
              data-testid={`notification-item-${n.id}`}
            >
              <span className="mt-0.5 shrink-0">{ICON[n.kind]}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-slate-100">{n.title}</span>
                <span className="block truncate text-[0.68rem] text-slate-500">{n.body}</span>
              </span>
              {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />}
            </button>
          ))}
          {notifications?.length === 0 && (
            <p className="px-2 py-4 text-center text-xs text-slate-500" data-testid="notification-empty">
              Bildirim yok. Yeni commit ya da sabah brifingi geldiğinde burada görürsün.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
