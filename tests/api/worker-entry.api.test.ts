import { describe, expect, test, vi } from "vitest";

import type { IntentApiHttpRequest, IntentApiHttpResponse } from "../../src/edge/intent-api.js";
import { readTrustedAnonymousId } from "../../src/edge/server-identity.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import type { Appf2WorkerEnv, WorkerRequestComposition } from "../../src/edge/worker-composition.js";

const ANON = "00000000-0000-4000-8000-000000000001";
const SECRET = "0123456789abcdef0123456789abcdef";

const env: Appf2WorkerEnv = {
  HYPERDRIVE_FRESH: { connectionString: "postgres://unused" },
  APPF2_MODEL_BASE_URL: "https://model.invalid/v1",
  APPF2_MODEL_API_KEY: "unused",
  APPF2_MODEL_NAME: "unused",
  APPF2_IDENTITY_COOKIE_SECRET: SECRET
};

function composition(
  intent: (request: IntentApiHttpRequest) => Promise<IntentApiHttpResponse | undefined>
): { readonly value: WorkerRequestComposition; readonly close: ReturnType<typeof vi.fn> } {
  const close = vi.fn(async () => undefined);
  return {
    close,
    value: {
      executor: { close } as unknown as WorkerRequestComposition["executor"],
      intent,
      events: async () => ({ status: 200, headers: { "X-Request-Id": crypto.randomUUID() }, body: { data: {} } })
    }
  };
}

describe("Cloudflare Worker API boundary", () => {
  test("health is JSON and never needs DB composition", async () => {
    const factory = vi.fn();
    const response = await createWorkerFetch(factory)(new Request("https://app.example/api/v1/health"), env);
    expect(factory).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ data: { status: "UP" } });
  });

  test("production composition failure is converted to JSON 503 instead of a platform exception", async () => {
    const response = await createWorkerFetch(() => { throw new Error("missing binding"); })(
      new Request("https://app.example/api/v1/intents", { method: "POST" }),
      env
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("missing binding");
  });

  test("unknown API route is JSON 404, never a Pages HTML fallback", async () => {
    const wired = composition(async () => undefined);
    const response = await createWorkerFetch(() => wired.value)(new Request("https://app.example/api/v1/missing", { method: "POST" }), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("<html");
    expect(wired.close).toHaveBeenCalledOnce();
  });

  test("successful create sets a signed HttpOnly continuity cookie", async () => {
    const wired = composition(async () => ({ status: 200, headers: { "X-Request-Id": crypto.randomUUID() }, body: { data: { ok: true } } }));
    const response = await createWorkerFetch(() => wired.value)(new Request("https://app.example/api/v1/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "create-1" },
      body: JSON.stringify({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: "test" })
    }), env);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const cookiePair = setCookie?.split(";", 1)[0] ?? "";
    const trusted = await readTrustedAnonymousId(new Request("https://app.example", { headers: { Cookie: cookiePair } }), SECRET);
    expect(trusted).toBe(ANON);
  });

  test("tampered continuity cookie is not promoted to trusted identity", async () => {
    let observed: string | null | undefined;
    const wired = composition(async (request) => {
      observed = request.trustedAnonymousId;
      return { status: 400, headers: { "X-Request-Id": crypto.randomUUID() }, body: { error: { code: "F01-ERR-001" } } };
    });
    await createWorkerFetch(() => wired.value)(new Request("https://app.example/api/v1/intents/00000000-0000-4000-8000-000000000099/compile", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "compile-1", Cookie: "appf2.trusted_anonymous.v1=v1.00000000-0000-4000-8000-000000000001.invalid" },
      body: JSON.stringify({ intent_version: 1 })
    }), env);
    expect(observed).toBeNull();
  });

  test("events batch rejects non-JSON media before ingestion", async () => {
    const wired = composition(async () => undefined);
    const events = vi.fn(wired.value.events);
    const value = { ...wired.value, events };
    const response = await createWorkerFetch(() => value)(new Request("https://app.example/api/v1/events/batch", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}"
    }), env);
    expect(response.status).toBe(415);
    expect(events).not.toHaveBeenCalled();
    expect(wired.close).toHaveBeenCalledOnce();
  });

  test("events batch rejects non-POST without touching ingestion", async () => {
    const wired = composition(async () => undefined);
    const events = vi.fn(wired.value.events);
    const value = { ...wired.value, events };
    const response = await createWorkerFetch(() => value)(new Request("https://app.example/api/v1/events/batch", { method: "GET" }), env);
    expect(response.status).toBe(405);
    expect(events).not.toHaveBeenCalled();
    expect(wired.close).toHaveBeenCalledOnce();
  });
});
