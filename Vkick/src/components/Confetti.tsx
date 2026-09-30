import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  spin: number;
  color: string;
  life: number;
}

// Tokens only (tokens.css): volt, gold, turf, ink. No off-palette confetti.
const COLORS = ["#1FBFA0", "#F2B705", "#23A066", "#EDF7F3"];

/**
 * Signature animation 1 (second half): a 1.2s confetti burst on a goal.
 * Canvas rather than DOM nodes so a few hundred particles stay GPU-cheap on the
 * low-end Android devices Telegram's webview runs on.
 *
 * Bump `trigger` to fire. Reduced-motion users get nothing.
 */
export function ConfettiBurst({ trigger, particleCount = 140 }: { trigger: number; particleCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!trigger) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const originX = width / 2;
    const originY = height * 0.32;

    const particles: Particle[] = Array.from({ length: particleCount }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const speed = 5 + Math.random() * 9;
      return {
        x: originX + (Math.random() - 0.5) * 60,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.4,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      };
    });

    const started = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const elapsed = now - started;
      ctx.clearRect(0, 0, width, height);

      for (const particle of particles) {
        particle.vy += 0.22;
        particle.vx *= 0.992;
        particle.vy *= 0.992;
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.rot += particle.spin;
        particle.life = Math.max(0, 1 - elapsed / 1200);

        ctx.save();
        ctx.globalAlpha = particle.life;
        ctx.translate(particle.x, particle.y);
        ctx.rotate(particle.rot);
        ctx.fillStyle = particle.color;
        ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 1.6);
        ctx.restore();
      }

      if (elapsed < 1200) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
        frameRef.current = null;
      }
    };

    frameRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [trigger, particleCount]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[55] h-full w-full"
      aria-hidden="true"
    />
  );
}
