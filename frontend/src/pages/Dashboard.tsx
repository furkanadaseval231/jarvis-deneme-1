// The command center. One page, many surfaces: the orb stays mounted (keeping its
// audio graph and voice session alive) while the centre column swaps modules.

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import Backdrop from "@/components/Backdrop";
import ChatPanel from "@/components/ChatPanel";
import JarvisOrb from "@/components/JarvisOrb";
import MediaDock from "@/components/MediaDock";
import MetricBar from "@/components/MetricBar";
import MorningGreeting from "@/components/MorningGreeting";
import Sidebar, { VIEWS } from "@/components/Sidebar";
import type { ViewId } from "@/components/Sidebar";
import SidePanels from "@/components/SidePanels";
import BriefPanel from "@/components/panels/BriefPanel";
import NotesPanel from "@/components/panels/NotesPanel";
import ProjectsPanel from "@/components/panels/ProjectsPanel";
import SettingsPanel from "@/components/panels/SettingsPanel";
import TerminalPanel from "@/components/panels/TerminalPanel";
import WebPanel from "@/components/panels/WebPanel";
import { apiGet } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import type { Settings } from "@/lib/types";

export default function Dashboard() {
  const [view, setView] = useState<ViewId>("command_center");
  const { orbState, level, toggleListening, setSettings, lastError, transcript, listening } = useJarvis();

  // Settings feed the persona and the voice picker; a failure must not blank the page.
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: () => apiGet<Settings>("/settings"),
  });

  useEffect(() => {
    if (settings) setSettings(settings);
  }, [settings, setSettings]);

  const title = VIEWS.find((v) => v.id === view)?.label ?? "Komuta Merkezi";

  return (
    <div className="flex h-screen flex-col overflow-hidden text-slate-200">
      <Backdrop />
      <MetricBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar active={view} onSelect={setView} />

        <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3 xl:flex-row">
          {/* centre column */}
          <div className="flex min-h-0 flex-1 flex-col">
            <MorningGreeting onOpenBrief={() => setView("daily_brief")} />

            {lastError && (
              <div
                className="mb-2 flex items-start gap-2 rounded-lg border border-amber-500/35 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-200"
                data-testid="error-banner"
                role="status"
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{lastError}</span>
              </div>
            )}

            {view === "command_center" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
                <div className="flex min-h-0 shrink-0 flex-col items-center justify-center lg:w-[42%]">
                  <JarvisOrb
                    state={orbState}
                    level={level}
                    size={264}
                    onActivate={toggleListening}
                  />
                  {listening && transcript && (
                    <p
                      className="mt-3 max-w-[260px] text-center text-xs italic text-cyan-200/80"
                      data-testid="orb-transcript"
                    >
                      "{transcript}"
                    </p>
                  )}
                  <div className="mt-4 w-full max-w-[280px]">
                    <MediaDock />
                  </div>
                </div>
                <div className="glass-panel flex min-h-0 flex-1 flex-col rounded-xl p-3">
                  <ChatPanel compact />
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
                <div className="glass-panel flex min-h-0 flex-1 flex-col rounded-xl p-3.5">
                  <h1 className="sr-only">{title}</h1>
                  {view === "companion_chat" && <ChatPanel />}
                  {view === "dev_projects" && <ProjectsPanel />}
                  {view === "terminal_console" && <TerminalPanel />}
                  {view === "web_flights" && <WebPanel />}
                  {view === "research_notes" && <NotesPanel />}
                  {view === "daily_brief" && <BriefPanel />}
                  {view === "system_settings" && <SettingsPanel />}
                </div>

                {/* compact orb rail so the command presence never disappears */}
                <div className="hidden shrink-0 flex-col items-center gap-3 lg:flex lg:w-[244px]">
                  <JarvisOrb state={orbState} level={level} size={176} onActivate={toggleListening} />
                  <div className="w-full">
                    <MediaDock />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* right rail */}
          {view === "command_center" && <SidePanels />}
        </main>
      </div>
    </div>
  );
}
