// Futuristic depth layer: fading grid, drifting particle mesh, scanline sweep.
// Purely decorative and pointer-transparent, so it never intercepts a click.

import { useEffect, useRef } from "react";

export default function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dots: { x: number; y: number; vx: number; vy: number; r: number }[] = [];

    const resize = () => {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const count = Math.min(62, Math.round((w * h) / 26000));
    for (let i = 0; i < count; i += 1) {
      dots.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.5 + 0.5,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.x += d.vx;
        d.y += d.vy;
        if (d.x < 0 || d.x > w) d.vx *= -1;
        if (d.y < 0 || d.y > h) d.vy *= -1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 240, 255, 0.42)";
        ctx.fill();
      }
      for (let i = 0; i < dots.length; i += 1) {
        for (let j = i + 1; j < dots.length; j += 1) {
          const dx = dots[i].x - dots[j].x;
          const dy = dots[i].y - dots[j].y;
          const dist = Math.hypot(dx, dy);
          if (dist < 132) {
            ctx.beginPath();
            ctx.moveTo(dots[i].x, dots[i].y);
            ctx.lineTo(dots[j].x, dots[j].y);
            ctx.strokeStyle = `rgba(0, 240, 255, ${0.1 * (1 - dist / 132)})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[#060a14]" />
      <div
        className="grid-backdrop absolute inset-0"
        style={{
          maskImage: "radial-gradient(ellipse 85% 70% at 50% 42%, black 20%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 85% 70% at 50% 42%, black 20%, transparent 78%)",
        }}
      />
      <div
        className="absolute left-1/2 top-[38%] h-[640px] w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: "radial-gradient(circle, rgba(0,112,243,0.14) 0%, transparent 65%)" }}
      />
      <div
        className="absolute -right-32 top-0 h-[420px] w-[420px] rounded-full"
        style={{ background: "radial-gradient(circle, rgba(0,240,255,0.08) 0%, transparent 70%)" }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full opacity-70" />
      <div
        className="absolute inset-x-0 h-24 animate-scan"
        style={{
          background: "linear-gradient(to bottom, transparent, rgba(0,240,255,0.045), transparent)",
        }}
      />
    </div>
  );
}
