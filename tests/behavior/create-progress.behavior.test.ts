import { describe, expect, test } from "vitest";

import type { CreateProgressSnapshot } from "../../src/platform/compiler/create-progress.js";
import type { StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import {
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  errorOf,
  failedWith,
  progressOf,
  readyAnalysis,
  succeeded,
  type F01Harness
} from "../api/f01-harness.js";
import { withValue } from "../contract/blueprint-validation-fixtures.js";
import { llmProposal, nffDefault } from "../contract/intent-envelope-fixtures.js";

const PLAN = ["F01-CREATE-CP-01", "F01-CREATE-CP-02", "F01-CREATE-CP-03", "F01-CREATE-CP-04", "F01-CREATE-CP-05", "F01-CREATE-CP-06"];
const asJson = (envelope: StructuredIntentEnvelope): JsonValue => envelope as unknown as JsonValue;

function twoQuestionAnalysis(): StructuredIntentEnvelope {
  const required = (id: string) => llmProposal({ id, required_for_execution: true, can_default: false, expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 1 });
  const base = clarifyingAnalysis();
  return { ...base, missing_fields: [...base.missing_fields, required("budget")] };
}

function assumptionAnalysis(): StructuredIntentEnvelope {
  return { ...readyAnalysis(), assumptions: [nffDefault({ id: "currency", proposed_default: "TWD" })] };
}

/** Each logical progress operation's snapshots must only ever extend the completed prefix of the fixed plan. */
function expectMonotonic(snapshots: readonly CreateProgressSnapshot[]): void {
  snapshots.forEach((snapshot, index) => {
    expect(snapshot.planned_checkpoint_ids).toEqual(PLAN);
    expect(PLAN.slice(0, snapshot.completed_checkpoint_ids.length)).toEqual(snapshot.completed_checkpoint_ids);
    const previous = snapshots[index - 1];
    if (previous !== undefined) expect(snapshot.completed_checkpoint_ids.length).toBeGreaterThanOrEqual(previous.completed_checkpoint_ids.length);
  });
}

function takeProgress(h: F01Harness): CreateProgressSnapshot[] {
  return h.progress.splice(0, h.progress.length);
}

const questionIds = (data: Record<string, unknown>): string[] => (data.questions as { question_id: string; semantic_item_ids: string[] }[]).map((question) => question.question_id);

describe("F01-AC-026 waiting for the User freezes progress; a material edit starts a new progress operation", () => {
  test("TEST-F01-PROG-002 clarification rounds keep the denominator and the completed set frozen until READY", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(asJson(twoQuestionAnalysis())));
    const created = await h.create();
    const data = dataOf(created);
    const [first, second] = questionIds(data);
    expect(progressOf(created)).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 2), waiting_for_user: true, lifecycle_state: "NEEDS_CLARIFICATION" });

    h.clock.advance(15 * 60 * 1000);
    const partial = await h.answers(String(data.intent_id), { answers: [{ question_id: first, value: 6 }], assumption_decisions: [], intent_version: data.intent_version }, "answers-1");
    expect(dataOf(partial).status).toBe("NEEDS_CLARIFICATION");
    expect(progressOf(partial)).toEqual(progressOf(created));

    const done = await h.answers(String(data.intent_id), { answers: [{ question_id: second, value: 3000 }], assumption_decisions: [], intent_version: dataOf(partial).intent_version }, "answers-2");
    expect(progressOf(done)).toMatchObject({ planned_checkpoint_ids: PLAN, completed_checkpoint_ids: PLAN.slice(0, 3), waiting_for_user: false });
    expectMonotonic(takeProgress(h));
  });

  test("TEST-F01-PROG-002 visible-assumption waiting freezes progress until the User decides", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(asJson(assumptionAnalysis())));
    const created = await h.create();
    const data = dataOf(created);
    expect(data.status).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(progressOf(created)).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 2), waiting_for_user: true });
    h.clock.advance(60_000);
    expect(progressOf(await h.create())).toEqual(progressOf(created));
    const accepted = await h.answers(String(data.intent_id), { answers: [], assumption_decisions: [{ assumption_id: "currency", decision: "ACCEPT" }], intent_version: data.intent_version });
    expect(progressOf(accepted)).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 3), lifecycle_state: "READY", waiting_for_user: false });
  });

  test("TEST-F01-PROG-002 a material Intent edit is a new logical operation that does not inherit the old completed count", async () => {
    const h = createF01Harness();
    const original = await h.readyIntent();
    expect(progressOf(await h.create("create-ready"))).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 3) });
    takeProgress(h);

    h.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    const edited = await h.create("create-edited", h.createBody("改成每人預算上限，並加入小費"));
    expect(dataOf(edited).intent_id).not.toBe(original.intentId);
    expect(progressOf(edited)).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 2), waiting_for_user: true });
    expect(takeProgress(h).map((snapshot) => snapshot.completed_checkpoint_ids)).toEqual([PLAN.slice(0, 2)]);
  });
});

describe("F01-AC-028 retries never duplicate checkpoints; a User retry re-derives progress from valid truth", () => {
  test("TEST-F01-PROG-004 provider and HTTP retries inside one logical operation never duplicate a checkpoint", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("NETWORK"), succeeded(asJson(readyAnalysis())));
    const created = await h.create();
    const replay = await h.create();
    expect(progressOf(replay)).toEqual(progressOf(created));
    for (const snapshot of takeProgress(h)) expect(new Set(snapshot.completed_checkpoint_ids).size).toBe(snapshot.completed_checkpoint_ids.length);
    expect(progressOf(created).completed_checkpoint_ids).toEqual(PLAN.slice(0, 3));
    const edited = await h.create("create-1", h.createBody("另一個需求"));
    expect(errorOf(edited).code).toBe("API-IDEMPOTENCY-CONFLICT");
  });

  test("TEST-F01-PROG-004 a same-key retry after FAILED_RETRYABLE starts a new progress operation from durable truth only", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    takeProgress(h);
    h.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect(errorOf(await h.compile(intentId, version)).code).toBe("F01-ERR-006");
    const failedOperation = takeProgress(h);
    expectMonotonic(failedOperation);
    expect(failedOperation.at(-1)?.completed_checkpoint_ids).toEqual(PLAN.slice(0, 4));

    h.clock.advance(1_000);
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const retried = await h.compile(intentId, version);
    const retryOperation = takeProgress(h);
    expect(retryOperation[0]).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 3), lifecycle_state: "COMPOSITION_FAILED" });
    expectMonotonic(retryOperation);
    expect(progressOf(retried)).toMatchObject({ completed_checkpoint_ids: PLAN, lifecycle_state: "VALIDATED" });
  });
});

describe("F01-AC-029 recompose never rolls progress back and BLUEPRINT_VALIDATED needs the final F02 PASS", () => {
  test("TEST-F01-PROG-005 a validation-driven recompose keeps completed checkpoints and CP-06 completes only on F02 PASS", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    takeProgress(h);
    h.gateway.queueCompose(succeeded(withValue(["extra"], true) as JsonValue), succeeded(blueprintCandidate()));
    const compiled = await h.compile(intentId, version);
    const snapshots = takeProgress(h);
    expectMonotonic(snapshots);
    expect(snapshots.filter((snapshot) => snapshot.completed_checkpoint_ids.includes("F01-CREATE-CP-06")).map((snapshot) => snapshot.lifecycle_state)).toEqual(["VALIDATED"]);
    expect(progressOf(compiled).completed_checkpoint_ids).toEqual(PLAN);
    expect([...h.db.blueprint.runs.values()].map((run) => run.status)).toEqual(["REJECTED", "PASSED"]);
  });

  test("TEST-F01-PROG-005 a final F02 rejection never completes BLUEPRINT_VALIDATED", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    takeProgress(h);
    h.gateway.queueCompose(succeeded(withValue(["extra"], true) as JsonValue), succeeded(withValue(["extra"], true) as JsonValue));
    const rejected = await h.compile(intentId, version);
    expect(errorOf(rejected).code).toBe("F01-ERR-011");
    const snapshots = takeProgress(h);
    expectMonotonic(snapshots);
    expect(snapshots.some((snapshot) => snapshot.completed_checkpoint_ids.includes("F01-CREATE-CP-06"))).toBe(false);
    expect(rejected.body).not.toHaveProperty("data");
  });
});
