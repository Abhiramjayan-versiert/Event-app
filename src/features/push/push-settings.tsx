"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pushPublicKeyAction, removePushSubscriptionAction, savePushSubscriptionAction, testPushAction } from "./actions";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/** Turn phone/desktop notifications on or off for this device. */
export function PushSettings() {
  const [state, setState] = useState<State>("loading");
  const [pending, start] = useTransition();

  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setState(ios && !standalone ? "ios-install" : "unsupported");
      }
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = () => start(async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return void setState(perm === "denied" ? "denied" : "off");
    const k = await pushPublicKeyAction();
    if (!k.ok) return void toast.error(k.error);
    const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(k.data!.key) });
    const r = await savePushSubscriptionAction(sub.toJSON(), navigator.userAgent);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Notifications on");
    setState("on");
  });

  const disable = () => start(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await removePushSubscriptionAction(sub.endpoint);
      await sub.unsubscribe();
    }
    toast.success("Notifications are off for this device.");
    setState("off");
  });

  if (state === "loading") return <p className="text-sm text-muted-foreground">Checking this device…</p>;
  if (state === "ios-install") return <p className="text-sm text-muted-foreground">On iPhone and iPad, first add EVENT APP to your Home Screen (Share → Add to Home Screen), open it from there, then turn notifications on here.</p>;
  if (state === "unsupported") return <p className="text-sm text-muted-foreground">This browser doesn&apos;t support notifications. Try Chrome, Edge, Firefox or Safari 16.4+.</p>;
  if (state === "denied") return <p className="text-sm text-muted-foreground">Notifications are blocked for this site. Allow them in your browser&apos;s site settings, then reload.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {state === "on" ? (
        <>
          <Button variant="outline" onClick={disable} loading={pending}><BellOff /> Turn off on this device</Button>
          <Button variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await testPushAction(); if (r.ok) toast.success(r.message ?? "Sent"); else toast.error(r.error); })}><Send /> Send a test</Button>
        </>
      ) : (
        <Button onClick={enable} loading={pending}><Bell /> Turn on notifications</Button>
      )}
    </div>
  );
}
