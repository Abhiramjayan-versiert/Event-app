"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { toast } from "sonner";
import { Camera, CameraOff, CheckCircle2, CircleAlert, ImageUp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { checkInAction, type CheckInResult } from "./actions";

const MESSAGES: Record<CheckInResult["result"], { title: string; tone: string; icon: typeof CheckCircle2 }> = {
  ok: { title: "Checked in. Welcome!", tone: "border-lime-dark bg-lime/20", icon: CheckCircle2 },
  already: { title: "Already checked in", tone: "border-amber-500 bg-amber-100 dark:bg-amber-900/30", icon: CircleAlert },
  not_confirmed: { title: "Not confirmed: payment pending", tone: "border-amber-500 bg-amber-100 dark:bg-amber-900/30", icon: CircleAlert },
  cancelled: { title: "Registration cancelled", tone: "border-destructive bg-destructive/10", icon: XCircle },
  not_found: { title: "Ticket not found for this event", tone: "border-destructive bg-destructive/10", icon: XCircle },
};

function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    o.frequency.value = ok ? 880 : 220;
    o.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
    navigator.vibrate?.(ok ? 80 : [80, 60, 80]);
  } catch {
    // Audio is optional.
  }
}

/** Camera QR scanner with manual entry fallback. */
export function CheckInScanner({ eventId }: { eventId: string }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const lastCode = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const busy = useRef(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState("");
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [pending, start] = useTransition();

  const submit = useCallback((code: string) => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      const r = await checkInAction(eventId, code);
      busy.current = false;
      if (!r.ok) return void toast.error(r.error);
      setResult(r.data!);
      beep(r.data!.result === "ok");
      if (r.data!.result === "ok") router.refresh();
    });
  }, [eventId, router]);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCameraOn(false);
  }, []);

  const [cameraHelp, setCameraHelp] = useState<string | null>(null);

  const startCamera = async () => {
    setCameraHelp(null);
    const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|GSA\/|; wv\)/i.test(navigator.userAgent);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraHelp(inApp
        ? "This in-app browser can't use the camera. Open the page in Chrome or Safari (menu → Open in browser), or use “Scan with a photo” below."
        : "This browser can't use the live camera here. Use “Scan with a photo” below, or open the page in Chrome or Safari.");
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = s;
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play();
      }
      setCameraHelp(null);
      setCameraOn(true);
    } catch (e) {
      const name = (e as DOMException)?.name ?? "";
      setCameraHelp(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera access is blocked for this site. Tap the lock or ⓘ icon next to the address (Android: ⋮ → Settings → Site settings → Camera; iPhone: aA → Website Settings → Camera), choose Allow, then reload. Or use “Scan with a photo”."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No camera was found on this device. Use “Scan with a photo” or type the code."
            : name === "NotReadableError"
              ? "The camera is being used by another app. Close it and try again, or use “Scan with a photo”."
              : "The camera couldn't start. Use “Scan with a photo” or type the code.",
      );
    }
  };

  /** Fallback: take a photo with the phone's camera app and read the QR from it. */
  const scanPhoto = async (file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    try {
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); img.src = url; });
      const c = canvas.current ?? document.createElement("canvas");
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      // Try a few sizes: large photos decode better scaled down.
      for (const max of [1000, 1600, 700]) {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) return submit(code.data);
      }
      toast.error("No QR code found in that photo. Hold the phone steady, fill the frame with the QR code and try again.");
    } catch {
      toast.error("Couldn't read that photo.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  useEffect(() => {
    if (!cameraOn) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        const w = Math.min(640, v.videoWidth);
        const h = Math.round((v.videoHeight / v.videoWidth) * w);
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(v, 0, 0, w, h);
          const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
          const now = Date.now();
          // Ignore the same code for 4 s so one ticket isn't scanned repeatedly.
          if (code?.data && (code.data !== lastCode.current.code || now - lastCode.current.at > 4000)) {
            lastCode.current = { code: code.data, at: now };
            submit(code.data);
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cameraOn, submit]);

  useEffect(() => stop, [stop]);

  const m = result ? MESSAGES[result.result] : null;
  return (
    <div className="space-y-4">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-xl border bg-ink">
        <video ref={video} playsInline muted className={cn("size-full object-cover", !cameraOn && "hidden")} />
        <canvas ref={canvas} className="hidden" />
        {cameraOn ? <div className="pointer-events-none absolute inset-10 rounded-lg border-2 border-lime/80" /> : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
            <Camera className="size-10 text-lime" />
            <p className="text-sm">Point the camera at the participant's ticket QR code.</p>
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {cameraOn ? <Button variant="outline" onClick={stop}><CameraOff /> Stop camera</Button> : <Button onClick={startCamera}><Camera /> Start camera</Button>}
        <Button variant="outline" asChild>
          <label className="cursor-pointer">
            <ImageUp /> Scan with a photo
            <input type="file" accept="image/*" capture="environment" className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void scanPhoto(f); }} />
          </label>
        </Button>
      </div>
      {cameraHelp ? <p role="alert" className="mx-auto max-w-sm rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-900/30 dark:text-amber-100">{cameraHelp}</p> : null}
      <form className="mx-auto flex max-w-sm gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { submit(manual); setManual(""); } }}>
        <Input placeholder="Or type the ticket code" value={manual} onChange={(e) => setManual(e.target.value)} className="font-mono uppercase" aria-label="Ticket code" />
        <Button type="submit" variant="outline" loading={pending}>Check in</Button>
      </form>
      {result && m ? (
        <div className={cn("mx-auto max-w-sm rounded-lg border-2 p-4", m.tone)} role="status" aria-live="polite">
          <div className="flex items-center gap-2 font-semibold"><m.icon className="size-5" />{m.title}</div>
          {result.participant_name ? (
            <div className="mt-2 space-y-0.5 text-sm">
              <p className="text-base font-medium">{result.participant_name}</p>
              <p className="text-muted-foreground">{[result.registration_number, result.participant_college, result.team_name].filter(Boolean).join(" · ")}</p>
              {result.items?.length ? <p>{result.items.join(", ")}</p> : null}
              {result.result === "already" && result.checked_in_at ? <p>First checked in at {new Date(result.checked_in_at).toLocaleTimeString()}</p> : null}
              {result.is_test ? <p className="font-semibold text-destructive">TEST registration: not valid for entry</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
