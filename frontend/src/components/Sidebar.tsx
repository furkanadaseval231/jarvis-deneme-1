// Left dynamic module menu. View switching is local state in Dashboard — one page,
// many command surfaces, so the orb stays mounted and keeps its audio graph alive.

import {
  BookOpenCheck,
  Code2,
  Compass,
  FileText,
  MessageSquareShare,
  Orbit,
  Sliders,
  TerminalSquare,
} from "lucide-react";

export type ViewId =
  | "command_center"
  | "companion_chat"
  | "dev_projects"
  | "terminal_console"
  | "web_flights"
  | "research_notes"
  | "daily_brief"
  | "system_settings";

export const VIEWS: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: "command_center", label: "Komuta Merkezi", icon: <Orbit size={17} /> },
  { id: "companion_chat", label: "Sohbet & Görsel", icon: <MessageSquareShare size={17} /> },
  { id: "dev_projects", label: "Projeler & Kodlama", icon: <Code2 size={17} /> },
  { id: "terminal_console", label: "Terminal & Konsol", icon: <TerminalSquare size={17} /> },
  { id: "web_flights", label: "Web & Bilet Ajanı", icon: <Compass size={17} /> },
  { id: "research_notes", label: "Araştırma Notları", icon: <BookOpenCheck size={17} /> },
  { id: "daily_brief", label: "Günlük Brief", icon: <FileText size={17} /> },
  { id: "system_settings", label: "Ayarlar", icon: <Sliders size={17} /> },
];

interface Props {
  active: ViewId;
  onSelect: (id: ViewId) => void;
}

export default function Sidebar({ active, onSelect }: Props) {
  return (
    <nav
      className="flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-cyan-500/15 bg-[#080e1e]/90 p-2 backdrop-blur-xl lg:w-[232px] thin-scroll"
      data-testid="sidebar-nav"
    >
      <div className="mono-label hidden px-2 pb-2 pt-1 lg:block">Modüller</div>
      {VIEWS.map((view) => {
        const selected = active === view.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => onSelect(view.id)}
            data-testid={`nav-${view.id.replace(/_/g, "-")}`}
            data-selected={selected ? "true" : undefined}
            aria-current={selected ? "page" : undefined}
            className={`group flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-left text-sm transition-[background-color,color,border-color,transform] duration-150 lg:px-3 ${
              selected
                ? "border border-cyan-400/40 bg-cyan-500/12 font-semibold text-cyan-200"
                : "border border-transparent text-slate-400 hover:translate-x-0.5 hover:bg-white/[0.04] hover:text-slate-100"
            }`}
            title={view.label}
          >
            <span className={selected ? "text-cyan-300" : "text-slate-500 group-hover:text-cyan-300"}>
              {view.icon}
            </span>
            <span className="hidden truncate lg:inline">{view.label}</span>
            {selected && (
              <span className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_#00f0ff] lg:block" />
            )}
          </button>
        );
      })}
    </nav>
  );
}
