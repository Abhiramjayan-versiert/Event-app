"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontWeight: 900, fontSize: 24, letterSpacing: "-0.04em" }}>
            EVENT <span style={{ color: "#91C927" }}>APP</span>
          </p>
          <p>Something went wrong. The error has been logged.</p>
          <button onClick={reset} style={{ background: "#B6F23A", border: 0, padding: "8px 16px", borderRadius: 6, fontWeight: 600, cursor: "pointer" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
