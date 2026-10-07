/* eslint-disable react-hooks/exhaustive-deps */
// JARVIS nervous system: Turkish speech-in (Web Speech API), orchestrator call,
// Turkish speech-out (Edge-TTS mp3 with a browser-voice fallback), and the live
// audio amplitude that drives the Orb. One provider so voice works from any panel.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError, apiPost } from "@/lib/api";
import type { ChatResponse, Settings, Track } from "@/lib/types";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";

interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface JarvisContextValue {
  orbState: OrbState;
  level: number;
  transcript: string;
  busy: boolean;
  voiceSupported: boolean;
  lastError: string | null;
  settings: Settings | null;
  setSettings: (s: Settings | null) => void;
  send: (text: string, imageBase64?: string | null) => Promise<void>;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => void;
  toggleListening: () => void;
  listening: boolean;
  track: Track | null;
  playing: boolean;
  volume: number;
  setVolume: (v: number) => void;
  playTrack: (t: Track) => void;
  togglePlay: () => void;
  stopTrack: () => void;
  sessionId: string;
}

const JarvisContext = createContext<JarvisContextValue | null>(null);

export function useJarvis(): JarvisContextValue {
  const ctx = useContext(JarvisContext);
  if (!ctx) throw new Error("useJarvis must be used inside <JarvisProvider>");
  return ctx;
}

const SESSION_ID = "default";

export function JarvisProvider({ children }: { children: ReactNode }) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(70);

  const queryClient = useQueryClient();
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const sendRef = useRef<((t: string) => void) | null>(null);

  const voiceSupported = useMemo(() => getRecognitionCtor() !== null, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLevel(0);
  }, []);

  const runMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) sum += data[i];
      const avg = sum / data.length / 255;
      setLevel(Math.min(1, avg * 2.6));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctor();
    }
    if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  // ----------------------------------------------------------------- speech out
  const stopSpeaking = useCallback(() => {
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current.currentTime = 0;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    stopMeter();
    setOrbState("idle");
  }, [stopMeter]);

  const browserSpeak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (!window.speechSynthesis) {
          resolve();
          return;
        }
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text.slice(0, 2000));
        utter.lang = "tr-TR";
        utter.rate = 1.0;
        utter.pitch = 0.95;
        const trVoice = window.speechSynthesis.getVoices().find((v) => v.lang.startsWith("tr"));
        if (trVoice) utter.voice = trVoice;
        setOrbState("speaking");
        // No analyser on synthesis output: animate the orb from a soft synthetic envelope.
        const start = performance.now();
        const fake = () => {
          const t = (performance.now() - start) / 1000;
          setLevel(0.35 + 0.28 * Math.abs(Math.sin(t * 6.2)) + 0.12 * Math.abs(Math.sin(t * 2.1)));
          rafRef.current = requestAnimationFrame(fake);
        };
        rafRef.current = requestAnimationFrame(fake);
        const finish = () => {
          stopMeter();
          setOrbState("idle");
          resolve();
        };
        utter.onend = finish;
        utter.onerror = finish;
        window.speechSynthesis.speak(utter);
      }),
    [stopMeter],
  );

  const speak = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      if (settings && !settings.voice_enabled) return;

      try {
        const res = await fetch("/api/voice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice: settings?.voice ?? "tr-TR-AhmetNeural" }),
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        const blob = await res.blob();
        if (blob.size < 512) throw new Error("boş ses");

        const url = URL.createObjectURL(blob);
        if (!audioElRef.current) {
          audioElRef.current = new Audio();
          audioElRef.current.crossOrigin = "anonymous";
        }
        const el = audioElRef.current;
        el.src = url;
        el.volume = 1;

        try {
          const ctx = ensureAudioCtx();
          if (!ttsSourceRef.current) {
            ttsSourceRef.current = ctx.createMediaElementSource(el);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            ttsSourceRef.current.connect(analyser);
            analyser.connect(ctx.destination);
            analyserRef.current = analyser;
          }
        } catch {
          /* analyser is cosmetic — never block playback on it */
        }

        await new Promise<void>((resolve) => {
          const done = () => {
            URL.revokeObjectURL(url);
            stopMeter();
            setOrbState("idle");
            resolve();
          };
          el.onended = done;
          el.onerror = done;
          setOrbState("speaking");
          runMeter();
          void el.play().catch(() => {
            // autoplay blocked before any user gesture — fall back silently
            done();
          });
        });
      } catch (err) {
        setLastError(
          `Edge-TTS sesi alınamadı (${err instanceof Error ? err.message : "bilinmeyen"}), tarayıcı sesine geçtim.`,
        );
        await browserSpeak(clean);
      }
    },
    [browserSpeak, ensureAudioCtx, runMeter, settings, stopMeter],
  );

  // ----------------------------------------------------------------- orchestrator
  const mutation = useMutation({
    mutationFn: (vars: { text: string; image?: string | null }) =>
      apiPost<ChatResponse>("/chat", {
        session_id: SESSION_ID,
        text: vars.text,
        image_base64: vars.image ?? null,
      }),
    onMutate: () => {
      setLastError(null);
      setOrbState("thinking");
    },
    onSuccess: async (data) => {
      // Autonomous side effects the browser owns: start the music the media agent picked.
      for (const action of data.actions) {
        if (action.tool === "muzik_cal") {
          const payload = action.payload as { playing?: Track };
          if (payload.playing?.video_id) {
            setTrack(payload.playing);
            setPlaying(true);
          }
        }
        if (action.tool === "muzik_durdur") {
          setPlaying(false);
        }
      }
      void queryClient.invalidateQueries({ queryKey: ["chat-history"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["web-scans"] });

      if (settings?.auto_speak !== false) {
        await speak(data.reply.content);
      } else {
        setOrbState("idle");
      }
    },
    onError: (err) => {
      setOrbState("idle");
      const detail =
        err instanceof ApiError && typeof err.body === "object" && err.body !== null
          ? String((err.body as { detail?: string }).detail ?? "")
          : "";
      const message = detail || "JARVIS çekirdeğine ulaşamadım. Ağ bağlantını kontrol et.";
      setLastError(message);
      toast.error("Bağlantı sorunu", { description: message });
      void browserSpeak("Bir sorun çıktı. " + message);
    },
  });

  const send = useCallback(
    async (text: string, imageBase64?: string | null) => {
      if (!text.trim() && !imageBase64) return;
      setTranscript("");
      await mutation.mutateAsync({ text, image: imageBase64 ?? null });
    },
    [mutation],
  );

  sendRef.current = (t: string) => {
    void send(t);
  };

  // ----------------------------------------------------------------- speech in
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    stopMeter();
    setListening(false);
    setOrbState((s) => (s === "listening" ? "idle" : s));
  }, [stopMeter]);

  const startListening = useCallback(async () => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      const msg =
        "Tarayıcın Türkçe sesli dinlemeyi (Web Speech API) desteklemiyor. Chrome veya Edge kullan; yazılı komut her zaman çalışır.";
      setLastError(msg);
      toast.error("Mikrofon desteklenmiyor", { description: msg });
      return;
    }
    stopSpeaking();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const ctx = ensureAudioCtx();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      runMeter();
    } catch {
      setLastError("Mikrofon izni verilmedi. Tarayıcı adres çubuğundaki mikrofon simgesinden izin ver.");
      toast.error("Mikrofon izni yok", {
        description: "Adres çubuğundaki mikrofon simgesinden izin verip tekrar dene.",
      });
      return;
    }

    const rec = new Ctor();
    rec.lang = "tr-TR";
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";

    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setTranscript(finalText || interim);
    };
    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        setLastError(`Ses algılama hatası: ${e.error}`);
      }
    };
    rec.onend = () => {
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      stopMeter();
      setListening(false);
      setOrbState("idle");
      const said = finalText.trim();
      if (said) sendRef.current?.(said);
    };

    recognitionRef.current = rec;
    setListening(true);
    setOrbState("listening");
    rec.start();
  }, [ensureAudioCtx, runMeter, stopMeter, stopSpeaking]);

  const toggleListening = useCallback(() => {
    if (listening) stopListening();
    else void startListening();
  }, [listening, startListening, stopListening]);

  // ----------------------------------------------------------------- media
  const playTrack = useCallback((t: Track) => {
    setTrack(t);
    setPlaying(true);
    void apiPost("/media/log", { action: "play", title: t.title }).catch(() => undefined);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((p) => !p);
  }, []);

  const stopTrack = useCallback(() => {
    setPlaying(false);
    void apiPost("/media/log", { action: "stop", title: track?.title ?? "" }).catch(() => undefined);
  }, [track]);

  useEffect(() => () => stopMeter(), [stopMeter]);

  const value: JarvisContextValue = {
    orbState,
    level,
    transcript,
    busy: mutation.isPending,
    voiceSupported,
    lastError,
    settings,
    setSettings,
    send,
    speak,
    stopSpeaking,
    toggleListening,
    listening,
    track,
    playing,
    volume,
    setVolume,
    playTrack,
    togglePlay,
    stopTrack,
    sessionId: SESSION_ID,
  };

  return <JarvisContext.Provider value={value}>{children}</JarvisContext.Provider>;
}
