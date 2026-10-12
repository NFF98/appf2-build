import { describe, expect, test, vi } from "vitest";

import { INTENT_CONTINUITY_COOKIE } from "../../src/edge/server-identity.js";
import type { Appf2WorkerEnv, WorkerRequestComposition } from "../../src/edge/worker-composition.js";
import { createWorkerFetch, type WorkerCompositionFactories } from "../../src/edge/worker-entry.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { ANON, clarifyingAnalysis, createF01Harness, succeeded } from "./f01-harness.js";

/**
 * Independent client per BS-P1-025 F01-API-ID-001A / API-CONVENTIONS: every wire value is built here from the
 * written formulas, never from the production create-proof helpers.
 */
const ORIGIN = "https://app.example";
const CREATE_PATH = "/api/v1/intents";
const env: Appf2WorkerEnv = {
  HYPERDRIVE_FRESH: { connectionString: "postgres://unused" },
  APPF2_MODEL_BASE_URL: "https://model.invalid/v1",
  APPF2_MODEL_API_KEY: "unused",
  APPF2_MODEL_NAME: "unused",
  APPF2_IDENTITY_COOKIE_SECRET: "0123456789abcdef0123456789abcdef-interop"
};

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

interface IndependentClient {
  readonly privateKey: CryptoKey;
  readonly spkiDer: Uint8Array<ArrayBuffer>;
}

async function independentClient(): Promise<IndependentClient> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { privateKey: pair.privateKey, spkiDer: new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)) };
}

/** BS-P1-025: `keyThumbprint = base64url(SHA256(public SPKI DER bytes))`. */
const specThumbprint = async (client: IndependentClient): Promise<string> => b64url(await sha256(client.spkiDer));

/** Pre-fix PR #365 derivation: SHA-256 over `APPF2_CREATE_KEY_V1\0 || SPKI`. Must not be accepted. */
async function legacyTaggedThumbprint(client: IndependentClient): Promise<string> {
  const tag = new TextEncoder().encode("APPF2_CREATE_KEY_V1\u0000");
  const material = new Uint8Array(tag.byteLength + client.spkiDer.byteLength);
  material.set(tag, 0);
  material.set(client.spkiDer, tag.byteLength);
  return b64url(await sha256(material));
}

async function signedCreate(client: IndependentClient, idempotencyKey: string, body: string, timestamp: number): Promise<Request> {
  const bodyBytes = new TextEncoder().encode(body);
  const transcript = new TextEncoder().encode(
    JSON.stringify(["APPF2_MUTATION_PoP_V1", "POST", CREATE_PATH, b64url(await sha256(bodyBytes)), idempotencyKey, timestamp])
  );
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, client.privateKey, transcript));
  return new Request(`${ORIGIN}${CREATE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Idempotency-Key": idempotencyKey,
      "X-Appf2-PoP-Key": b64url(client.spkiDer),
      "X-Appf2-PoP-Signature": b64url(signature),
      "X-Appf2-PoP-Timestamp": String(timestamp)
    },
    body
  });
}

function worker() {
  const f01 = createF01Harness();
  const factory = vi.fn<WorkerCompositionFactories["intent"]>(
    (): WorkerRequestComposition => ({
      executor: { close: async () => undefined },
      createKeys: { available: async () => true, heldElsewhere: () => false },
      intent: (request) => f01.handler(request),
      events: async () => ({ status: 200, headers: {}, body: { data: {} } })
    })
  );
  const fetch = createWorkerFetch({ intent: factory }, { now: () => f01.clock.now().getTime() });
  return { f01, factory, send: (request: Request) => fetch(request, env), now: () => f01.clock.now().getTime() };
}

const createBody = JSON.stringify({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: "Split a dinner bill between friends" });

describe("GOV-CASE-PG-001 PoP key thumbprint interoperability (BS-P1-025)", () => {
  test("spec-derived thumbprint key: CREATE 200 with scoped cookie, same-request retry returns the same intent", async () => {
    const w = worker();
    const client = await independentClient();
    const idempotencyKey = `appf2-create-v1.${await specThumbprint(client)}`;
    w.f01.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));

    const first = await w.send(await signedCreate(client, idempotencyKey, createBody, w.now()));
    expect(first.status).toBe(200);
    const intentId = ((await first.clone().json()) as { data: { intent_id: string } }).data.intent_id;
    const cookie = first.headers.get("set-cookie") ?? "";
    expect(cookie.startsWith(`${INTENT_CONTINUITY_COOKIE}=`)).toBe(true);
    expect(cookie).toContain(`Path=/api/v1/intents/${intentId}/`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");

    w.f01.clock.advance(5_000);
    const retry = await w.send(await signedCreate(client, idempotencyKey, createBody, w.now()));
    expect(retry.status).toBe(200);
    expect(((await retry.clone().json()) as { data: { intent_id: string } }).data.intent_id).toBe(intentId);
    expect(retry.headers.get("set-cookie")).toContain(`Path=/api/v1/intents/${intentId}/`);
    expect(w.f01.db.intents.size).toBe(1);
    expect(w.f01.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
  });

  test("legacy APPF2_CREATE_KEY_V1-tagged thumbprint key is 400 F01-ERR-001 before any composition or DB access", async () => {
    const w = worker();
    const client = await independentClient();
    const tagged = await legacyTaggedThumbprint(client);
    expect(tagged).not.toBe(await specThumbprint(client));

    const response = await w.send(await signedCreate(client, `appf2-create-v1.${tagged}`, createBody, w.now()));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    const body = (await response.json()) as { error: { code: string; details: { violations: { reason: string }[] } } };
    expect(body.error.code).toBe("F01-ERR-001");
    expect(body.error.details.violations[0]?.reason).toBe("PROOF_INVALID");
    expect(w.factory).not.toHaveBeenCalled();
    expect(w.f01.db.statements).toHaveLength(0);
  });
});
