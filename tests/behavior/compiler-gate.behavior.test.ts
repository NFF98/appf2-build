import { describe, expect, test } from "vitest";

import { POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { resolveCapabilityCoverage, type CoverageResolutionRequest } from "../../src/platform/capabilities/coverage.js";
import { ephemeralValueDetector } from "../../src/platform/compiler/ephemeral-binding.js";
import { restoreTrustedIntentState, startIntentClarification } from "../../src/platform/intent/intent-state.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { admitResolvedIntent, isResolvedIntentAdmission } from "../../src/platform/intent/resolved-intent-gate.js";
import { projectResolvedIntent } from "../../src/platform/intent/resolved-intent.js";
import {
  ANON,
  DNP_ID,
  DNP_SECRET,
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  dnpReadyAnalysis,
  errorOf,
  failedWith,
  numericHint,
  readyAnalysis,
  resultHint,
  succeeded,
  type F01Harness
} from "../api/f01-harness.js";
import { actionIndex, nodeIndex, withValue } from "../contract/blueprint-validation-fixtures.js";
import { knownInput } from "../contract/intent-envelope-fixtures.js";

const schemaFixable = (): JsonValue => withValue(["extra"], true) as JsonValue;
const capabilityFixable = (): JsonValue => withValue(["nodes", nodeIndex("node_title"), "capability", "version"], "9.9.9") as JsonValue;
const resourceTerminal = (): JsonValue =>
  withValue(["actions", actionIndex("action_reset"), "steps"], Array.from({ length: 17 }, () => ({ type: "RESET_STATE", target: "ALL_MUTABLE" }))) as JsonValue;

const composeRuns = (h: F01Harness) => [...h.db.compilerRuns.values()].filter((run) => run.stage === "BLUEPRINT_COMPOSE");
const validationRuns = (h: F01Harness) => [...h.db.blueprint.runs.values()];
const eventTypes = (h: F01Harness) => h.evidenceRows.map((event) => event.event_type);

function expectedProjection(structured: unknown, intentId: string) {
  const admission = admitResolvedIntent(restoreTrustedIntentState(structured));
  if (!isResolvedIntentAdmission(admission)) throw new Error("fixture must pass the gate");
  return projectResolvedIntent(admission, intentId);
}

describe("F01-AC-007 Prompt B never runs before the Clarification Gate passes", () => {
  test("TEST-F01-007 NEEDS_CLARIFICATION blocks compile; READY persists the exact DATA-005 projection Prompt B receives", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    const intentId = String(created.intent_id);
    expect(created.status).toBe("NEEDS_CLARIFICATION");

    const blocked = await h.compile(intentId, Number(created.intent_version), "compile-early");
    expect(blocked.status).toBe(422);
    expect(errorOf(blocked).code).toBe("F01-ERR-001");
    expect(errorOf(blocked).details).toEqual({ reason: "INTENT_NOT_COMPILABLE" });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect(composeRuns(h)).toEqual([]);
    expect(h.db.intents.get(intentId)).toMatchObject({ lifecycle_status: "NEEDS_CLARIFICATION", resolved_intent: null });

    const questionId = String((created.questions as { question_id: string }[])[0]?.question_id);
    const answered = dataOf(await h.answers(intentId, { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: created.intent_version }));
    expect(answered.status).toBe("READY");
    const row = h.db.intents.get(intentId)!;
    const projection = expectedProjection(row.structured_intent, intentId);
    expect(row.resolved_intent).toEqual(JSON.parse(JSON.stringify(projection.resolved_intent)));
    expect(projection.resolved_intent.capability_requirements).toHaveLength(2);

    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const compiled = await h.compile(intentId, Number(answered.intent_version), "compile-ready");
    expect(compiled.status, JSON.stringify(compiled.body)).toBe(200);
    const [composeRequest] = h.gateway.calls("BLUEPRINT_COMPOSE");
    expect(composeRequest?.input_payload.resolved_intent).toEqual(row.resolved_intent);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);
  });

  test("TEST-F01-007 a referenced DO_NOT_PERSIST input is durable only as a value-free marker and reaches Prompt B request-scoped", async () => {
    const marker = { id: DNP_ID, key: DNP_ID, value_type: "STRING", source: "USER_EXPLICIT" };
    const fromValues = expectedProjection(startIntentClarification(dnpReadyAnalysis()).envelope, ANON);
    expect(fromValues.ephemeral_requirements).toEqual([marker]);
    expect(JSON.stringify(fromValues)).not.toContain(DNP_SECRET);

    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    const row = structuredClone(h.db.intents.get(intentId)!);
    const structured = row.structured_intent as { known_inputs: { id: string }[]; ephemeral_input_requirements: unknown };
    const resolved = row.resolved_intent as { inputs: { id: string }[]; provenance_map: object; capability_requirements: unknown[]; ephemeral_input_requirements: unknown };
    expect(structured.known_inputs.map((input) => input.id)).toEqual(["payer"]);
    expect(structured.ephemeral_input_requirements).toEqual([marker]);
    expect(resolved.ephemeral_input_requirements).toEqual([marker]);
    expect(resolved.inputs.map((input) => input.id)).toEqual(["payer"]);
    expect(Object.keys(resolved.provenance_map)).not.toContain(DNP_ID);
    expect(resolved.capability_requirements).toHaveLength(2);
    expect(row.resolved_intent).toEqual(JSON.parse(JSON.stringify(expectedProjection(row.structured_intent, intentId).resolved_intent)));
    expect(h.durableText()).not.toContain(DNP_SECRET);

    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const compiled = await h.compileWith(intentId, version, [{ id: DNP_ID, value: DNP_SECRET }]);
    expect(compiled.status, JSON.stringify(compiled.body)).toBe(200);
    const [composeRequest] = h.gateway.calls("BLUEPRINT_COMPOSE");
    expect(composeRequest?.input_payload.ephemeral_resolved_context).toEqual({ inputs: [{ ...marker, value: DNP_SECRET, sensitivity: "DO_NOT_PERSIST" }] });
    expect(composeRequest?.input_payload.resolved_intent).toEqual(row.resolved_intent);
    const after = h.db.intents.get(intentId)!;
    expect([after.structured_intent, after.resolved_intent]).toEqual([row.structured_intent, row.resolved_intent]);
    expect(h.durableText()).not.toContain(DNP_SECRET);
    expect(JSON.stringify(compiled.body)).not.toContain(DNP_SECRET);
  });

  test("TEST-F01-007 Prompt B never runs before the required ephemeral binding validates; Prompt A cannot assert the marker", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    const before = structuredClone(h.db.intents.get(intentId));
    for (const [ephemeral, reason] of [[undefined, "EPHEMERAL_INPUT_REQUIRED"], [[{ id: DNP_ID, value: 42 }], "EPHEMERAL_INPUT_INVALID"]] as const) {
      const response = ephemeral === undefined ? await h.compile(intentId, version) : await h.compileWith(intentId, version, ephemeral);
      expect([response.status, errorOf(response).code, errorOf(response).details.reason]).toEqual([400, "F01-ERR-001", reason]);
    }
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect(composeRuns(h)).toEqual([]);
    expect(h.db.intents.get(intentId)).toEqual(before);
    expect(h.db.operationFor("POST /api/v1/intents/{intent_id}/compile", "compile-1")).toBeUndefined();

    const asserted = createF01Harness();
    const forged = { ...readyAnalysis(), ephemeral_input_requirements: [{ id: "forged", key: "forged", value_type: "STRING", source: "USER_EXPLICIT" }] };
    asserted.gateway.queueAnalysis(succeeded(forged as unknown as JsonValue), succeeded(forged as unknown as JsonValue));
    expect(errorOf(await asserted.create()).code).toBe("F01-ERR-002");
    expect([...asserted.db.intents.values()][0]).toMatchObject({ lifecycle_status: "ANALYSIS_FAILED", structured_intent: null });
  });

  test("TEST-F01-007 a drifted persisted ResolvedIntent is rejected before any Prompt B call", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    const row = h.db.intents.get(intentId)!;
    row.resolved_intent = { ...(row.resolved_intent as Record<string, unknown>), goal: "client-tampered goal" };
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(500);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-014", details: {} });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("READY");
  });
});

describe("F01-AC-007 DO_NOT_PERSIST values never cross from Prompt B output into durable truth", () => {
  test("TEST-F01-007 a Prompt B candidate echoing a DO_NOT_PERSIST value is rejected before F02 admission and never becomes durable", async () => {
    const echoes: readonly JsonValue[] = [
      withValue(["meta", "description"], `付款卡號 ${DNP_SECRET} 已帶入`) as JsonValue,
      withValue(["nodes", nodeIndex("node_title"), "bindings", "text", "value"], DNP_SECRET) as JsonValue
    ];
    for (const echo of echoes) expect(validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(echo))).report.status).toBe("PASSED");

    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(dnpReadyAnalysis());
    h.gateway.queueCompose(succeeded(echoes[0]!), succeeded(echoes[1]!));
    const rejected = await h.compileWith(intentId, version, [{ id: DNP_ID, value: DNP_SECRET }]);
    expect(rejected.status).toBe(502);
    expect(errorOf(rejected)).toMatchObject({ code: "F01-ERR-007", retryable: true, details: {} });
    expect(composeRuns(h).map((run) => [run.status, run.failure_code])).toEqual([["FAILED", "F01-ERR-007"], ["FAILED", "F01-ERR-007"]]);
    expect(validationRuns(h)).toEqual([]);
    expect(h.db.blueprint.contents.size).toBe(0);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("COMPOSITION_FAILED");
    expect(h.db.operationFor("POST /api/v1/intents/{intent_id}/compile", "compile-1")).toMatchObject({ status: "FAILED_RETRYABLE", error_code: "F01-ERR-007" });
    expect(eventTypes(h)).toContain("F01-EVT-011");
    expect(eventTypes(h)).not.toContain("F01-EVT-013");
    expect(h.diagnostics).toEqual([]);
    expect(JSON.stringify(rejected.body)).not.toContain(DNP_SECRET);
    expect(h.durableText()).not.toContain(DNP_SECRET);

    h.clock.advance(1_000);
    h.gateway.queueCompose(succeeded(echoes[1]!), succeeded(blueprintCandidate()));
    const compiled = await h.compileWith(intentId, version, [{ id: DNP_ID, value: DNP_SECRET }]);
    expect(compiled.status, JSON.stringify(compiled.body)).toBe(200);
    expect(dataOf(compiled)).toMatchObject({ status: "VALIDATED" });
    const composes = h.gateway.calls("BLUEPRINT_COMPOSE");
    expect(composes).toHaveLength(4);
    for (const request of composes) {
      expect(request.input_payload.ephemeral_resolved_context).toEqual({ inputs: [expect.objectContaining({ id: DNP_ID, value: DNP_SECRET })] });
    }
    expect(validationRuns(h).map((run) => run.status)).toEqual(["PASSED"]);
    expect(h.db.blueprint.contents.size).toBe(1);
    expect(JSON.stringify([...h.db.blueprint.contents.values()])).not.toContain(DNP_SECRET);
    expect(JSON.stringify(compiled.body)).not.toContain(DNP_SECRET);
    expect(h.durableText()).not.toContain(DNP_SECRET);
  });

  test("TEST-F01-007 the DO_NOT_PERSIST echo guard matches every value leaf type-exactly, inside strings and keys, and nothing else", () => {
    const detect = ephemeralValueDetector({
      inputs: [
        knownInput({ id: "pin", value: 482913, value_type: "NUMBER", sensitivity: "DO_NOT_PERSIST" }),
        knownInput({ id: "account", value: { holder: "Zed-Holder-Q", tags: ["vip-tag-77"] }, value_type: "RECORD", sensitivity: "DO_NOT_PERSIST" })
      ]
    });
    expect(detect({ amount: 482913 })).toBe(true);
    expect(detect({ text: "code 482913 ok" })).toBe(true);
    expect(detect({ "Zed-Holder-Q": 1 })).toBe(true);
    expect(detect({ list: [{ deep: "x vip-tag-77 y" }] })).toBe(true);
    expect(detect({ holder: "someone", tags: [], amount: 482914 })).toBe(false);
    expect(detect(blueprintCandidate())).toBe(false);
    expect(ephemeralValueDetector({ inputs: [] })(withValue(["meta", "title"], "482913") as JsonValue)).toBe(false);
  });
});

describe("F01-AC-009 Unsupported / External never fake local success", () => {
  const flightHint = resultHint({ hint_id: "book_flight", semantic_need: "flight_booking", interaction_class: "action", impact_level: "HIGH" });

  test("TEST-F01-AC-009 UNSUPPORTED coverage ends INCOMPATIBLE with F01-ERR-008 and no Blueprint", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent(readyAnalysis({ hints: [numericHint(), flightHint] }));
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(422);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-008", retryable: false, details: { coverage_status: "UNSUPPORTED" } });
    expect(h.db.intents.get(intentId)).toMatchObject({ lifecycle_status: "INCOMPATIBLE" });
    expect(h.db.intents.get(intentId)?.expires_at).not.toBeNull();
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect(validationRuns(h)).toEqual([]);
    expect(h.db.blueprint.contents.size).toBe(0);
    expect(h.evidenceRows.find((event) => event.event_type === "F01-EVT-008")?.properties).toMatchObject({ coverage_status: "UNSUPPORTED" });
    expect(eventTypes(h)).not.toContain("F01-EVT-013");
    expect(h.db.operationFor("POST /api/v1/intents/{intent_id}/compile", "compile-1")).toMatchObject({ status: "FAILED_TERMINAL", error_code: "F01-ERR-008" });
    const replay = await h.compile(intentId, version);
    expect([replay.status, errorOf(replay)]).toEqual([422, errorOf(response)]);

    const again = await h.compile(intentId, version + 1, "compile-again");
    expect(errorOf(again).code).toBe("F01-ERR-001");
    expect(errorOf(again).details).toEqual({ reason: "INTENT_NOT_COMPILABLE" });
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("INCOMPATIBLE");
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
  });

  test("TEST-F01-AC-009 EXTERNAL_OR_HEAVY_REQUIRED coverage is reported, never composed as a local App", async () => {
    const external = (request: CoverageResolutionRequest) =>
      resolveCapabilityCoverage({ ...request, externalRequirementIds: new Set(request.requirements.filter((r) => r.semantic_need === "result").map((r) => r.requirement_id)) });
    const h = createF01Harness({ coverage: external });
    const { intentId, version } = await h.readyIntent();
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(422);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-008", details: { coverage_status: "EXTERNAL_OR_HEAVY_REQUIRED" } });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toEqual([]);
    expect(h.db.blueprint.contents.size).toBe(0);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("INCOMPATIBLE");
  });
});

describe("F01-AC-010 Prompt B output always goes through F02", () => {
  test("TEST-F01-010 every Prompt B candidate gets its own F02 validation_run bound to its compiler_run", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded(schemaFixable()), succeeded(blueprintCandidate()));
    const response = await h.compile(intentId, version);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const composes = composeRuns(h).filter((run) => run.status === "SUCCEEDED");
    const runs = validationRuns(h);
    expect(composes).toHaveLength(2);
    expect(runs.map((run) => run.status)).toEqual(["REJECTED", "PASSED"]);
    expect(runs.map((run) => run.compiler_run_id).sort()).toEqual(composes.map((run) => run.compiler_run_id).sort());
    const passed = runs.find((run) => run.status === "PASSED")!;
    expect(dataOf(response)).toMatchObject({ status: "VALIDATED", content_hash: passed.blueprint_hash });
    expect(h.db.blueprint.contents.get(passed.blueprint_hash!)?.trust_status).toBe("VALIDATED");
    expect(eventTypes(h).filter((type) => type.startsWith("F02-")).length).toBeGreaterThanOrEqual(2);
  });

  test("TEST-F01-010 lifecycle is VALIDATING during F02 admission and VALIDATED only after it", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    const seen: string[] = [];
    h.db.beforeStatement = (statement) => {
      if (statement === POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL) seen.push(String(h.db.intents.get(intentId)?.lifecycle_status));
    };
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    expect((await h.compile(intentId, version)).status).toBe(200);
    expect(seen).toEqual(["VALIDATING"]);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("VALIDATED");
  });

  test("TEST-F01-010 non-object Prompt B output is invalid structured output, never a validated Blueprint", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded([1, 2, 3]), succeeded("not a blueprint"));
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(502);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-007", retryable: true });
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("COMPOSITION_FAILED");
    expect(validationRuns(h)).toEqual([]);
    expect(h.db.blueprint.contents.size).toBe(0);
  });
});

describe("F01-AC-012 validation-driven recompose happens at most once per logical compile", () => {
  test("TEST-F01-012 a second fixable rejection stops with F01-ERR-011 after exactly one recompose", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded(schemaFixable()), succeeded(schemaFixable()));
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(422);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-011", retryable: true, details: { rejection_class: "SCHEMA_FIXABLE" } });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(2);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")[1]?.input_payload.previous_validation_issues).toEqual([expect.objectContaining({ error_code: "F02-ERR-002" })]);
    expect(validationRuns(h).map((run) => run.status)).toEqual(["REJECTED", "REJECTED"]);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("VALIDATION_REJECTED");
    expect(eventTypes(h).filter((type) => type === "F01-EVT-012")).toHaveLength(1);
  });

  test("TEST-F01-012 CAPABILITY_FIXABLE refreshes F04 first and a different class never opens a second budget", async () => {
    let coverageCalls = 0;
    const h = createF01Harness({
      coverage: (request) => {
        coverageCalls += 1;
        return resolveCapabilityCoverage(request);
      }
    });
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded(capabilityFixable()), succeeded(schemaFixable()));
    const response = await h.compile(intentId, version);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-011", details: { rejection_class: "SCHEMA_FIXABLE" } });
    expect(coverageCalls).toBe(2);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(2);
    expect(eventTypes(h).filter((type) => type === "F01-EVT-008")).toHaveLength(2);
  });

  test("TEST-F01-012 a same-key retry of the logical compile inherits the spent recompose budget", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded(schemaFixable()), succeeded(schemaFixable()));
    expect((await h.compile(intentId, version)).status).toBe(422);
    h.clock.advance(1_000);
    h.gateway.queueCompose(succeeded(schemaFixable()), succeeded(blueprintCandidate()));
    const retried = await h.compile(intentId, version);
    expect(errorOf(retried)).toMatchObject({ code: "F01-ERR-011" });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(3);
    expect(h.db.operationFor("POST /api/v1/intents/{intent_id}/compile", "compile-1")).toMatchObject({ status: "FAILED_RETRYABLE", attempt_no: 2 });
  });
});

describe("F01-AC-021 compile failure never damages an existing Blueprint", () => {
  test("TEST-F01-021 later composition and validation failures leave the validated Blueprint and its intent untouched", async () => {
    const h = createF01Harness();
    const first = await h.readyIntent();
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const compiled = dataOf(await h.compile(first.intentId, first.version, "compile-a"));
    const hash = String(compiled.content_hash);
    const contentBefore = structuredClone(h.db.blueprint.contents.get(hash));
    const intentBefore = structuredClone(h.db.intents.get(first.intentId));

    h.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue));
    const refine = dataOf(await h.post("/api/v1/intents", { anonymous_id: ANON, intent_kind: "REFINE", raw_intent: "改成五個人", context: { source_blueprint_hash: hash } }, { key: "create-refine" }));
    const refineId = String(refine.intent_id);
    h.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect(errorOf(await h.compile(refineId, Number(refine.intent_version), "compile-b1")).code).toBe("F01-ERR-006");
    h.gateway.queueCompose(succeeded(resourceTerminal()));
    const rejected = await h.compile(refineId, Number(h.db.intents.get(refineId)?.intent_version), "compile-b2");
    expect(errorOf(rejected)).toMatchObject({ code: "F01-ERR-011", retryable: false, details: { rejection_class: "RESOURCE_TERMINAL" } });

    expect(h.db.blueprint.contents.get(hash)).toEqual(contentBefore);
    expect(h.db.blueprint.contents.size).toBe(1);
    expect(h.db.intents.get(first.intentId)).toEqual(intentBefore);
    expect(h.db.intents.get(refineId)?.source_blueprint_hash).toBe(hash);
    const replay = await h.compile(first.intentId, first.version, "compile-a");
    expect(dataOf(replay)).toEqual(compiled);
  });
});
