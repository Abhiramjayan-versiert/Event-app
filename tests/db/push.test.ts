import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, expectDenied, pool } from "./helpers";

type U = Awaited<ReturnType<typeof createUser>>;
let a: U, b: U;

beforeAll(async () => {
  [a, b] = await Promise.all([createUser("Push A"), createUser("Push B")]);
});
afterAll(() => pool.end());

describe("push subscriptions", () => {
  it("stores each user's devices privately and moves an endpoint to its latest owner", async () => {
    await asUser(a.id, (q) => q("select public.save_push_subscription('https://push.example/1', 'key', 'auth', 'Chrome')"));
    await expectDenied(asUser(a.id, (q) => q("select public.save_push_subscription('http://insecure/1', 'key', 'auth')")));
    expect(await asUser(b.id, (q) => q("select * from public.push_subscriptions"))).toHaveLength(0);
    expect(await asUser(a.id, (q) => q("select * from public.push_subscriptions"))).toHaveLength(1);
    await asUser(b.id, (q) => q("select public.remove_push_subscription('https://push.example/1')"));
    expect(await asUser(a.id, (q) => q("select * from public.push_subscriptions"))).toHaveLength(1);
    await expectDenied(asUser(b.id, (q) => q("select public.drop_push_subscription('https://push.example/1')")));
  });

  it("keeps push keys and payloads away from signed-in users", async () => {
    await expectDenied(asUser(a.id, (q) => q("select public.push_config_get()")));
    await expectDenied(asUser(a.id, (q) => q("select public.push_config_init('p', 's', 'x', 'https://x')")));
    await expectDenied(asUser(a.id, (q) => q("select * from app.push_config")));
    const [cfg] = await asOwner((q) => q<{ c: { vapid_public: string } }>("select public.push_config_init('pub', 'priv', 'secret', 'https://app.example') c"));
    expect(cfg.c.vapid_public).toBe("pub");
    const [again] = await asOwner((q) => q<{ c: { vapid_public: string } }>("select public.push_config_init('other', 'other', 'other', 'https://app.example') c"));
    expect(again.c.vapid_public).toBe("pub"); // first keys win
  });

  it("builds the payload for a notification, and notifications still insert without pg_net", async () => {
    await asOwner((q) => q("insert into public.notifications (user_id, type, title, body, link) values ($1, 'test', 'Hello', 'World', '/dashboard')", [a.id]));
    const [n] = await asOwner((q) => q<{ id: string }>("select id from public.notifications where user_id = $1 and type = 'test'", [a.id]));
    const [p] = await asOwner((q) => q<{ p: { title: string; subscriptions: unknown[] } }>("select public.push_payload($1) p", [n.id]));
    expect(p.p.title).toBe("Hello");
    expect(p.p.subscriptions).toHaveLength(1);
  });
});
