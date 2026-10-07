/* eslint-disable react-hooks/exhaustive-deps */
// JARVIS nervous system: Turkish speech-in (Web Speech API), orchestrator call,
// Turkish speech-out (Edge-TTS mp3 with a browser-voice fallback), and the live
// audio amplitude that drives the Orb. One provider so voice works from any panel.
//
// SPEECH ENGINE DESIGN — read before changing:
// A browser allows exactly ONE live SpeechRecognition instance. Running a separate
// wake-word recogniser alongside the command recogniser made start() fail silently, so
// the mic button needed several clicks and the wake word never fired. There is therefore
// ONE engine here, switched between modes by `modeRef`:
//   off     — not running
//   wake    — listening only for "Hey Jarvis"
//   command — transcribing an actual command, auto-submitted after a short silence
// Switching wake → command is just a flag change: no restart, no race, instant response.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ApiError, apiPost } from "@/lib/api";
import type { ChatResponse, Settings, Track } from "@/lib/types";

export type OrbState = "idle" | "listening" | "thinking" | "speaking";
type EngineMode = "off" | "wake" | "command";

interface SpeechResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  abort?: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<SpeechResultLike> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

// Turkish ASR writes the wake word many ways and often splits it ("jar vis", "car wiz").
// Matching runs on a space-collapsed copy so every spelling lands, while the spaced form
// is kept for slicing the command that follows.
const WAKE_COLLAPSED = /(?:hey|hay|ey|hei|hay)?\s*(?:[jcçg][ae]rv[iıe]s|[jcçg]arw[iı]s|[jcçg]arv[iı]z|[jcçg]arves)/i;
const WAKE_SPACED = /\b(?:hey|hay|ey|hei)?\s*[jcçg]\s?[ae]\s?r\s?[vwy]\s?[iıe]\s?[szd]?\b/i;

function normalizeSpeech(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[.,!?;:'"`’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesWakeWord(text: string): boolean {
  const normalized = normalizeSpeech(text);
  if (WAKE_COLLAPSED.test(normalized.replace(/\s+/g, ""))) return true;
  return WAKE_SPACED.test(normalized);
}

// Everything after the wake word is treated as the command, so "Hey Jarvis müziği aç"
// works in one breath instead of needing a second turn.
export function stripWakeWord(text: string): string {
  const normalized = normalizeSpeech(text);
  const spaced = WAKE_SPACED.exec(normalized);
  if (spaced) return normalized.slice(spaced.index + spaced[0].length).trim();
  // Collapsed match only: drop everything up to the last token that looks like the name.
  const words = normalized.split(" ");
  for (let i = words.length - 1; i >= 0; i -= 1) {
    if (WAKE_COLLAPSED.test(words[i])) return words.slice(i + 1).join(" ").trim();
  }
  return "";
}

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
  wakeArmed: boolean;
  wakeHeard: boolean;
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
// How long to wait after speech stops before treating the command as finished.
const SILENCE_AFTER_FINAL_MS = 900;
const SILENCE_AFTER_INTERIM_MS = 1800;

export function JarvisProvider({ children }: { children: ReactNode }) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [listening, setListening] = useState(false);
  const [wakeArmed, setWakeArmed] = useState(false);
  const [wakeHeard, setWakeHeard] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(70);

  const queryClient = useQueryClient();

  // --- speech engine refs (single instance, mode-switched) ---
  const engineRef = useRef<RecognitionLike | null>(null);
  const modeRef = useRef<EngineMode>("off");
  const finalRef = useRef("");
  const silenceRef = useRef<number | null>(null);
  const wakeEnabledRef = useRef(false);
  const pausedForSpeechRef = useRef(false);
  const permissionDeniedRef = useRef(false);

  // --- audio refs ---
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ttsSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const sendRef = useRef<((t: string) => void) | null>(null);

  const voiceSupported = useMemo(() => getRecognitionCtor() !== null, []);

  // ----------------------------------------------------------------- meters
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

  const releaseMic = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }, []);

  // The orb's listening ripples come from a real mic analyser. It is cosmetic: if the
  // browser refuses the stream, recognition still runs and the orb uses a flat level.
  const acquireMicMeter = useCallback(async () => {
    if (micStreamRef.current) return;
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
      /* no meter — recognition is unaffected */
    }
  }, [ensureAudioCtx, runMeter]);

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
          void el.play().catch(() => done());
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
      for (const action of data.actions) {
        if (action.tool === "muzik_cal") {
          const payload = action.payload as { playing?: Track };
          if (payload.playing?.video_id) {
            setTrack(payload.playing);
            setPlaying(true);
          }
        }
        if (action.tool === "muzik_durdur") setPlaying(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["chat-history"] });
      void queryClient.invalidateQueries({ queryKey: ["activities"] });
      void queryClient.invalidateQueries({ queryKey: ["metrics"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["notes"] });
      void queryClient.invalidateQueries({ queryKey: ["web-scans"] });
      void queryClient.invalidateQueries({ queryKey: ["patches"] });

      if (settings?.auto_speak !== false) await speak(data.reply.content);
      else setOrbState("idle");
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

  // ----------------------------------------------------------------- engine
  const clearSilence = useCallback(() => {
    if (silenceRef.current !== null) {
      window.clearTimeout(silenceRef.current);
      silenceRef.current = null;
    }
  }, []);

  const stopEngine = useCallback(() => {
    const rec = engineRef.current;
    engineRef.current = null;
    if (rec) {
      // Detach handlers first so onend cannot respawn the engine we are killing.
      rec.onend = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onstart = null;
      try {
        (rec.abort ?? rec.stop)();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  const enterWake = useCallback(() => {
    modeRef.current = "wake";
    finalRef.current = "";
    clearSilence();
    releaseMic();
    stopMeter();
    setListening(false);
    setTranscript("");
    setWakeArmed(true);
  }, [clearSilence, releaseMic, stopMeter]);

  const enterCommand = useCallback(() => {
    modeRef.current = "command";
    finalRef.current = "";
    clearSilence();
    setTranscript("");
    setWakeArmed(false);
    setListening(true);
    setOrbState("listening");
    void acquireMicMeter();
  }, [acquireMicMeter, clearSilence]);

  const goIdle = useCallback(() => {
    modeRef.current = "off";
    finalRef.current = "";
    clearSilence();
    releaseMic();
    stopMeter();
    stopEngine();
    setListening(false);
    setWakeArmed(false);
    setTranscript("");
    setOrbState((s) => (s === "listening" ? "idle" : s));
  }, [clearSilence, releaseMic, stopEngine, stopMeter]);

  const spawnEngine = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor || engineRef.current || permissionDeniedRef.current) return;
    if (modeRef.current === "off") return;

    const rec = new Ctor();
    rec.lang = "tr-TR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    const scheduleSubmit = (ms: number) => {
      clearSilence();
      silenceRef.current = window.setTimeout(() => {
        silenceRef.current = null;
        if (modeRef.current !== "command") return;
        const said = finalRef.current.trim();
        finalRef.current = "";
        releaseMic();
        stopMeter();
        setTranscript("");
        if (wakeEnabledRef.current) {
          enterWake();
        } else {
          goIdle();
        }
        if (said) sendRef.current?.(said);
      }, ms);
    };

    rec.onresult = (event) => {
      let interim = "";
      let finals = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const res = event.results[i];
        if (res.isFinal) finals += res[0].transcript;
        else interim += res[0].transcript;
      }

      if (modeRef.current === "wake") {
        const heard = `${finals} ${interim}`;
        if (!matchesWakeWord(heard)) return;
        const rest = stripWakeWord(heard);
        setWakeHeard(true);
        window.setTimeout(() => setWakeHeard(false), 1500);
        enterCommand();
        // Words spoken after the name are already the command.
        if (rest.length > 2) {
          finalRef.current = rest;
          setTranscript(rest);
          scheduleSubmit(SILENCE_AFTER_INTERIM_MS);
        }
        return;
      }

      if (modeRef.current === "command") {
        if (finals) finalRef.current += (finalRef.current ? " " : "") + finals.trim();
        const shown = `${finalRef.current} ${interim}`.trim();
        setTranscript(shown);
        if (finalRef.current || interim) {
          scheduleSubmit(interim ? SILENCE_AFTER_INTERIM_MS : SILENCE_AFTER_FINAL_MS);
        }
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        permissionDeniedRef.current = true;
        setLastError(
          "Mikrofon izni verilmedi. Adres çubuğundaki mikrofon simgesinden izin verip tekrar dene.",
        );
        toast.error("Mikrofon izni yok", {
          description: "Adres çubuğundaki mikrofon simgesinden izin verip tekrar dene.",
        });
        goIdle();
      }
      // 'no-speech' / 'aborted' are normal in a long-running stream: onend respawns.
    };

    rec.onend = () => {
      engineRef.current = null;
      // Chrome ends a continuous stream on silence or after ~60s; respawn to stay live.
      if (modeRef.current !== "off" && !permissionDeniedRef.current) {
        window.setTimeout(() => spawnEngine(), 300);
      }
    };

    try {
      rec.start();
      engineRef.current = rec;
    } catch {
      // Another instance was still shutting down — retry shortly.
      engineRef.current = null;
      window.setTimeout(() => spawnEngine(), 450);
    }
  }, [clearSilence, enterCommand, enterWake, goIdle, releaseMic, stopMeter]);

  // Mic button / orb tap. Switching from wake to command is a flag flip on the SAME
  // engine, so it reacts on the first click instead of fighting a second recogniser.
  const toggleListening = useCallback(() => {
    if (!voiceSupported) {
      const msg =
        "Tarayıcın Türkçe sesli dinlemeyi (Web Speech API) desteklemiyor. Chrome veya Edge kullan; yazılı komut her zaman çalışır.";
      setLastError(msg);
      toast.error("Mikrofon desteklenmiyor", { description: msg });
      return;
    }
    permissionDeniedRef.current = false;
    // A deliberate press always wins over the "resume wake after speaking" handoff.
    pausedForSpeechRef.current = false;

    if (modeRef.current === "command") {
      // Second tap = "I'm done": submit whatever was captured right now.
      const said = finalRef.current.trim() || transcript.trim();
      clearSilence();
      finalRef.current = "";
      if (wakeEnabledRef.current) enterWake();
      else goIdle();
      if (said) sendRef.current?.(said);
      return;
    }

    stopSpeaking();
    enterCommand();
    spawnEngine();
  }, [
    clearSilence,
    enterCommand,
    enterWake,
    goIdle,
    spawnEngine,
    stopSpeaking,
    transcript,
    voiceSupported,
  ]);

  // Arm or disarm the wake listener when the setting changes.
  useEffect(() => {
    wakeEnabledRef.current = settings?.wake_word_enabled === true;
    if (!voiceSupported) return;

    if (wakeEnabledRef.current) {
      if (modeRef.current === "off" && orbState !== "speaking") {
        enterWake();
        spawnEngine();
      }
    } else if (modeRef.current === "wake") {
      goIdle();
    }
  }, [settings?.wake_word_enabled, voiceSupported, enterWake, goIdle, spawnEngine, orbState]);

  // Never let JARVIS hear its own voice: park the wake listener while it speaks.
  useEffect(() => {
    if (orbState === "speaking") {
      if (modeRef.current === "wake") {
        pausedForSpeechRef.current = true;
        modeRef.current = "off";
        stopEngine();
        setWakeArmed(false);
      }
      return;
    }
    if (pausedForSpeechRef.current && wakeEnabledRef.current) {
      pausedForSpeechRef.current = false;
      // Only re-arm if nothing else claimed the engine meanwhile. Without this guard a
      // mic tap during (or right at the end of) a spoken reply gets overwritten back to
      // wake mode, and the user's press appears to do nothing.
      if (modeRef.current === "off") {
        enterWake();
        spawnEngine();
      }
    }
  }, [orbState, enterWake, spawnEngine, stopEngine]);

  useEffect(
    () => () => {
      modeRef.current = "off";
      clearSilence();
      stopEngine();
      releaseMic();
      stopMeter();
    },
    [clearSilence, releaseMic, stopEngine, stopMeter],
  );

  // ----------------------------------------------------------------- media
  const playTrack = useCallback((t: Track) => {
    setTrack(t);
    setPlaying(true);
    void apiPost("/media/log", { action: "play", title: t.title }).catch(() => undefined);
  }, []);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);

  const stopTrack = useCallback(() => {
    setPlaying(false);
    void apiPost("/media/log", { action: "stop", title: track?.title ?? "" }).catch(() => undefined);
  }, [track]);

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
    wakeArmed,
    wakeHeard,
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
