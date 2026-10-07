// The command center's visual anchor: a multi-ring reactive orb.
// IDLE faint pulse · LISTENING mic-amplitude ripples · THINKING fast counter-rotation
// · SPEAKING outward shockwaves locked to the TTS audio envelope.

import { useMemo } from "react";

import type { OrbState } from "@/lib/jarvis";

const STATE_COPY: Record<OrbState, { label: string; hint: string }> = {
  idle: { label: "HAZIR", hint: "Mikrofona bas ya da yaz" },
  listening: { label: "DİNLİYOR", hint: "Seni duyuyorum..." },
  thinking: { label: "DÜŞÜNÜYOR", hint: "Ajanları çalıştırıyorum" },
  speaking: { label: "KONUŞUYOR", hint: "Yanıtı iletiyorum" },
};

const CORE: Record<OrbState, string> = {
  idle: "#00f0ff",
  listening: "#38bdf8",
  thinking: "#0070f3",
  speaking: "#00f0ff",
};

interface Props {
  state: OrbState;
  level: number;
  size?: number;
  onActivate?: () => void;
}

export default function JarvisOrb({ state, level, size = 320, onActivate }: Props) {
  const amp = Math.max(0, Math.min(1, level));
  const reactive = state === "listening" || state === "speaking";
  const core = CORE[state];

  const scale = reactive ? 1 + amp * 0.22 : state === "thinking" ? 1.05 : 1;
  const glow = reactive ? 40 + amp * 70 : state === "thinking" ? 80 : 42;
  const copy = STATE_COPY[state];

  // Equaliser bars around the orb, so voice activity is legible even at a glance.
  const bars = useMemo(() => Array.from({ length: 36 }, (_, i) => i), []);

  return (
    <div
      className="relative flex flex-col items-center justify-center select-none"
      data-testid="jarvis-orb-container"
      data-orb-state={state}
    >
      <button
        type="button"
        onClick={onActivate}
        aria-label="JARVIS Orb — sesli komutu başlat"
        className="relative grid place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
        style={{ width: size, height: size }}
        data-testid="jarvis-orb-button"
      >
        {/* radial stage glow */}
        <div
          className="pointer-events-none absolute inset-[-28%] rounded-full"
          style={{
            background: `radial-gradient(circle at center, ${core}22 0%, transparent 68%)`,
            transition: "background 400ms ease",
          }}
        />

        {/* speaking shockwaves */}
        {state === "speaking" && (
          <>
            <span
              className="pointer-events-none absolute inset-0 rounded-full border animate-shock"
              style={{ borderColor: `${core}66` }}
            />
            <span
              className="pointer-events-none absolute inset-0 rounded-full border animate-shock"
              style={{ borderColor: `${core}44`, animationDelay: "0.8s" }}
            />
            <span
              className="pointer-events-none absolute inset-0 rounded-full border animate-shock"
              style={{ borderColor: `${core}33`, animationDelay: "1.6s" }}
            />
          </>
        )}

        {/* outer ring — clockwise */}
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-0 h-full w-full animate-ring-spin"
          style={{ animationDuration: state === "thinking" ? "2.4s" : state === "listening" ? "7s" : "16s" }}
        >
          <circle
            cx="100"
            cy="100"
            r="94"
            fill="none"
            stroke={core}
            strokeOpacity="0.35"
            strokeWidth="0.7"
            strokeDasharray="2 7"
          />
          <circle
            cx="100"
            cy="100"
            r="86"
            fill="none"
            stroke={core}
            strokeOpacity="0.5"
            strokeWidth="1.1"
            strokeDasharray="56 240"
            strokeLinecap="round"
          />
        </svg>

        {/* mid ring — counter-clockwise */}
        <svg
          viewBox="0 0 200 200"
          className="absolute inset-[9%] h-[82%] w-[82%] animate-ring-counter"
          style={{ animationDuration: state === "thinking" ? "1.6s" : "20s" }}
        >
          <circle
            cx="100"
            cy="100"
            r="92"
            fill="none"
            stroke="#0070f3"
            strokeOpacity="0.45"
            strokeWidth="1.4"
            strokeDasharray="30 18"
          />
        </svg>

        {/* amplitude equaliser ring */}
        <div className="pointer-events-none absolute inset-[14%]">
          {bars.map((i) => {
            const angle = (i / bars.length) * 360;
            const wave = reactive
              ? 6 + amp * 34 * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7)))
              : 5 + (i % 3) * 1.5;
            return (
              <span
                key={i}
                className="absolute left-1/2 top-1/2 origin-bottom rounded-full"
                style={{
                  width: 2,
                  height: wave,
                  background: core,
                  opacity: reactive ? 0.55 + amp * 0.4 : 0.25,
                  transform: `rotate(${angle}deg) translateY(-${size * 0.37}px)`,
                  transition: "height 90ms linear, opacity 160ms linear",
                }}
              />
            );
          })}
        </div>

        {/* inner halo */}
        <div
          className="absolute inset-[24%] rounded-full animate-orb-drift"
          style={{
            background: `radial-gradient(circle at 34% 30%, #ffffff55 0%, ${core}aa 24%, #0070f388 58%, #04101f 100%)`,
            boxShadow: `0 0 ${glow}px ${core}, inset 0 0 ${glow * 0.6}px ${core}55`,
            transform: `scale(${scale})`,
            transition: "box-shadow 120ms linear, transform 90ms linear, background 400ms ease",
            animationDuration: state === "thinking" ? "3s" : "9s",
          }}
        />

        {/* core spark */}
        <div
          className="absolute rounded-full animate-flicker"
          style={{
            width: size * 0.1 + amp * size * 0.07,
            height: size * 0.1 + amp * size * 0.07,
            background: "#ffffff",
            filter: `blur(${2 + amp * 5}px)`,
            opacity: 0.85,
          }}
        />
      </button>

      <div className="mt-6 flex flex-col items-center gap-1" data-testid="orb-state-readout">
        <span className="mono-label" style={{ color: core }}>
          {copy.label}
        </span>
        <span className="text-xs text-slate-400">{copy.hint}</span>
      </div>
    </div>
  );
}
