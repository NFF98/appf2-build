import { describe, expect, test } from "vitest";

import type { IntentLifecycleStatus } from "../../src/platform/compiler/compiler-records.js";
import {
  CREATE_CHECKPOINT_IDS,
  CREATE_CHECKPOINT_MILESTONES,
  CREATE_PROGRESS_PLAN_VERSION,
  CreateProgressOperation,
  deriveCreateProgress,
  progressApplies
} from "../../src/platform/compiler/create-progress.js";
import { IntentContractError } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import {
  ANON,
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  errorOf,
  failedWith,
  progressOf,
  readyAnalysis,
  succeeded
} from "../api/f01-harness.js";

const PLAN = ["F01-CREATE-CP-01", "F01-CREATE-CP-02", "F01-CREATE-CP-03", "F01-CREATE-CP-04", "F01-CREATE-CP-05", "F01-CREATE-CP-06"];
const SNAPSHOT_KEYS = ["completed_checkpoint_ids", "lifecycle_state", "mode", "plan_version", "planned_checkpoint_ids", "waiting_for_user"];

describe("F01-AC-025 CREATE v1 uses the fixed six-checkpoint plan with monotonic completion", () => {
  test("TEST-F01-PROG-001 the plan is the locked ordered six checkpoints with their milestone names", () => {
    expect(CREATE_PROGRESS_PLAN_VERSION).toBe("f01-create-v1");
    expect([...CREATE_CHECKPOINT_IDS]).toEqual(PLAN);
    expect(CREATE_CHECKPOINT_MILESTONES).toEqual({
      "F01-CREATE-CP-01": "INTENT_ANALYZED",
      "F01-CREATE-CP-02": "POLICY_EVALUATED",
      "F01-CREATE-CP-03": "INTENT_RESOLVED",
      "F01-CREATE-CP-04": "CAPABILITY_COVERAGE_RESOLVED",
      "F01-CREATE-CP-05": "BLUEPRINT_COMPOSED",
      "F01-CREATE-CP-06": "BLUEPRINT_VALIDATED"
    });
    expect(Object.isFrozen(CREATE_CHECKPOINT_IDS)).toBe(true);
  });

  test("TEST-F01-PROG-001 completion is milestone-ordered, idempotent and never withdrawn inside one operation", () => {
    const operation = new CreateProgressOperation();
    const history: string[][] = [];
    for (const id of CREATE_CHECKPOINT_IDS.slice(0, 3)) {
      operation.complete(id);
      operation.complete("F01-CREATE-CP-01");
      history.push([...operation.completed()]);
    }
    expect(history).toEqual([PLAN.slice(0, 1), PLAN.slice(0, 2), PLAN.slice(0, 3)]);
    expect(() => operation.complete("F01-CREATE-CP-05")).toThrow(IntentContractError);
    expect(operation.completed()).toEqual(PLAN.slice(0, 3));
    const snapshot = operation.snapshot("READY");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toEqual({
      plan_version: "f01-create-v1",
      mode: "DETERMINATE",
      planned_checkpoint_ids: PLAN,
      completed_checkpoint_ids: PLAN.slice(0, 3),
      lifecycle_state: "READY",
      waiting_for_user: false
    });
  });

  test("TEST-F01-PROG-001 a new operation re-derives only still-valid durable truth and CREATE alone owns the plan", () => {
    const derive = (lifecycle_status: IntentLifecycleStatus, structured: boolean, resolved: boolean) =>
      [...deriveCreateProgress({ lifecycle_status, has_structured_intent: structured, has_resolved_intent: resolved }).completed()];
    expect(derive("RECEIVED", false, false)).toEqual([]);
    expect(derive("ANALYSIS_FAILED", false, false)).toEqual([]);
    expect(derive("NEEDS_CLARIFICATION", true, false)).toEqual(PLAN.slice(0, 2));
    expect(derive("READY_WITH_VISIBLE_ASSUMPTIONS", true, false)).toEqual(PLAN.slice(0, 2));
    expect(derive("READY", true, true)).toEqual(PLAN.slice(0, 3));
    expect(derive("COMPOSITION_FAILED", true, true)).toEqual(PLAN.slice(0, 3));
    expect(derive("VALIDATION_REJECTED", true, true)).toEqual(PLAN.slice(0, 3));
    expect(derive("VALIDATED", true, true)).toEqual(PLAN);
    expect(["CREATE", "REFINE", "REMIX", "CORRECT"].map((kind) => progressApplies(kind as "CREATE"))).toEqual([true, false, false, false]);
  });
});

describe("F01-AC-027 CREATE API responses carry a verifiable progress snapshot without time inflation", () => {
  test("TEST-F01-PROG-003 every CREATE success response returns only plan / completed truth", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = await h.create();
    const createdData = dataOf(created);
    expect(Object.keys(progressOf(created)).sort()).toEqual(SNAPSHOT_KEYS);
    expect(progressOf(created)).toEqual({
      plan_version: "f01-create-v1",
      mode: "DETERMINATE",
      planned_checkpoint_ids: PLAN,
      completed_checkpoint_ids: PLAN.slice(0, 2),
      lifecycle_state: "NEEDS_CLARIFICATION",
      waiting_for_user: true
    });
    const questionId = String((createdData.questions as { question_id: string }[])[0]?.question_id);
    const answered = await h.answers(String(createdData.intent_id), { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: createdData.intent_version });
    expect(progressOf(answered)).toMatchObject({ completed_checkpoint_ids: PLAN.slice(0, 3), lifecycle_state: "READY", waiting_for_user: false });
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const compiled = await h.compile(String(createdData.intent_id), Number(dataOf(answered).intent_version));
    expect(progressOf(compiled)).toMatchObject({ completed_checkpoint_ids: PLAN, lifecycle_state: "VALIDATED", waiting_for_user: false });
  });

  test("TEST-F01-PROG-003 elapsed time never inflates progress; failures and non-CREATE kinds carry no fabricated progress", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
    const created = await h.create();
    h.clock.advance(60 * 60 * 1000);
    const replay = await h.create();
    expect(progressOf(replay)).toEqual(progressOf(created));
    expect(JSON.stringify(progressOf(replay))).not.toMatch(/percent|eta|elapsed|remaining/i);

    const failing = createF01Harness();
    failing.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    const failed = await failing.create();
    expect(errorOf(failed).code).toBe("F01-ERR-006");
    expect(failed.body).not.toHaveProperty("data");
    expect(JSON.stringify(failed.body)).not.toContain("completed_checkpoint_ids");

    const refine = createF01Harness();
    refine.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue));
    const refined = dataOf(await refine.post("/api/v1/intents", { anonymous_id: ANON, intent_kind: "REFINE", raw_intent: "改標題" }, { key: "refine-1" }));
    expect(refined.status).toBe("READY");
    expect(refined).not.toHaveProperty("progress");
  });
});
