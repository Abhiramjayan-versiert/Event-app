"use client";

import { useEffect } from "react";

/** Surfaces that react to the pointer like liquid glass. */
const SELECTOR = '.bg-card, .glass, .bg-popover, [data-slot="button"], [data-liquid]';

/**
 * Liquid-glass pointer effects: a soft light that follows the pointer across
 * glass surfaces ("glass spill") and a droplet ripple where a button is pressed.
 * Only sets CSS variables; the look lives in globals.css.
 */
export function LiquidPointer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last: HTMLElement | null = null;
    let pending: PointerEvent | null = null;

    const apply = () => {
      frame = 0;
      const e = pending;
      if (!e) return;
      const el = (e.target as Element | null)?.closest?.(SELECTOR) as HTMLElement | null;
      if (last && last !== el) last.style.removeProperty("--spot");
      if (el) {
        const r = el.getBoundingClientRect();
        el.style.setProperty("--mx", `${e.clientX - r.left}px`);
        el.style.setProperty("--my", `${e.clientY - r.top}px`);
        el.style.setProperty("--spot", "1");
      }
      last = el;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      pending = e;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onLeave = () => {
      last?.style.removeProperty("--spot");
      last = null;
    };
    const onDown = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-slot="button"], [data-liquid]') as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--rx", `${e.clientX - r.left}px`);
      el.style.setProperty("--ry", `${e.clientY - r.top}px`);
      el.removeAttribute("data-ripple");
      void el.offsetWidth; // restart the animation
      el.setAttribute("data-ripple", "");
      window.setTimeout(() => el.removeAttribute("data-ripple"), 650);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    document.addEventListener("pointerdown", onDown, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("pointerdown", onDown);
    };
  }, []);
  return null;
}
