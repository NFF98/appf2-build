import { describe, expect, test } from "vitest";

import { INTENT_API_MAX_BODY_BYTES } from "../../src/edge/intent-api.js";
import { POSTGRES_TRANSITION_INTENT_SQL } from "../../src/platform/compiler/postgres-compiler-repository.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import {
  ANON,
  OTHER_ANON,
  RAW_INTENT_MARKER,
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  errorOf,
  failedWith,
  readyAnalysis,
  succeeded,
  type F01Harness
} from "./f01-harness.js";

const CREATE_ROUTE = "POST /api/v1/intents";
const COMPILE_ROUTE = "POST /api/v1/intents/{intent_id}/compile";
const READY = (): JsonValue => readyAnalysis() as unknown as JsonValue;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function compiledIntent(h: F01Harness, key = "compile-1"): Promise<{ intentId: string; version: number; data: Record<string, unknown> }> {
  const { intentId, version } = await h.readyIntent();
  h.gateway.queueCompose(succeeded(blueprintCandidate()));
  const response = await h.compile(intentId, version, key);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { intentId, version, data: dataOf(response) };
}

describe("F01-AC-013 POST /intents retries never duplicate an intent", () => {
  test("TEST-F01-API-001 same key + body replays the one intent; a different body is an idempotency conflict", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(READY()));
    const first = dataOf(await h.create("create-same"));
    const replay = dataOf(await h.create("create-same"));
    expect(replay).toEqual(first);
    expect(h.db.intents.size).toBe(1);
    expect(h.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
    const conflict = await h.create("create-same", h.createBody("另一個需求"));
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict)).toMatchObject({ code: "API-IDEMPOTENCY-CONFLICT", retryable: false });
    expect(h.db.intents.size).toBe(1);
  });

  test("TEST-F01-API-001 FAILED_RETRYABLE re-acquires a new attempt bound to the same intent_id", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect((await h.create()).status).toBe(502);
    const operation = h.db.operationFor(CREATE_ROUTE, "create-1")!;
    const [intent] = [...h.db.intents.values()];
    expect(operation).toMatchObject({ status: "FAILED_RETRYABLE", attempt_no: 1, result_ref_type: "INTENT", result_ref_id: intent?.intent_id, error_code: "F01-ERR-006" });
    expect(intent?.lifecycle_status).toBe("ANALYSIS_FAILED");

    h.gateway.queueAnalysis(succeeded(READY()));
    const retried = dataOf(await h.create());
    expect(retried).toMatchObject({ intent_id: intent?.intent_id, status: "READY" });
    expect(h.db.intents.size).toBe(1);
    expect(h.db.operationFor(CREATE_ROUTE, "create-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2, result_ref_id: intent?.intent_id });
  });

  test("TEST-F01-API-001 a live IN_PROGRESS lease is 409; an expired lease has exactly one takeover winner and the late attempt cannot write", async () => {
    const h = createF01Harness();
    const concurrent: Awaited<ReturnType<F01Harness["create"]>>[] = [];
    h.gateway.queueAnalysis(async () => {
      concurrent.push(await h.create());
      h.clock.advance(21_000);
      concurrent.push(...(await Promise.all([h.create(), h.create()])));
      return succeeded(READY());
    }, succeeded(READY()));
    const late = await h.create();

    expect(concurrent[0]?.status).toBe(409);
    expect(errorOf(concurrent[0]!)).toMatchObject({ code: "API-IDEMPOTENCY-IN-PROGRESS", retryable: true });
    const takeovers = concurrent.slice(1);
    expect(takeovers.map((response) => response.status).sort()).toEqual([200, 409]);
    const winner = dataOf(takeovers.find((response) => response.status === 200)!);
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe("API-IDEMPOTENCY-IN-PROGRESS");
    expect(h.db.intents.size).toBe(1);
    // RECEIVED v1 → ANALYZING v2 (attempt 1) → ANALYZING v3 (takeover) → READY v4; attempt 1 never writes again.
    expect(h.db.intents.get(String(winner.intent_id))).toMatchObject({ lifecycle_status: "READY", intent_version: 4 });
    expect(h.db.operationFor(CREATE_ROUTE, "create-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2, result_ref_id: winner.intent_id });
    expect(dataOf(await h.create())).toEqual(winner);
  });
});

describe("F01-AC-014 POST /compile retries never duplicate a logical compile", () => {
  test("TEST-F01-AC-014 SUCCEEDED replays the same validated content_hash from durable truth without new work", async () => {
    const h = createF01Harness();
    const { intentId, version, data } = await compiledIntent(h);
    const runsBefore = h.db.blueprint.runs.size;
    h.clock.advance(60_000);
    const replay = await h.compile(intentId, version);
    expect(dataOf(replay)).toEqual(data);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);
    expect(h.db.blueprint.runs.size).toBe(runsBefore);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 1, result_ref_type: "VALIDATION_RUN" });
    const conflict = await h.post(`/api/v1/intents/${intentId}/compile`, { intent_version: version, client_context: { retry: true } }, { key: "compile-1" });
    expect(errorOf(conflict).code).toBe("API-IDEMPOTENCY-CONFLICT");
  });

  test("TEST-F01-AC-014 FAILED_RETRYABLE compile retries with the same key and pinned body only increase attempt_no", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect(errorOf(await h.compile(intentId, version)).code).toBe("F01-ERR-006");
    expect(h.db.intents.get(intentId)).toMatchObject({ lifecycle_status: "COMPOSITION_FAILED" });
    expect(h.db.intents.get(intentId)!.intent_version).toBeGreaterThan(version);
    h.clock.advance(1_000);
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const retried = await h.compile(intentId, version);
    expect(dataOf(retried)).toMatchObject({ status: "VALIDATED" });
    expect([...h.db.operations.values()].filter((row) => row.route_key === COMPILE_ROUTE)).toHaveLength(1);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2 });
    expect([...h.db.blueprint.runs.values()].filter((run) => run.status === "PASSED")).toHaveLength(1);
  });

  test("TEST-F01-AC-014 an expired compile lease is taken over once and the superseded attempt cannot commit", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    let takeover: Awaited<ReturnType<F01Harness["compile"]>> | undefined;
    h.gateway.queueCompose(async () => {
      h.clock.advance(31_000);
      takeover = await h.compile(intentId, version);
      return succeeded(blueprintCandidate());
    }, succeeded(blueprintCandidate()));
    const late = await h.compile(intentId, version);
    expect(dataOf(takeover!)).toMatchObject({ status: "VALIDATED" });
    expect(late.status).toBe(409);
    expect(errorOf(late).code).toBe("API-IDEMPOTENCY-IN-PROGRESS");
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2 });
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("VALIDATED");
    expect([...h.db.blueprint.runs.values()].filter((run) => run.status === "PASSED")).toHaveLength(1);
    expect(dataOf(await h.compile(intentId, version))).toEqual(dataOf(takeover!));
  });
});

describe("F01-AC-015 stale intent_version is a 409", () => {
  test("TEST-F01-API-002 answers and compile with a stale or future intent_version return 409 F01-ERR-004 without mutation", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    const intentId = String(created.intent_id);
    const questionId = String((created.questions as { question_id: string }[])[0]?.question_id);
    const before = structuredClone(h.db.intents.get(intentId));
    const stale = await h.answers(intentId, { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: Number(created.intent_version) - 1 });
    expect(stale.status).toBe(409);
    expect(errorOf(stale)).toMatchObject({ code: "F01-ERR-004", retryable: true });
    expect(h.db.intents.get(intentId)).toEqual(before);
    for (const offset of [-1, 1]) {
      const compile = await h.compile(intentId, Number(created.intent_version) + offset, `compile-${offset}`);
      expect([compile.status, errorOf(compile).code]).toEqual([409, "F01-ERR-004"]);
    }
    const accepted = dataOf(await h.answers(intentId, { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: created.intent_version }, "answers-ok"));
    expect(accepted.intent_version).toBe(Number(created.intent_version) + 1);
  });

  test("TEST-F01-API-002 concurrent mutations on one intent_version have exactly one winner", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    const intentId = String(created.intent_id);
    const questionId = String((created.questions as { question_id: string }[])[0]?.question_id);
    const body = (value: number) => ({ answers: [{ question_id: questionId, value }], assumption_decisions: [], intent_version: created.intent_version });
    const results = await Promise.all([h.answers(intentId, body(6), "answers-a"), h.answers(intentId, body(8), "answers-b")]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(errorOf(results.find((response) => response.status === 409)!).code).toBe("F01-ERR-004");
    expect(h.db.intents.get(intentId)?.intent_version).toBe(Number(created.intent_version) + 1);
  });
});

describe("F01-AC-016 error envelopes always carry request_id + stable code", () => {
  const envelopeKeys = ["code", "details", "message_key", "retry_after_seconds", "retryable"];

  test("TEST-F01-API-003 transport failures use the stable envelope and echo a valid X-Request-Id", async () => {
    const h = createF01Harness();
    const requestId = "00000000-0000-4000-8000-0000000000aa";
    const cases = [
      [await h.post("/api/v1/intents", {}, { headers: { "Content-Type": "text/plain", "X-Request-Id": requestId } }), 400, "API-UNSUPPORTED-MEDIA-TYPE"],
      [await h.post("/api/v1/intents", null, { rawBody: "x".repeat(INTENT_API_MAX_BODY_BYTES + 1) }), 400, "API-REQUEST-TOO-LARGE"],
      [await h.post("/api/v1/intents", null, { rawBody: "{not json" }), 400, "F01-ERR-001"],
      [await h.post("/api/v1/intents", null, { rawBody: new Uint8Array([0x7b, 0xff, 0x7d]) }), 400, "F01-ERR-001"],
      [await h.post("/api/v1/intents", h.createBody(), { headers: { "Idempotency-Key": undefined } }), 400, "F01-ERR-001"],
      [await h.post("/api/v1/intents", { ...h.createBody(), resolved_intent: {} }), 400, "F01-ERR-001"]
    ] as const;
    for (const [response, status, code] of cases) {
      expect(response.status, code).toBe(status);
      expect(Object.keys(errorOf(response)).sort(), code).toEqual(envelopeKeys);
      expect(errorOf(response).code).toBe(code);
      expect(response.body.request_id).toBe(response.headers["X-Request-Id"]);
      expect(String(response.body.request_id)).toMatch(UUID);
    }
    expect(cases[0][0].body.request_id).toBe(requestId);
    expect((await h.post("/api/v1/intents", null, { rawBody: "{", headers: { "X-Request-Id": "not-a-uuid" } })).body.request_id).not.toBe("not-a-uuid");
    expect(h.gateway.requests).toEqual([]);
  });

  test("TEST-F01-API-003 missing identity is a stable 400; unknown and foreign intents are the same indistinguishable 404", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    const missing = await h.post(`/api/v1/intents/${intentId}/compile`, { intent_version: version }, { anon: null });
    expect([missing.status, errorOf(missing).code]).toEqual([400, "F01-ERR-001"]);
    const foreign = await h.post(`/api/v1/intents/${intentId}/compile`, { intent_version: version }, { anon: OTHER_ANON });
    const unknown = await h.post("/api/v1/intents/00000000-0000-4000-8000-00000000dead/compile", { intent_version: version });
    const malformed = await h.post("/api/v1/intents/%E0%A4%A/compile", { intent_version: version });
    for (const response of [foreign, unknown, malformed]) {
      expect(response.status).toBe(404);
      expect(errorOf(response)).toEqual(errorOf(unknown));
    }
    expect(errorOf(unknown)).toEqual({ code: "F01-ERR-015", message_key: "recovery.f01.intent_not_found", retryable: false, retry_after_seconds: null, details: {} });
    expect(JSON.stringify(foreign.body)).not.toContain(ANON);
    const mismatch = await h.post("/api/v1/intents", h.createBody(), { anon: OTHER_ANON, key: "create-mismatch" });
    expect([mismatch.status, errorOf(mismatch).code]).toEqual([400, "F01-ERR-001"]);
  });

  test("TEST-F01-API-003 provider and infrastructure failures never leak provider text, stacks or raw intent", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    const provider = await h.create();
    expect(errorOf(provider)).toMatchObject({ code: "F01-ERR-006", message_key: "recovery.f01.model_provider_unavailable", details: {} });

    const broken = createF01Harness();
    broken.db.beforeStatement = (statement) => {
      if (statement === POSTGRES_TRANSITION_INTENT_SQL) throw new Error("relation intent_record: stack at db.ts:42 secret-dsn");
    };
    const internal = await broken.create();
    expect(internal.status).toBe(500);
    expect(errorOf(internal)).toMatchObject({ code: "F01-ERR-014", details: {} });
    for (const response of [provider, internal]) {
      const text = JSON.stringify(response.body);
      for (const leak of ["scripted", "stack", "secret-dsn", RAW_INTENT_MARKER]) expect(text).not.toContain(leak);
    }
    expect(broken.diagnostics).toHaveLength(1);
  });
});

describe("F01-AC-020 timeout keeps the Intent and the logical operation retryable", () => {
  test("TEST-F01-AC-020 a Prompt A timeout keeps intent_id/result_ref and the same key retries safely", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("TIMEOUT"));
    const timedOut = await h.create();
    expect(timedOut.status).toBe(504);
    expect(errorOf(timedOut)).toMatchObject({ code: "F01-ERR-009", retryable: true });
    const [intent] = [...h.db.intents.values()];
    expect(intent).toMatchObject({ lifecycle_status: "ANALYSIS_FAILED", raw_intent: RAW_INTENT_MARKER });
    expect(h.db.operationFor(CREATE_ROUTE, "create-1")).toMatchObject({ status: "FAILED_RETRYABLE", result_ref_id: intent?.intent_id, lease_expires_at: null });
    h.gateway.queueAnalysis(succeeded(READY()));
    expect(dataOf(await h.create())).toMatchObject({ intent_id: intent?.intent_id, status: "READY" });
    expect(h.db.operationFor(CREATE_ROUTE, "create-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2 });
  });

  test("TEST-F01-AC-020 a Prompt B timeout becomes FAILED_RETRYABLE and the retry reuses the same intent", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(failedWith("TIMEOUT"));
    const timedOut = await h.compile(intentId, version);
    expect([timedOut.status, errorOf(timedOut).code]).toEqual([504, "F01-ERR-009"]);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("COMPOSITION_FAILED");
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")?.status).toBe("FAILED_RETRYABLE");
    h.clock.advance(1_000);
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    expect(dataOf(await h.compile(intentId, version))).toMatchObject({ intent_id: intentId, status: "VALIDATED" });
    expect(h.db.intents.size).toBe(1);
  });

  test("TEST-F01-AC-020 a late timed-out attempt fails closed after a takeover already validated the intent", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    let takeover: Awaited<ReturnType<F01Harness["compile"]>> | undefined;
    h.gateway.queueCompose(async () => {
      h.clock.advance(31_000);
      takeover = await h.compile(intentId, version);
      return failedWith("TIMEOUT");
    }, succeeded(blueprintCandidate()));
    const late = await h.compile(intentId, version);
    expect(dataOf(takeover!)).toMatchObject({ status: "VALIDATED" });
    expect([late.status, errorOf(late).code]).toEqual([409, "API-IDEMPOTENCY-IN-PROGRESS"]);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("VALIDATED");
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2, error_code: null });
  });
});
