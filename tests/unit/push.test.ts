import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, Agent, type Server } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createECDH, randomBytes } from "node:crypto";
import webpush from "web-push";
// @ts-expect-error -- http_ece ships without types (web-push dependency)
import ece from "http_ece";

const keys = webpush.generateVAPIDKeys();
const dropped: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, string>) => {
      if (fn === "push_config_get") return { data: { vapid_public: keys.publicKey, vapid_private: keys.privateKey, dispatch_secret: "s3cret" }, error: null };
      if (fn === "drop_push_subscription") dropped.push(args.p_endpoint);
      return { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/env", () => ({ publicEnv: { appUrl: "https://event-app.example", supabaseUrl: "", supabaseAnonKey: "" } }));

const { sendPush, secretMatches } = await import("@/lib/push/server");

// A fake push service that decrypts what it receives like a browser would.
const browser = createECDH("prime256v1");
browser.generateKeys();
const authSecret = randomBytes(16);
let server: Server;
let base = "";
let agent: Agent;
const received: { auth?: string; body?: Record<string, string> }[] = [];

beforeAll(async () => {
  // Self-signed certificate for the fake push service; only this test trusts it.
  const dir = mkdtempSync(path.join(tmpdir(), "push-test-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
  const cert = readFileSync(path.join(dir, "cert.pem"));
  agent = new Agent({ ca: cert });
  server = createServer({ key: readFileSync(path.join(dir, "key.pem")), cert }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.url === "/gone") { res.statusCode = 410; return res.end(); }
      const plain = ece.decrypt(Buffer.concat(chunks), { version: "aes128gcm", privateKey: browser, authSecret });
      received.push({ auth: req.headers.authorization, body: JSON.parse(plain.toString()) });
      res.statusCode = 201;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `https://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("web push delivery", () => {
  it("encrypts the payload for the device and signs it with the VAPID key; drops gone subscriptions", async () => {
    const sub = { p256dh: browser.getPublicKey().toString("base64url"), auth: authSecret.toString("base64url") };
    const r = await sendPush(
      [{ endpoint: `${base}/ok`, ...sub }, { endpoint: `${base}/gone`, ...sub }],
      { title: "Duty: Gate", body: "10:00 · Main gate", link: "/events/x/duty-roster" },
      { agent },
    );
    expect(r).toEqual({ sent: 1, total: 2 });
    expect(received[0].body).toEqual({ title: "Duty: Gate", body: "10:00 · Main gate", url: "/events/x/duty-roster" });
    expect(received[0].auth).toMatch(new RegExp(`^vapid t=.+, k=${keys.publicKey}$`));
    expect(dropped).toEqual([`${base}/gone`]);
  });

  it("checks the dispatch secret in constant time", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches(null, "s3cret")).toBe(false);
  });
});
