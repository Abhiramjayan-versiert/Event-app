/**
 * Content-Security-Policy with a per-request nonce. Next.js reads the policy
 * from the request headers and adds the nonce to its own scripts;
 * 'strict-dynamic' then trusts the chunks those scripts load (including the
 * on-demand Excel/PDF exporters). Inline styles stay allowed because Radix
 * and Recharts position elements with style attributes.
 */
export function buildCsp(nonce: string, supabaseUrl: string | undefined, dev = process.env.NODE_ENV !== "production") {
  let supabase = "";
  let supabaseWs = "";
  try {
    if (supabaseUrl) {
      const u = new URL(supabaseUrl);
      supabase = u.origin;
      supabaseWs = `${u.protocol === "https:" ? "wss:" : "ws:"}//${u.host}`;
    }
  } catch {
    // Misconfigured URL: the app shows /setup-required; keep the policy strict.
  }
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", supabase, "https://cdn.razorpay.com"].filter(Boolean),
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabase, supabaseWs, "https://api.razorpay.com", "https://lumberjack.razorpay.com", ...(dev ? ["ws:"] : [])].filter(Boolean),
    "worker-src": ["'self'", "blob:"],
    // Razorpay Checkout runs in its own frame on the public registration page.
    "frame-src": ["'self'", supabase, "https://api.razorpay.com", "https://checkout.razorpay.com"].filter(Boolean),
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
  return dev ? policy : `${policy}; upgrade-insecure-requests`;
}

export function createNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
