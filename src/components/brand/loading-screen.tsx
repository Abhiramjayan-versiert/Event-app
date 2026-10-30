import { Logo } from "@/components/brand/logo";

/** Branded full-screen loading state. */
export function LoadingScreen({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5" role="status" aria-live="polite">
      <Logo size="lg" />
      <div className="h-0.5 w-32 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <span className="sr-only">{label}…</span>
      <style>{`@keyframes loading-bar{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}
