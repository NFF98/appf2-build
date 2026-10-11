import { describe, expect, test, vi } from "vitest";

import {
  encodeBase64Url,
  keyThumbprint,
  mutationProofTranscript,
  POP_KEY_HEADER,
  POP_PROTOCOL_TAG,
  POP_SIGNATURE_HEADER,
  POP_TIMESTAMP_HEADER,
  reservedCreateIdempotencyKey,
  verifyMutationProof
} from "../../src/edge/create-proof.js";
import type { IntentApiHttpRequest, IntentApiHttpResponse } from "../../src/edge/intent-api.js";
import { INTENT_CONTINUITY_COOKIE, intentContinuityCookie } from "../../src/edge/server-identity.js";
import type { Appf2WorkerEnv, WorkerRequestComposition } from "../../src/edge/worker-composition.js";
import { createWorkerFetch, type WorkerCompositionFactories } from "../../src/edge/worker-entry.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { ANON, clarifyingAnalysis, createF01Harness, OTHER_ANON, RAW_INTENT_MARKER, readyAnalysis, succeeded } from "./f01-harness.js";

const ORIGIN = "https://app.example";
const SECRET = "0123456789abcdef0123456789abcdef-pg001";
const OTHER_SECRET = "fedcba9876543210fedcba9876543210-pg001";
const CREATE_PATH = "/api/v1/intents";
const DAY_MS = 24 * 60 * 60 * 1000;

const env: Appf2WorkerEnv = {
  HYPERDRIVE_FRESH: { connectionString: "postgres://unused" },
  APPF2_MODEL_BASE_URL: "https://model.invalid/v1",
  APPF2_MODEL_API_KEY: "unused",
  APPF2_MODEL_NAME: "unused",
  APPF2_IDENTITY_COOKIE_SECRET: SECRET
};

interface PopClient {
  readonly privateKey: CryptoKey;
  readonly spki: string;
  readonly thumbprint: string;
  readonly createKey: string;
}

async function popClient(): Promise<PopClient> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const spkiBytes = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const thumbprint = await keyThumbprint(spkiBytes);
  return { privateKey: pair.privateKey, spki: encodeBase64Url(spkiBytes), thumbprint, createKey: reservedCreateIdempotencyKey(thumbprint) };
}

interface Signed {
  readonly path: string;
  readonly body: string;
  readonly key: string;
  readonly timestamp: number;
}

async function signature(client: PopClient, signed: Signed): Promise<string> {
  const transcript = await mutationProofTranscript(
    { method: "POST", path: signed.path, body: new TextEncoder().encode(signed.body), idempotencyKey: signed.key },
    signed.timestamp
  );
  return encodeBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, client.privateKey, transcript)));
}

async function popHeaders(client: PopClient, signed: Signed): Promise<Record<string, string>> {
  return {
    [POP_KEY_HEADER]: client.spki,
    [POP_SIGNATURE_HEADER]: await signature(client, signed),
    [POP_TIMESTAMP_HEADER]: String(signed.timestamp)
  };
}

function post(path: string, body: string, headers: Record<string, string>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", ...headers },
    body
  });
}

function createBody(anonymousId = ANON, raw = RAW_INTENT_MARKER): string {
  return JSON.stringify({ anonymous_id: anonymousId, intent_kind: "CREATE", raw_intent: raw });
}

const compileBody = (version: number): string => JSON.stringify({ intent_version: version });
const scopedPath = (intentId: string, action: "compile" | "answers" = "compile"): string => `/api/v1/intents/${intentId}/${action}`;

function cookiePair(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (setCookie === null) throw new Error("expected a continuity cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

async function errorCode(response: Response): Promise<string> {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? "";
}

const FREE_CREATE_KEYS: WorkerRequestComposition["createKeys"] = { available: async () => true, heldElsewhere: () => false };

/** Real F01 service + idempotency + scoped lookup over the in-memory Postgres fake, behind the production Worker. */
function world(createKeys = FREE_CREATE_KEYS) {
  const f01 = createF01Harness();
  const observed: (string | null | undefined)[] = [];
  const intent = vi.fn(async (request: IntentApiHttpRequest) => {
    observed.push(request.trustedAnonymousId);
    return f01.handler(request);
  });
  const factory = vi.fn<WorkerCompositionFactories["intent"]>(
    (): WorkerRequestComposition => ({
      executor: { close: async () => undefined },
      createKeys,
      intent,
      events: async () => ({ status: 200, headers: {}, body: { data: {} } })
    })
  );
  const fetch = createWorkerFetch({ intent: factory }, { now: () => f01.clock.now().getTime() });
  const now = (): number => f01.clock.now().getTime();
  const send = (request: Request): Promise<Response> => fetch(request, env);

  async function provenCreate(client: PopClient, body = createBody()): Promise<{ response: Response; intentId: string; cookie: string }> {
    f01.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: now() };
    const response = await send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) }));
    expect(response.status).toBe(200);
    const json = (await response.clone().json()) as { data: { intent_id: string } };
    return { response, intentId: json.data.intent_id, cookie: cookiePair(response) };
  }

  async function scoped(client: PopClient, intentId: string, cookie: string | null, key = "compile-1", body = compileBody(1)): Promise<Response> {
    const path = scopedPath(intentId);
    const headers: Record<string, string> = { "Idempotency-Key": key, ...(await popHeaders(client, { path, body, key, timestamp: now() })) };
    if (cookie !== null) headers.Cookie = cookie;
    return send(post(path, body, headers));
  }

  return { f01, observed, intent, factory, send, now, provenCreate, scoped };
}

type World = ReturnType<typeof world>;

async function expectRejectedBeforeDatabase(w: World, response: Response, reason?: string): Promise<void> {
  expect(response.status).toBe(400);
  expect(response.headers.get("set-cookie")).toBeNull();
  const body = (await response.json()) as { error: { code: string; details: { violations: { reason: string }[] } } };
  expect(body.error.code).toBe("F01-ERR-001");
  if (reason !== undefined) expect(body.error.details.violations[0]?.reason).toBe(reason);
  expect(w.factory).not.toHaveBeenCalled();
  expect(w.f01.db.statements).toHaveLength(0);
}

describe("GOV-CASE-PG-001 identity: per-intent PoP continuity", () => {
  test("valid PoP CREATE issues one HttpOnly/Secure/Lax cookie scoped to exactly that intent", async () => {
    const w = world();
    const client = await popClient();
    const { response, intentId } = await w.provenCreate(client);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith(`${INTENT_CONTINUITY_COOKIE}=`)).toBe(true);
    expect(setCookie).toContain(`Path=/api/v1/intents/${intentId}/`);
    expect(setCookie).toContain("Max-Age=86400");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Path=/;");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(w.observed).toEqual([null]);
  });

  test("cookie + fresh same-key signature yields F01 trusted context for that intent only", async () => {
    const w = world();
    const client = await popClient();
    const { intentId, cookie } = await w.provenCreate(client);
    await w.scoped(client, intentId, cookie);
    expect(w.observed).toEqual([null, ANON]);
  });

  test("CREATE without proof is rejected before any F01 write (F01-API-ID-001A item 8)", async () => {
    const w = world();
    w.f01.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue));
    const response = await w.send(post(CREATE_PATH, createBody(), { "Idempotency-Key": "legacy-create-1" }));
    await expectRejectedBeforeDatabase(w, response, "PROOF_INVALID");
    expect(w.observed).toEqual([]);
  });

  test("attacker CREATE with a known victim UUID cannot reach the victim's existing intent", async () => {
    const w = world();
    const victim = await popClient();
    const attacker = await popClient();
    const victimIntent = await w.provenCreate(victim);
    const attackerIntent = await w.provenCreate(attacker, createBody(ANON, "attacker-chosen-text"));
    expect(attackerIntent.intentId).not.toBe(victimIntent.intentId);
    const before = w.f01.db.statements.length;
    const factoryCalls = w.factory.mock.calls.length;
    const response = await w.scoped(attacker, victimIntent.intentId, attackerIntent.cookie);
    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("F01-ERR-001");
    expect(w.f01.db.statements).toHaveLength(before);
    expect(w.factory.mock.calls.length).toBe(factoryCalls);
    expect(w.observed).toEqual([null, null]);
  });

  test("attacker proof over a client-chosen (non-reserved) Idempotency-Key is denied before any DB access", async () => {
    const w = world();
    const attacker = await popClient();
    const body = createBody();
    const signed = { path: CREATE_PATH, body, key: "victim-legacy-key", timestamp: w.now() };
    const hijack = await w.send(post(CREATE_PATH, body, { "Idempotency-Key": "victim-legacy-key", ...(await popHeaders(attacker, signed)) }));
    await expectRejectedBeforeDatabase(w, hijack, "PROOF_INVALID");
    expect(w.observed).toEqual([]);
  });

  test("copied victim cookie alone (no signature, or attacker signature) is denied", async () => {
    const w = world();
    const victim = await popClient();
    const attacker = await popClient();
    const { intentId, cookie } = await w.provenCreate(victim);
    const path = scopedPath(intentId);
    const unsigned = await w.send(post(path, compileBody(1), { "Idempotency-Key": "compile-1", Cookie: cookie }));
    expect(unsigned.status).toBe(400);
    const wrongKey = await w.scoped(attacker, intentId, cookie);
    expect(wrongKey.status).toBe(400);
    expect(w.observed).toEqual([null]);
  });
});

describe("GOV-CASE-PG-001 identity: forged, replayed and edited proofs", () => {
  test("replayed signed CREATE (residual) cannot be reused as proof for a scoped mutation", async () => {
    const w = world();
    const victim = await popClient();
    w.f01.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const body = createBody();
    const signed = { path: CREATE_PATH, body, key: victim.createKey, timestamp: w.now() };
    const captured = { "Idempotency-Key": victim.createKey, ...(await popHeaders(victim, signed)) };
    const original = await w.send(post(CREATE_PATH, body, captured));
    const intentId = ((await original.json()) as { data: { intent_id: string } }).data.intent_id;
    const replay = await w.send(post(CREATE_PATH, body, captured));
    expect(replay.status).toBe(200);
    const replayCookie = cookiePair(replay);
    const misuse = await w.send(
      post(scopedPath(intentId), compileBody(1), { ...captured, "Idempotency-Key": victim.createKey, Cookie: replayCookie })
    );
    expect(misuse.status).toBe(400);
    expect(w.observed).toEqual([null, null]);
  });

  test("reserved CREATE key without proof, forged signature, malformed or foreign-curve key are denied before any DB access", async () => {
    const w = world();
    const client = await popClient();
    const body = createBody();
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const good = await popHeaders(client, signed);
    const p384 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, ["sign", "verify"]);
    const p384Spki = encodeBase64Url(new Uint8Array(await crypto.subtle.exportKey("spki", p384.publicKey)));
    const variants: Record<string, string>[] = [
      { "Idempotency-Key": client.createKey },
      { "Idempotency-Key": "legacy-key", [POP_TIMESTAMP_HEADER]: String(w.now()) },
      { "Idempotency-Key": client.createKey, ...good, [POP_SIGNATURE_HEADER]: encodeBase64Url(new Uint8Array(64)) },
      { "Idempotency-Key": client.createKey, ...good, [POP_SIGNATURE_HEADER]: `${good[POP_SIGNATURE_HEADER]}=` },
      { "Idempotency-Key": client.createKey, ...good, [POP_SIGNATURE_HEADER]: `${good[POP_SIGNATURE_HEADER]}, ${good[POP_SIGNATURE_HEADER]}` },
      { "Idempotency-Key": client.createKey, ...good, [POP_KEY_HEADER]: client.spki.slice(0, -4) },
      { "Idempotency-Key": client.createKey, ...good, [POP_KEY_HEADER]: p384Spki },
      { "Idempotency-Key": client.createKey, ...good, [POP_KEY_HEADER]: "A".repeat(4096) },
      { "Idempotency-Key": client.createKey, ...good, [POP_TIMESTAMP_HEADER]: "01" },
      { "Idempotency-Key": "client-chosen-key", ...good }
    ];
    for (const headers of variants) {
      await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, headers)), "PROOF_INVALID");
    }
    expect(w.observed).toEqual([]);
  });

  test("editing body, path, key, timestamp or intent binding after signing is denied", async () => {
    const w = world();
    const client = await popClient();
    const other = await popClient();
    const body = createBody();
    const at = w.now();
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: at };
    const headers = { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) };
    await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, `${body} `, headers)));
    await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, { ...headers, "Idempotency-Key": other.createKey })));
    await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, { ...headers, [POP_TIMESTAMP_HEADER]: String(at + 1) })));
    const stale = { ...signed, timestamp: at - 91_000 };
    await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, stale)) })));
    const future = { ...signed, timestamp: at + 91_000 };
    await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, future)) })));

    const first = await w.provenCreate(client);
    const second = await w.provenCreate(other, createBody(ANON, "second"));
    const statements = w.f01.db.statements.length;
    const pathA = scopedPath(first.intentId);
    const signedForA = await popHeaders(client, { path: pathA, body: compileBody(1), key: "compile-a", timestamp: w.now() });
    const movedToB = await w.send(post(scopedPath(second.intentId), compileBody(1), { "Idempotency-Key": "compile-a", Cookie: first.cookie, ...signedForA }));
    expect(movedToB.status).toBe(400);
    const answersPath = await w.send(post(scopedPath(first.intentId, "answers"), compileBody(1), { "Idempotency-Key": "compile-a", Cookie: first.cookie, ...signedForA }));
    expect(answersPath.status).toBe(400);
    const editedBody = await w.send(post(pathA, compileBody(2), { "Idempotency-Key": "compile-a", Cookie: first.cookie, ...signedForA }));
    expect(editedBody.status).toBe(400);
    const editedKey = await w.send(post(pathA, compileBody(1), { "Idempotency-Key": "compile-b", Cookie: first.cookie, ...signedForA }));
    expect(editedKey.status).toBe(400);
    expect(w.f01.db.statements).toHaveLength(statements);
  });
});

describe("GOV-CASE-PG-001 identity: cookie integrity and F01 semantics", () => {
  test("expired, duplicated, tampered, foreign-secret and legacy universal cookies are denied", async () => {
    const w = world();
    const client = await popClient();
    const { intentId, cookie } = await w.provenCreate(client);
    const statements = w.f01.db.statements.length;
    const [name, token = ""] = cookie.split("=");
    const foreign = (await intentContinuityCookie({ intentId, anonymousId: ANON, keyThumbprint: client.thumbprint }, OTHER_SECRET, w.now())).split(";", 1)[0] ?? "";
    const candidates = [
      `${cookie}; ${cookie}`,
      `${name}=${token.slice(0, -2)}AA`,
      `${name}=${token}.extra`,
      foreign,
      `appf2.trusted_anonymous.v1=v1.${ANON}.invalid`
    ];
    for (const candidate of candidates) {
      expect((await w.scoped(client, intentId, candidate)).status).toBe(400);
    }
    w.f01.clock.advance(DAY_MS + 1000);
    expect((await w.scoped(client, intentId, cookie)).status).toBe(400);
    expect(w.f01.db.statements).toHaveLength(statements);
    expect(w.observed).toEqual([null]);
  });

  test("cookie for one intent is denied on another intent of the same anonymous correlation", async () => {
    const w = world();
    const client = await popClient();
    const sibling = await popClient();
    const first = await w.provenCreate(client);
    const second = await w.provenCreate(sibling, createBody(ANON, "second-intent"));
    const crossed = await w.scoped(client, second.intentId, first.cookie);
    expect(crossed.status).toBe(400);
    const crossedWithSiblingKey = await w.scoped(sibling, second.intentId, first.cookie);
    expect(crossedWithSiblingKey.status).toBe(400);
    expect(w.observed).toEqual([null, null]);
  });

  test("server-side F01 (intent_id, anonymous_id) scope check is retained behind a valid cookie", async () => {
    const w = world();
    const client = await popClient();
    const { intentId } = await w.provenCreate(client);
    const mismatched = (await intentContinuityCookie({ intentId, anonymousId: OTHER_ANON, keyThumbprint: client.thumbprint }, SECRET, w.now())).split(";", 1)[0] ?? "";
    const response = await w.scoped(client, intentId, mismatched);
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("F01-ERR-015");
  });

  test("24h same-key same-body PoP retry returns the same intent without a duplicate side effect", async () => {
    const w = world();
    const client = await popClient();
    const first = await w.provenCreate(client);
    w.f01.clock.advance(DAY_MS - 60_000);
    const body = createBody();
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const retry = await w.send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) }));
    expect(retry.status).toBe(200);
    expect(((await retry.clone().json()) as { data: { intent_id: string } }).data.intent_id).toBe(first.intentId);
    expect(retry.headers.get("set-cookie")).toContain(`Path=/api/v1/intents/${first.intentId}/`);
    expect(w.f01.db.intents.size).toBe(1);
    expect(w.f01.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
  });

  test("same reserved key with a different body is 409 and issues no cookie", async () => {
    const w = world();
    const client = await popClient();
    await w.provenCreate(client);
    const body = createBody(ANON, "different body");
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const conflict = await w.send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) }));
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("API-IDEMPOTENCY-CONFLICT");
    expect(conflict.headers.get("set-cookie")).toBeNull();
  });
});

describe("GOV-CASE-PG-001 identity: transport hardening and fail-closed configuration", () => {
  test("cross-site CREATE and scoped writes are denied before DB; scoped writes require Origin", async () => {
    const w = world();
    const client = await popClient();
    const body = createBody();
    const crossSite: Record<string, string>[] = [
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
      { "Sec-Fetch-Site": "same-site" }
    ];
    for (const headers of crossSite) {
      await expectRejectedBeforeDatabase(w, await w.send(post(CREATE_PATH, body, { "Idempotency-Key": "legacy-1", ...headers })), "CROSS_SITE_WRITE");
    }
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const noOrigin = new Request(`${ORIGIN}${CREATE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) },
      body
    });
    await expectRejectedBeforeDatabase(w, await w.send(noOrigin), "CROSS_SITE_WRITE");

    const { intentId, cookie } = await w.provenCreate(client);
    const path = scopedPath(intentId);
    const scopedHeaders = { "Idempotency-Key": "compile-1", Cookie: cookie, ...(await popHeaders(client, { path, body: compileBody(1), key: "compile-1", timestamp: w.now() })) };
    const scopedNoOrigin = new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...scopedHeaders }, body: compileBody(1) });
    expect((await w.send(scopedNoOrigin)).status).toBe(400);
    expect((await w.send(post(path, compileBody(1), { ...scopedHeaders, Origin: "https://evil.example" }))).status).toBe(400);
    expect(w.observed).toEqual([null]);
  });

  test("no secret, stack, signature or key material is reflected to the browser", async () => {
    const w = world();
    const client = await popClient();
    const body = createBody();
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const headers: Record<string, string> = { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)), [POP_TIMESTAMP_HEADER]: "1" };
    const rejected = await (await w.send(post(CREATE_PATH, body, headers))).text();
    for (const leaked of [SECRET, client.spki, headers[POP_SIGNATURE_HEADER] ?? "", "Error", "    at "]) {
      expect(rejected).not.toContain(leaked);
    }
    const failing = createWorkerFetch(
      { intent: () => { throw new Error(`postgres://appf2:${SECRET}@db.internal/appf2\n    at compose`); } },
      { now: w.now }
    );
    const fresh = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const unavailable = await failing(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, fresh)) }), env);
    expect(unavailable.status).toBe(503);
    const text = await unavailable.text();
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("postgres://");
    const { response } = await w.provenCreate(client);
    expect(response.headers.get("set-cookie")).not.toContain(SECRET);
  });

  test("misconfigured short cookie secret fails closed with 503 before any F01 side effect", async () => {
    const w = world();
    const fetch = createWorkerFetch({ intent: w.factory }, { now: w.now });
    const response = await fetch(post(CREATE_PATH, createBody(), { "Idempotency-Key": "legacy-3" }), { ...env, APPF2_IDENTITY_COOKIE_SECRET: "short" });
    expect(response.status).toBe(503);
    expect(w.factory).not.toHaveBeenCalled();
  });
});

describe("GOV-CASE-PG-001 RLS request context and CREATE key single holder", () => {
  test("only guard-verified identity reaches the DB context: CREATE body anonymous_id, or scoped cookie + intent", async () => {
    const w = world();
    const client = await popClient();
    const { intentId, cookie } = await w.provenCreate(client);
    await w.scoped(client, intentId, cookie);
    expect(w.factory.mock.calls.map(([, context]) => context)).toEqual([
      { anonymousId: ANON, intentId: null },
      { anonymousId: ANON, intentId }
    ]);
  });

  test("proven CREATE key already held by another anonymous_id is 400 F01-ERR-001 before any F01 write", async () => {
    const available = vi.fn(async () => false);
    const w = world({ available, heldElsewhere: () => false });
    const client = await popClient();
    const body = createBody(OTHER_ANON);
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp: w.now() };
    const response = await w.send(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) }));
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    const json = (await response.json()) as { error: { code: string; details: { violations: { reason: string }[] } } };
    expect(json.error.code).toBe("F01-ERR-001");
    expect(json.error.details.violations[0]?.reason).toBe("PROOF_INVALID");
    expect(available).toHaveBeenCalledWith(client.createKey, OTHER_ANON);
    expect(w.intent).not.toHaveBeenCalled();
    expect(w.f01.db.statements).toHaveLength(0);
  });

  async function provenCreateAgainst(result: IntentApiHttpResponse, heldElsewhere: boolean): Promise<Response> {
    const client = await popClient();
    const body = createBody();
    const timestamp = Date.now();
    const fetch = createWorkerFetch({
      intent: () => ({
        executor: { close: async () => undefined },
        createKeys: { available: async () => true, heldElsewhere: () => heldElsewhere },
        intent: async () => result,
        events: async () => ({ status: 200, headers: {}, body: { data: {} } })
      })
    }, { now: () => timestamp });
    const signed = { path: CREATE_PATH, body, key: client.createKey, timestamp };
    return fetch(post(CREATE_PATH, body, { "Idempotency-Key": client.createKey, ...(await popHeaders(client, signed)) }), env);
  }

  const internal: IntentApiHttpResponse = { status: 500, headers: {}, body: { error: { code: "F01-ERR-014" } } };

  test("race loser on the single-holder CREATE key index maps to 400 F01-ERR-001 with no cookie", async () => {
    const response = await provenCreateAgainst(internal, true);
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    const json = (await response.json()) as { error: { code: string; details: { violations: { reason: string }[] } } };
    expect(json.error.code).toBe("F01-ERR-001");
    expect(json.error.details.violations[0]?.reason).toBe("PROOF_INVALID");
  });

  test("any other database failure is never disguised as a user error", async () => {
    const response = await provenCreateAgainst(internal, false);
    expect(response.status).toBe(500);
    expect(await errorCode(response)).toBe("F01-ERR-014");
  });
});

describe("GOV-CASE-PG-001 PoP wire protocol v1 is frozen", () => {
  test("verifier accepts a signature over the documented transcript bytes built independently", async () => {
    const client = await popClient();
    const body = new TextEncoder().encode(createBody());
    const timestamp = 1_790_000_000_000;
    const digest = encodeBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
    const manual = new TextEncoder().encode(JSON.stringify([POP_PROTOCOL_TAG, "POST", CREATE_PATH, digest, client.createKey, timestamp]));
    const sig = encodeBase64Url(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, client.privateKey, manual)));
    const headers = new Headers({ [POP_KEY_HEADER]: client.spki, [POP_SIGNATURE_HEADER]: sig, [POP_TIMESTAMP_HEADER]: String(timestamp) });
    const proof = await verifyMutationProof({ method: "POST", path: CREATE_PATH, body, idempotencyKey: client.createKey, headers }, timestamp);
    expect(proof).toEqual({ keyThumbprint: client.thumbprint });
    expect(POP_PROTOCOL_TAG).toBe("APPF2_MUTATION_PoP_V1");
    expect(client.createKey).toMatch(/^appf2-create-v1\.[A-Za-z0-9_-]{43}$/u);
    expect(client.spki).toHaveLength(122);
    expect(sig).toHaveLength(86);
  });
});
