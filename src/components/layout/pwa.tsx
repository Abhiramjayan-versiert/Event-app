"use client";

import { useEffect, useState } from "react";
import { Download, Share } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

/** Registers the service worker once (production only). */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isAppleMobile() {
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a Mac; touch support gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** "Install app" entry for the account menu. Hidden once installed. */
export function InstallAppMenuItem() {
  const [, force] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  if (!mounted || isStandalone()) return null;

  if (deferred) {
    return (
      <DropdownMenuItem
        onSelect={async () => {
          const e = deferred;
          if (!e) return;
          await e.prompt();
          const { outcome } = await e.userChoice;
          if (outcome === "accepted") toast.success("EVENT APP is being installed.");
          deferred = null;
          listeners.forEach((x) => x());
        }}
      >
        <Download /> Install app
      </DropdownMenuItem>
    );
  }

  const apple = isAppleMobile();
  const safariMac = /Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Edg|Firefox/.test(navigator.userAgent);
  if (!apple && !safariMac) return null;
  return (
    <DropdownMenuItem
      onSelect={() =>
        toast.info(
          apple
            ? "In Safari, tap the Share button, then “Add to Home Screen”."
            : "In Safari, choose File → “Add to Dock”.",
          { duration: 8000 },
        )
      }
    >
      <Share /> Install app
    </DropdownMenuItem>
  );
}
