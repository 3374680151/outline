import * as React from "react";
import styled from "styled-components";

type PointerState = {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  active: boolean;
};

type Star = {
  x: number;
  y: number;
  r: number;
  base: number;
  amp: number;
  speed: number;
  phase: number;
  depth: number;
  vx: number;
  vy: number;
  warm: boolean;
};

type Meteor = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
};

/**
 * Deep-space starfield backdrop: parallax stars with twinkle and the occasional
 * meteor, drawn on a canvas. Pauses while the page is hidden and renders a
 * single static frame when the user prefers reduced motion.
 */
export function Starfield() {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    const ctx = context;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let rafId = 0;
    let stars: Star[] = [];
    let meteors: Meteor[] = [];
    let nextMeteorAt = 0;
    let running = true;
    let width = 0;
    let height = 0;
    const pointer: PointerState = {
      x: 0,
      y: 0,
      rawX: 0,
      rawY: 0,
      active: false,
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from(
        { length: Math.min(230, Math.floor((width * height) / 8200)) },
        () => {
          const depth = 0.25 + Math.random() * 0.75;
          return {
            x: Math.random() * width,
            y: Math.random() * height,
            r: (0.35 + Math.random() * 1.25) * depth,
            base: 0.25 + Math.random() * 0.45,
            amp: 0.12 + Math.random() * 0.3,
            speed: 0.4 + Math.random() * 1.6,
            phase: Math.random() * Math.PI * 2,
            depth,
            vx: -depth * 0.014,
            vy: depth * 0.02,
            warm: Math.random() < 0.12,
          };
        }
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - cx) / cx));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - cy) / cy));
      pointer.rawX = event.clientX;
      pointer.rawY = event.clientY;
      pointer.active = true;
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    const spawnMeteor = (now: number) => {
      if (now < nextMeteorAt) {
        return;
      }
      nextMeteorAt = now + 4500 + Math.random() * 7000;
      const fromLeft = Math.random() < 0.5;
      meteors.push({
        x: fromLeft
          ? Math.random() * width * 0.4
          : width * (0.6 + Math.random() * 0.4),
        y: Math.random() * height * 0.35,
        vx: (fromLeft ? 1 : -1) * (5.5 + Math.random() * 3.5),
        vy: 3.2 + Math.random() * 2.2,
        life: 0,
        maxLife: 46 + Math.random() * 26,
      });
    };

    const drawFrame = (now: number) => {
      ctx.clearRect(0, 0, width, height);
      const px = pointer.active ? pointer.x : 0;
      const py = pointer.active ? pointer.y : 0;
      const t = now / 1000;

      for (const star of stars) {
        if (!reducedMotion) {
          star.x += star.vx;
          star.y += star.vy;
          if (star.x < -4) {
            star.x = width + 4;
          }
          if (star.y > height + 4) {
            star.y = -4;
          }
        }
        const alpha = Math.max(
          0.05,
          star.base + Math.sin(t * star.speed + star.phase) * star.amp
        );
        const ox = px * star.depth * 14;
        const oy = py * star.depth * 9;
        ctx.beginPath();
        ctx.arc(star.x + ox, star.y + oy, star.r, 0, Math.PI * 2);
        ctx.fillStyle = star.warm
          ? `rgba(255, 190, 120, ${alpha})`
          : `rgba(190, 220, 255, ${alpha})`;
        ctx.fill();
      }

      if (!reducedMotion) {
        spawnMeteor(now);
        meteors = meteors.filter((meteor) => meteor.life < meteor.maxLife);
        for (const meteor of meteors) {
          meteor.x += meteor.vx;
          meteor.y += meteor.vy;
          meteor.life += 1;
          const fade = 1 - meteor.life / meteor.maxLife;
          const gradient = ctx.createLinearGradient(
            meteor.x,
            meteor.y,
            meteor.x - meteor.vx * 9,
            meteor.y - meteor.vy * 9
          );
          gradient.addColorStop(0, `rgba(200, 230, 255, ${0.85 * fade})`);
          gradient.addColorStop(1, "rgba(200, 230, 255, 0)");
          ctx.strokeStyle = gradient;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(meteor.x, meteor.y);
          ctx.lineTo(meteor.x - meteor.vx * 9, meteor.y - meteor.vy * 9);
          ctx.stroke();
        }
      }
    };

    const loop = (now: number) => {
      if (!running) {
        return;
      }
      drawFrame(now);
      rafId = requestAnimationFrame(loop);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(rafId);
      } else if (!running) {
        running = true;
        rafId = requestAnimationFrame(loop);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointerleave", handlePointerLeave);
    window.addEventListener("blur", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    if (reducedMotion) {
      drawFrame(0);
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerleave", handlePointerLeave);
      window.removeEventListener("blur", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return <Canvas ref={canvasRef} aria-hidden="true" />;
}

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
`;
