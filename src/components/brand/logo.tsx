import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  /** "auto" follows the current text colour (black on light, white on dark). */
  tone?: "auto" | "light" | "dark";
  size?: "sm" | "md" | "lg" | "xl";
};

const sizes = { sm: "text-base", md: "text-lg", lg: "text-2xl", xl: "text-4xl" };

/** Typographic EVENT APP wordmark: EVENT in black/white, APP in lime. */
export function Logo({ className, tone = "auto", size = "md" }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-baseline font-black uppercase leading-none tracking-[-0.04em]",
        sizes[size],
        tone === "light" && "text-white",
        tone === "dark" && "text-ink",
        className,
      )}
      aria-label="EVENT APP"
    >
      <span>EVENT</span>
      {/* Bright lime on dark surfaces; the darker brand lime keeps contrast on white. */}
      <span className={cn("ml-[0.18em]", tone === "light" ? "text-lime" : tone === "dark" ? "text-lime-dark" : "text-lime-dark dark:text-lime")}>APP</span>
    </span>
  );
}

/** Compact square mark used where the full wordmark does not fit. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex size-8 items-center justify-center rounded-md bg-ink text-[13px] font-black tracking-[-0.06em] ring-1 ring-white/10", className)}
      aria-hidden
    >
      <span className="text-white">E</span>
      <span className="text-lime">A</span>
    </span>
  );
}
