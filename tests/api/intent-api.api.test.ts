import { describe, expect, test } from "vitest";

import { INTENT_API_MAX_BODY_BYTES } from "../../src/edge/intent-api.js";
import { POSTGRES_TRANSITION_INTENT_SQL } from "../../src/platform/compiler/postgres-compiler-repository.js";
import type { StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { actionIndex, withValue } from "../contract/blueprint-validation-fixtures.js";
import { knownInput } from "../contract/intent-envelope-fixtures.js";
import {
  ANON,
  DNP_ID,
  DNP_OTHER_SECRET,
  DNP_SECRET,
  OTHER_ANON,
  RAW_INTENT_MARKER,
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  dnpReadyAnalysis,
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
const CVV_ID = "card_cvv";
const CVV_SECRET = "cvv-913-SECRET";
const PAN_INPUT = { id: DNP_ID, value: DNP_SECRET };
const CVV_INPUT = { id: CVV_ID, value: CVV_SECRET };
const SECRETS = [DNP_SECRET, DNP_OTHER_SECRET, CVV_SECRET];
const resourceTerminal = (): JsonValue =>
  withValue(["actions", actionIndex("action_reset"), "steps"], Array.from({ length: 17 }, () => ({ type: "RESET_STATE", target: "ALL_MUTABLE" }))) as JsonValue;
const registryIncompatible = (): JsonValue => withValue(["registry_version"], "6.0.0") as JsonValue;

/** Two referenced DO_NOT_PERSIST inputs, so canonical id ordering of `ephemeral_inputs[]` is observable. */
function twoMarkerAnalysis(): StructuredIntentEnvelope {
  const base = dnpReadyAnalysis();
  return { ...base, known_inputs: [...base.known_inputs, knownInput({ id: CVV_ID, value: CVV_SECRET, sensitivity: "DO_NOT_PERSIST" })] };
}

function expectNoSecret(text: string): void {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
}

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

  test("TEST-F01-AC-014 same-key retry with the same canonical ephemeral body is one logical compile; a changed value conflicts", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(twoMarkerAnalysis());
    h.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect(errorOf(await h.compileWith(intentId, version, [PAN_INPUT, CVV_INPUT])).code).toBe("F01-ERR-006");
    const failedAttempt = structuredClone(h.db.operationFor(COMPILE_ROUTE, "compile-1")!);
    expect(failedAttempt).toMatchObject({ status: "FAILED_RETRYABLE", attempt_no: 1 });
    expectNoSecret(h.durableText());

    h.clock.advance(1_000);
    const changed = await h.compileWith(intentId, version, [{ id: DNP_ID, value: DNP_OTHER_SECRET }, CVV_INPUT]);
    expect([changed.status, errorOf(changed).code]).toEqual([409, "API-IDEMPOTENCY-CONFLICT"]);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toEqual(failedAttempt);

    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const retried = await h.compileWith(intentId, version, [CVV_INPUT, PAN_INPUT]);
    expect(dataOf(retried)).toMatchObject({ status: "VALIDATED" });
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2, request_digest: failedAttempt.request_digest });
    const composes = h.gateway.calls("BLUEPRINT_COMPOSE");
    expect(composes).toHaveLength(3);
    expect(composes[2]?.input_payload.ephemeral_resolved_context).toEqual(composes[0]?.input_payload.ephemeral_resolved_context);
    expect((composes[2]?.input_payload.ephemeral_resolved_context as { inputs: { id: string }[] }).inputs.map((input) => input.id)).toEqual([CVV_ID, DNP_ID]);

    expect(dataOf(await h.compileWith(intentId, version, [PAN_INPUT, CVV_INPUT]))).toEqual(dataOf(retried));
    expect(errorOf(await h.compileWith(intentId, version, [{ id: DNP_ID, value: DNP_OTHER_SECRET }, CVV_INPUT])).code).toBe("API-IDEMPOTENCY-CONFLICT");
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(3);
    expect([...h.db.operations.values()].filter((row) => row.route_key === COMPILE_ROUTE)).toHaveLength(1);
    expectNoSecret(h.durableText());
  });

  test("TEST-F01-AC-014 an expired lease takeover re-submitting the same ephemeral body stays one logical compile", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    let takeover: Awaited<ReturnType<F01Harness["compile"]>> | undefined;
    h.gateway.queueCompose(async () => {
      h.clock.advance(31_000);
      takeover = await h.compileWith(intentId, version, [PAN_INPUT]);
      return succeeded(blueprintCandidate());
    }, succeeded(blueprintCandidate()));
    const late = await h.compileWith(intentId, version, [PAN_INPUT]);
    expect(dataOf(takeover!)).toMatchObject({ status: "VALIDATED" });
    expect([late.status, errorOf(late).code]).toEqual([409, "API-IDEMPOTENCY-IN-PROGRESS"]);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2 });
    expect([...h.db.blueprint.runs.values()].filter((run) => run.status === "PASSED")).toHaveLength(1);
    for (const request of h.gateway.calls("BLUEPRINT_COMPOSE")) {
      expect(request.input_payload.ephemeral_resolved_context).toEqual({ inputs: [expect.objectContaining({ id: DNP_ID, value: DNP_SECRET })] });
    }
    expectNoSecret(h.durableText());
  });

  test("TEST-F01-AC-014 same-key FAILED_TERMINAL replay returns the same terminal outcome without re-running Prompt B", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    h.gateway.queueCompose(succeeded(resourceTerminal()));
    const first = await h.compileWith(intentId, version, [PAN_INPUT]);
    expect(first.status).toBe(422);
    expect(errorOf(first)).toMatchObject({ code: "F01-ERR-011", retryable: false, details: { rejection_class: "RESOURCE_TERMINAL" } });
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "FAILED_TERMINAL", error_code: "F01-ERR-011", http_status: 422 });
    h.clock.advance(60_000);
    const replay = await h.compileWith(intentId, version, [PAN_INPUT]);
    expect([replay.status, errorOf(replay)]).toEqual([422, errorOf(first)]);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "FAILED_TERMINAL", attempt_no: 1 });
    expectNoSecret(h.durableText());

    const g = createF01Harness();
    const ready = await g.readyIntent();
    g.gateway.queueCompose(succeeded(registryIncompatible()), succeeded(registryIncompatible()));
    const incompatible = await g.compile(ready.intentId, ready.version);
    expect(incompatible.status).toBe(422);
    expect(errorOf(incompatible)).toMatchObject({ code: "F01-ERR-011", retryable: false, details: { rejection_class: "CAPABILITY_FIXABLE" } });
    expect(g.db.intents.get(ready.intentId)?.lifecycle_status).toBe("INCOMPATIBLE");
    const incompatibleReplay = await g.compile(ready.intentId, ready.version);
    expect([incompatibleReplay.status, errorOf(incompatibleReplay)]).toEqual([422, errorOf(incompatible)]);
    expect(g.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(2);
  });
});

describe("F01-AC-014 FAILED_TERMINAL replay keeps the bounded terminal recovery truth", () => {
  test("TEST-F01-AC-014 a not-compilable F01-ERR-001 FAILED_TERMINAL replays the same bounded reason without new work", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    const intentId = String(created.intent_id);
    const intentVersion = Number(created.intent_version);
    const first = await h.compile(intentId, intentVersion, "compile-early");
    expect(first.status).toBe(422);
    expect(errorOf(first)).toMatchObject({ code: "F01-ERR-001", retryable: false, retry_after_seconds: null });
    expect(errorOf(first).details).toEqual({ reason: "INTENT_NOT_COMPILABLE" });
    const terminal = structuredClone(h.db.operationFor(COMPILE_ROUTE, "compile-early")!);
    expect(terminal).toMatchObject({ status: "FAILED_TERMINAL", attempt_no: 1, error_code: "F01-ERR-001", http_status: 422, result_ref_type: null, result_ref_id: null });
    h.clock.advance(60_000);
    const replay = await h.compile(intentId, intentVersion, "compile-early");
    expect([replay.status, errorOf(replay)]).toEqual([422, errorOf(first)]);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-early")).toEqual(terminal);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect([...h.db.compilerRuns.values()].filter((run) => run.stage === "BLUEPRINT_COMPOSE")).toEqual([]);

    const g = createF01Harness();
    const { intentId: validatedId } = await compiledIntent(g);
    const validatedVersion = Number(g.db.intents.get(validatedId)?.intent_version);
    const again = await g.compile(validatedId, validatedVersion, "compile-again");
    expect(again.status).toBe(422);
    expect(errorOf(again)).toMatchObject({ code: "F01-ERR-001", retryable: false });
    expect(errorOf(again).details).toEqual({ reason: "INTENT_NOT_COMPILABLE" });
    g.clock.advance(60_000);
    const againReplay = await g.compile(validatedId, validatedVersion, "compile-again");
    expect([againReplay.status, errorOf(againReplay)]).toEqual([422, errorOf(again)]);
    expect(g.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);
    expect(g.db.operationFor(COMPILE_ROUTE, "compile-again")).toMatchObject({ status: "FAILED_TERMINAL", attempt_no: 1, error_code: "F01-ERR-001", http_status: 422 });
  });

  test("TEST-F01-AC-014 an F01-ERR-001 FAILED_TERMINAL replay stays the same terminal outcome after answers move the intent to READY", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    const intentId = String(created.intent_id);
    const originalVersion = Number(created.intent_version);
    expect(created.status).toBe("NEEDS_CLARIFICATION");

    const first = await h.compile(intentId, originalVersion, "compile-drift");
    expect(first.status).toBe(422);
    expect(errorOf(first)).toMatchObject({ code: "F01-ERR-001", retryable: false });
    expect(errorOf(first).details).toEqual({ reason: "INTENT_NOT_COMPILABLE" });
    const terminal = structuredClone(h.db.operationFor(COMPILE_ROUTE, "compile-drift")!);
    expect(terminal).toMatchObject({ status: "FAILED_TERMINAL", attempt_no: 1, error_code: "F01-ERR-001", http_status: 422 });

    const questionId = String((created.questions as { question_id: string }[])[0]?.question_id);
    const answered = dataOf(await h.answers(intentId, { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: originalVersion }, "answers-drift"));
    expect(answered.status).toBe("READY");
    expect(Number(answered.intent_version)).toBeGreaterThan(originalVersion);
    expect(h.db.intents.get(intentId)).toMatchObject({ lifecycle_status: "READY", intent_version: answered.intent_version });

    h.clock.advance(60_000);
    const replay = await h.compile(intentId, originalVersion, "compile-drift");
    expect(replay.status).toBe(first.status);
    expect(errorOf(replay)).toEqual(errorOf(first));
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-drift")).toEqual(terminal);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect([...h.db.compilerRuns.values()].filter((run) => run.stage === "BLUEPRINT_COMPOSE")).toEqual([]);
    expect(h.db.blueprint.runs.size).toBe(0);
    expect(h.db.intents.get(intentId)).toMatchObject({ lifecycle_status: "READY", intent_version: answered.intent_version });
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

  test("TEST-F01-API-003 missing or invalid ephemeral bindings are a stable F01-ERR-001 with sorted marker IDs and no values", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(twoMarkerAnalysis());
    const plain = await h.readyIntent(readyAnalysis(), "create-plain");
    const before = structuredClone([h.db.intents.get(intentId), h.db.intents.get(plain.intentId)]);
    const both = [CVV_ID, DNP_ID];
    const cases: readonly (readonly [string, number, unknown, string, readonly string[]])[] = [
      [intentId, version, undefined, "EPHEMERAL_INPUT_REQUIRED", both],
      [intentId, version, [], "EPHEMERAL_INPUT_REQUIRED", both],
      [intentId, version, [PAN_INPUT], "EPHEMERAL_INPUT_REQUIRED", [CVV_ID]],
      [intentId, version, [PAN_INPUT, CVV_INPUT, { id: "unknown_probe_id", value: "probe-value" }], "EPHEMERAL_INPUT_INVALID", []],
      [intentId, version, [PAN_INPUT, CVV_INPUT, PAN_INPUT], "EPHEMERAL_INPUT_INVALID", [DNP_ID]],
      [intentId, version, [{ id: DNP_ID, value: 4111 }, CVV_INPUT], "EPHEMERAL_INPUT_INVALID", [DNP_ID]],
      [intentId, version, [{ ...PAN_INPUT, value_type: "NUMBER" }, { ...CVV_INPUT, sensitivity: "NORMAL" }], "EPHEMERAL_INPUT_INVALID", both],
      [intentId, version, [null, CVV_INPUT], "EPHEMERAL_INPUT_INVALID", []],
      [intentId, version, `${DNP_ID}=${DNP_SECRET}`, "EPHEMERAL_INPUT_INVALID", []],
      [plain.intentId, plain.version, [{ id: "unknown_probe_id", value: "probe-value" }], "EPHEMERAL_INPUT_INVALID", []]
    ];
    for (const [index, [target, targetVersion, ephemeral, reason, inputIds]] of cases.entries()) {
      const response = ephemeral === undefined ? await h.compile(target, targetVersion, `bind-${index}`) : await h.compileWith(target, targetVersion, ephemeral, `bind-${index}`);
      expect(response.status, reason).toBe(400);
      expect(Object.keys(errorOf(response)).sort()).toEqual(envelopeKeys);
      expect(errorOf(response)).toMatchObject({ code: "F01-ERR-001", message_key: "recovery.f01.invalid_request", retryable: false });
      expect(errorOf(response).details).toEqual({ reason, input_ids: inputIds });
      const text = JSON.stringify(response.body);
      expectNoSecret(text);
      for (const probe of ["unknown_probe_id", "probe-value"]) expect(text).not.toContain(probe);
    }
    const forged = await h.post(`/api/v1/intents/${intentId}/compile`, { intent_version: version, ephemeral_inputs: [PAN_INPUT, CVV_INPUT], ephemeral_input_requirements: [] }, { key: "bind-forged" });
    expect(errorOf(forged)).toMatchObject({ code: "F01-ERR-001", details: { violations: [{ path: "$.ephemeral_input_requirements", reason: "SERVER_OWNED_FIELD" }] } });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect([...h.db.operations.values()].filter((row) => row.route_key === COMPILE_ROUTE)).toEqual([]);
    expect([h.db.intents.get(intentId), h.db.intents.get(plain.intentId)]).toEqual(before);
    expectNoSecret(h.durableText());
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

  test("TEST-F01-AC-020 a Prompt B timeout retry re-submits the request-scoped ephemeral input; the server never reconstructs it", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    h.gateway.queueCompose(failedWith("TIMEOUT"));
    const timedOut = await h.compileWith(intentId, version, [PAN_INPUT]);
    expect([timedOut.status, errorOf(timedOut).code, errorOf(timedOut).retryable]).toEqual([504, "F01-ERR-009", true]);
    const failedAttempt = structuredClone(h.db.operationFor(COMPILE_ROUTE, "compile-1")!);
    expect(failedAttempt).toMatchObject({ status: "FAILED_RETRYABLE", attempt_no: 1 });
    expectNoSecret(h.durableText());

    h.clock.advance(1_000);
    const withoutValue = await h.compile(intentId, version);
    expect(errorOf(withoutValue)).toMatchObject({ code: "F01-ERR-001", details: { reason: "EPHEMERAL_INPUT_REQUIRED", input_ids: [DNP_ID] } });
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toEqual(failedAttempt);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);

    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    expect(dataOf(await h.compileWith(intentId, version, [PAN_INPUT]))).toMatchObject({ intent_id: intentId, status: "VALIDATED" });
    const composes = h.gateway.calls("BLUEPRINT_COMPOSE");
    expect(composes).toHaveLength(2);
    expect(composes[1]?.input_payload.ephemeral_resolved_context).toEqual({ inputs: [expect.objectContaining({ id: DNP_ID, value: DNP_SECRET })] });
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")).toMatchObject({ status: "SUCCEEDED", attempt_no: 2 });
    expectNoSecret(h.durableText());
  });
});
