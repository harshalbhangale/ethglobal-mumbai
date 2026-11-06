"use client";

import { useEffect, useRef } from "react";

/**
 * The particle knot behind the landing hero, ported from the team's earlier X trading site
 * (apps/web/components/signal-field.tsx there). A 3D torus knot of dots projected onto a canvas,
 * turning slowly and leaning toward the mouse. Decorative only: no prices or data in it.
 * It stops when off screen, when the tab is hidden, and for reduced motion.
 */
export function SignalField() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let last = 0;
    let time = 0;
    let width = 0;
    let height = 0;
    let visible = true;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;

    const points: { u: number; v: number }[] = [];
    for (let ring = 0; ring < 180; ring++)
      for (let tube = 0; tube < 28; tube++) points.push({ u: (ring / 180) * Math.PI * 2, v: (tube / 28) * Math.PI * 2 });

    function size() {
      if (!element || !context) return;
      width = element.clientWidth;
      height = element.clientHeight;
      const ratio = Math.min(window.devicePixelRatio, 1.5);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    const moving = () => !reduced.matches && visible && !document.hidden;

    function draw(now: number) {
      if (!context) return;
      // About 30 frames a second is plenty for a slow knot.
      if (now - last > 32 || !last) {
        const delta = last ? Math.min((now - last) / 1000, 0.05) : 0;
        last = now;
        if (moving()) time += delta * 0.55;
        pointerX += (targetX - pointerX) * 0.065;
        pointerY += (targetY - pointerY) * 0.065;
        context.clearRect(0, 0, width, height);
        const scale = Math.min(width, height) * 0.34;
        const rotation = time * 0.3 + pointerX * 0.65;
        const tilt = 0.65 + pointerY * 0.4;
        const ca = Math.cos(rotation);
        const sa = Math.sin(rotation);
        const ct = Math.cos(tilt);
        const st = Math.sin(tilt);
        for (const { u, v } of points) {
          const twist = v + u * 3 + Math.sin(u * 3 + time) * 0.4;
          const radius = 1 + 0.15 * Math.cos(u * 3 + time);
          const tube = 0.33 + 0.09 * Math.sin(u * 4 - time * 0.8);
          const rawX = (radius + tube * Math.cos(twist)) * Math.cos(u);
          const rawY = (radius + tube * Math.cos(twist)) * Math.sin(u);
          const rawZ = tube * Math.sin(twist) + 0.2 * Math.cos(u * 3 + time);
          const rx = rawX * ca + rawZ * sa;
          const rz = -rawX * sa + rawZ * ca;
          const ry = rawY * ct - rz * st;
          const z = rawY * st + rz * ct;
          const perspective = 3.5 / (3.5 - z);
          const x = width * 0.56 + rx * scale * perspective;
          const y = height * 0.5 + ry * scale * perspective;
          const brightness = Math.max(0.12, Math.min(1, (z + 1.8) / 3));
          // Grey-green dots; the nearest ones lean toward Kallr lime.
          const lime = Math.max(0, brightness - 0.7) / 0.3;
          context.fillStyle = `rgba(${Math.round(118 + lime * 80)},${Math.round(138 + lime * 104)},${Math.round(116 - lime * 26)},${brightness * 0.38})`;
          context.beginPath();
          context.arc(x, y, Math.max(0.35, (0.7 + brightness * 1.15) * perspective), 0, Math.PI * 2);
          context.fill();
        }
      }
      if (moving()) frame = requestAnimationFrame(draw);
    }

    function restart() {
      cancelAnimationFrame(frame);
      last = 0;
      draw(performance.now());
    }

    const hero = element.closest("section");
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const bounds = hero?.getBoundingClientRect();
      if (!bounds) return;
      targetX = (event.clientX - bounds.left) / bounds.width - 0.5;
      targetY = (event.clientY - bounds.top) / bounds.height - 0.5;
    };
    const leave = () => {
      targetX = 0;
      targetY = 0;
    };
    hero?.addEventListener("pointermove", pointer);
    hero?.addEventListener("pointerleave", leave);
    const resize = new ResizeObserver(() => {
      size();
      restart();
    });
    resize.observe(element);
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      restart();
    });
    intersection.observe(element);
    document.addEventListener("visibilitychange", restart);
    reduced.addEventListener("change", restart);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      intersection.disconnect();
      hero?.removeEventListener("pointermove", pointer);
      hero?.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", restart);
      reduced.removeEventListener("change", restart);
    };
  }, []);

  return (
    <div className="signal-field" aria-hidden="true">
      <canvas ref={canvas} />
    </div>
  );
}
