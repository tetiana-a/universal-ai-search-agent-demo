"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, [role='button'], label, select, summary, [data-cursor='hover']";
const TEXT_ENTRY = "input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']), textarea, [contenteditable='true']";
const TRAIL = 7;

/**
 * Gold cursor: a precise dot, a lagging iridescent ring and a short fading trail.
 * Only on devices with a fine pointer and when the user has not asked for reduced motion;
 * everywhere else the native cursor stays untouched.
 */
export default function GoldCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches || reduced.matches) return;

    const dot = dotRef.current;
    const ring = ringRef.current;
    const trailHost = trailRef.current;
    if (!dot || !ring || !trailHost) return;

    const root = document.documentElement;
    root.classList.add("has-gold-cursor");

    const trail = Array.from(trailHost.children) as HTMLElement[];
    const points = Array.from({ length: TRAIL }, () => ({ x: -100, y: -100 }));
    let x = -100;
    let y = -100;
    let rx = -100;
    let ry = -100;
    let visible = false;
    let frame = 0;

    const setMode = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      const text = Boolean(el?.closest(TEXT_ENTRY));
      const hover = !text && Boolean(el?.closest(INTERACTIVE));
      ring.dataset.mode = text ? "text" : hover ? "hover" : "";
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
      x = event.clientX;
      y = event.clientY;
      if (!visible) {
        visible = true;
        rx = x;
        ry = y;
        points.forEach((p) => { p.x = x; p.y = y; });
        root.classList.add("gold-cursor-visible");
      }
      setMode(event.target);
    };
    const onLeave = () => {
      visible = false;
      root.classList.remove("gold-cursor-visible");
    };
    const onDown = () => ring.classList.add("is-pressed");
    const onUp = () => ring.classList.remove("is-pressed");

    const tick = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;

      let px = x;
      let py = y;
      points.forEach((p, i) => {
        p.x += (px - p.x) * 0.42;
        p.y += (py - p.y) * 0.42;
        px = p.x;
        py = p.y;
        const node = trail[i];
        if (node) node.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${1 - i / (TRAIL + 2)})`;
      });
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      root.classList.remove("has-gold-cursor", "gold-cursor-visible");
    };
  }, []);

  return (
    <div className="gold-cursor" aria-hidden="true">
      <div ref={trailRef} className="gold-cursor-trail">
        {Array.from({ length: TRAIL }, (_, i) => (
          <span key={i} style={{ opacity: 0.42 - i * 0.055 }} />
        ))}
      </div>
      <div ref={ringRef} className="gold-cursor-ring" />
      <div ref={dotRef} className="gold-cursor-dot" />
    </div>
  );
}
