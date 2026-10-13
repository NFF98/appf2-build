import { describe, expect, test, vi } from "vitest";

import type { IntentApiHttpRequest, IntentApiHttpResponse } from "../../src/edge/intent-api.js";
import type { Appf2WorkerEnv, WorkerRequestComposition } from "../../src/edge/worker-composition.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";

const ANON = "00000000-0000-4000-8000-000000000001";
const HASH = `sha256:${"ab".repeat(32)}`;

const env: Appf2WorkerEnv = {
  HYPERDRIVE_FRESH: { connectionString: "postgres://unused" },
  HYPERDRIVE_F02_ADMISSION: { connectionString: "postgres://unused" },
  HYPERDRIVE_F07_EVENTS: { connectionString: "postgres://unused" },
  APPF2_MODEL_BASE_URL: "https://model.invalid/v1",
  APPF2_MODEL_API_KEY: "unused",
  APPF2_MODEL_NAME: "unused",
  APPF2_IDENTITY_COOKIE_SECRET: "0123456789abcdef0123456789abcdef"
};

function intentComposition(intent: (request: IntentApiHttpRequest) => Promise<IntentApiHttpResponse | undefined>) {
  const close = vi.fn(async () => undefined);
  const events = vi.fn(async () => ({ status: 200, headers: { "X-Request-Id": crypto.randomUUID() }, body: { data: {} } }));
  const factory = vi.fn(
    (): WorkerRequestComposition => ({
      executor: { close },
      createKeys: { available: async () => true, heldElsewhere: () => false },
      intent,
      events
    })
  );
  return { close, events, factory };
}

describe("Cloudflare Worker API boundary", () => {
  test("health is JSON and never needs DB composition", async () => {
    const wired = intentComposition(async () => undefined);
    const response = await createWorkerFetch({ intent: wired.factory })(new Request("https://app.example/api/v1/health"), env);
    expect(wired.factory).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ data: { status: "UP" } });
  });

  test("production composition failure is converted to JSON 503 instead of a platform exception", async () => {
    const response = await createWorkerFetch({ intent: () => { throw new Error("missing binding"); } })(
      new Request("https://app.example/api/v1/events/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      env
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("missing binding");
  });

  test("unknown API route is JSON 404, never a Pages HTML fallback", async () => {
    const wired = intentComposition(async () => undefined);
    const response = await createWorkerFetch({ intent: wired.factory })(new Request("https://app.example/api/v1/missing", { method: "POST" }), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.text()).not.toContain("<html");
    expect(wired.close).toHaveBeenCalledOnce();
  });

  test("paths outside /api/v1/ are JSON 404 without composition", async () => {
    const wired = intentComposition(async () => undefined);
    const fetch = createWorkerFetch({ intent: wired.factory });
    for (const path of ["/", "/index.html", "/api/v2/intents", "/b/" + HASH, "/B/" + HASH]) {
      const response = await fetch(new Request(`https://app.example${path}`), env);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type"), path).toContain("application/json");
    }
    expect(wired.factory).not.toHaveBeenCalled();
  });

  test("unsigned CREATE is rejected before composition and never sets a cookie", async () => {
    const wired = intentComposition(async () => ({ status: 200, headers: {}, body: { data: {} } }));
    const response = await createWorkerFetch({ intent: wired.factory })(new Request("https://app.example/api/v1/intents", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "create-1", Origin: "https://app.example" },
      body: JSON.stringify({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: "test" })
    }), env);
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as { error: { code: string; details: { violations: { reason: string }[] } } };
    expect(body.error.code).toBe("F01-ERR-001");
    expect(body.error.details.violations[0]?.reason).toBe("PROOF_INVALID");
    expect(wired.factory).not.toHaveBeenCalled();
  });

  test("events batch rejects non-JSON media and non-POST without composing ingestion", async () => {
    const wired = intentComposition(async () => undefined);
    const fetch = createWorkerFetch({ intent: wired.factory });
    const media = await fetch(new Request("https://app.example/api/v1/events/batch", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" }), env);
    expect(media.status).toBe(415);
    const method = await fetch(new Request("https://app.example/api/v1/events/batch", { method: "GET" }), env);
    expect(method.status).toBe(405);
    expect(wired.factory).not.toHaveBeenCalled();
    expect(wired.events).not.toHaveBeenCalled();
  });

  test("events batch JSON POST reaches ingestion without any request identity and closes the executor", async () => {
    const wired = intentComposition(async () => undefined);
    const response = await createWorkerFetch({ intent: wired.factory })(
      new Request("https://app.example/api/v1/events/batch", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
      env
    );
    expect(response.status).toBe(200);
    expect(wired.factory).toHaveBeenCalledWith(env, { anonymousId: null, intentId: null });
    expect(wired.events).toHaveBeenCalledOnce();
    expect(wired.close).toHaveBeenCalledOnce();
  });
});
