// Media & OS Controller surface: a real YouTube embed the media agent can start
// autonomously, with play/pause, volume and track search.

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Music4, Pause, Play, Search, Square, Volume2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiPost } from "@/lib/api";
import { useJarvis } from "@/lib/jarvis";
import type { Track } from "@/lib/types";

export default function MediaDock() {
  const { track, playing, volume, setVolume, playTrack, togglePlay, stopTrack } = useJarvis();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const post = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*",
    );
  };

  useEffect(() => {
    if (!track) return;
    post(playing ? "playVideo" : "pauseVideo");
  }, [playing, track]);

  useEffect(() => {
    if (!track) return;
    post("setVolume", [volume]);
  }, [volume, track]);

  const search = useMutation({
    mutationFn: (q: string) => apiPost<Track[]>("/media/search", { query: q }),
    onSuccess: (data) => {
      setResults(data);
      if (data.length > 0) playTrack(data[0]);
    },
    onError: () => toast.error("YouTube araması başarısız", { description: "Ağ bağlantını kontrol et." }),
  });

  return (
    <section className="glass-panel rounded-xl p-3" data-testid="media-dock">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Music4 size={15} className="text-emerald-400" />
          Medya Kontrolü
        </h3>
        <span className="mono-label text-emerald-400">YOUTUBE</span>
      </div>

      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) search.mutate(query.trim());
        }}
      >
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Şarkı veya sanatçı ara..."
          className="h-9 border-cyan-500/20 bg-[#050b17] text-sm placeholder:text-slate-600"
          data-testid="media-search-input"
        />
        <Button
          type="submit"
          size="icon-sm"
          disabled={search.isPending || !query.trim()}
          className="h-9 w-9 shrink-0 bg-emerald-500/90 text-[#041310] hover:bg-emerald-400"
          data-testid="media-search-button"
        >
          <Search size={15} />
        </Button>
      </form>

      {track ? (
        <div data-testid="media-now-playing">
          <div className="overflow-hidden rounded-lg border border-emerald-500/25">
            <iframe
              ref={iframeRef}
              key={track.video_id}
              title={track.title}
              src={`https://www.youtube.com/embed/${track.video_id}?enablejsapi=1&autoplay=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
              allowFullScreen
              className="aspect-video w-full"
              data-testid="media-iframe"
            />
          </div>
          <p className="mt-2 truncate text-sm font-medium text-slate-100" data-testid="media-track-title">
            {track.title}
          </p>
          <p className="truncate text-xs text-slate-500">{track.channel || "YouTube"}</p>

          <div className="mt-2.5 flex items-center gap-2">
            <Button
              size="icon-sm"
              onClick={togglePlay}
              className="bg-emerald-500/90 text-[#041310] hover:bg-emerald-400"
              data-testid="media-play-toggle"
              aria-pressed={playing}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              onClick={stopTrack}
              className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
              data-testid="media-stop-button"
            >
              <Square size={13} />
            </Button>
            <Volume2 size={14} className="ml-1 shrink-0 text-slate-500" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="h-1.5 w-full accent-emerald-400"
              aria-label="Ses seviyesi"
              data-testid="media-volume-slider"
            />
            <span className="w-8 shrink-0 text-right text-xs text-slate-400">{volume}</span>
          </div>
        </div>
      ) : (
        <p className="py-4 text-center text-xs text-slate-500" data-testid="media-empty">
          Henüz medya yok. "Tarkan Kuzu Kuzu aç" diye söyle ya da yukarıdan ara.
        </p>
      )}

      {results.length > 1 && (
        <div className="mt-3 space-y-1" data-testid="media-results">
          <div className="mono-label">Alternatifler</div>
          {results.slice(1, 5).map((t) => (
            <button
              key={t.video_id}
              type="button"
              onClick={() => playTrack(t)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-400 transition-colors duration-150 hover:bg-white/[0.05] hover:text-slate-100"
              data-testid={`media-result-${t.video_id}`}
            >
              <Play size={11} className="shrink-0 text-emerald-400" />
              <span className="truncate">{t.title}</span>
              <span className="ml-auto shrink-0 text-slate-600">{t.duration}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
