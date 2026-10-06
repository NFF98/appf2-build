import { internalInvariant } from "../intent/intent-contract.js";
import type { IntentKind, IntentLifecycleStatus } from "./compiler-records.js";

export const CREATE_PROGRESS_PLAN_VERSION = "f01-create-v1";

/** F01-DATA-009 fixed, finite, ordered CREATE v1 plan; clarification rounds never change it. */
export const CREATE_CHECKPOINT_IDS = Object.freeze([
  "F01-CREATE-CP-01",
  "F01-CREATE-CP-02",
  "F01-CREATE-CP-03",
  "F01-CREATE-CP-04",
  "F01-CREATE-CP-05",
  "F01-CREATE-CP-06"
] as const);
export type CreateCheckpointId = (typeof CREATE_CHECKPOINT_IDS)[number];

export const CREATE_CHECKPOINT_MILESTONES: Readonly<Record<CreateCheckpointId, string>> = Object.freeze({
  "F01-CREATE-CP-01": "INTENT_ANALYZED",
  "F01-CREATE-CP-02": "POLICY_EVALUATED",
  "F01-CREATE-CP-03": "INTENT_RESOLVED",
  "F01-CREATE-CP-04": "CAPABILITY_COVERAGE_RESOLVED",
  "F01-CREATE-CP-05": "BLUEPRINT_COMPOSED",
  "F01-CREATE-CP-06": "BLUEPRINT_VALIDATED"
});

export type CreateProgressSnapshot = {
  readonly plan_version: typeof CREATE_PROGRESS_PLAN_VERSION;
  readonly mode: "DETERMINATE";
  readonly planned_checkpoint_ids: readonly CreateCheckpointId[];
  readonly completed_checkpoint_ids: readonly CreateCheckpointId[];
  readonly lifecycle_state: IntentLifecycleStatus;
  readonly waiting_for_user: boolean;
};

const WAITING_STATES: ReadonlySet<IntentLifecycleStatus> = new Set(["NEEDS_CLARIFICATION", "READY_WITH_VISIBLE_ASSUMPTIONS"]);

/**
 * One logical progress operation. Completion is milestone-only (never time / latency driven), strictly in
 * plan order, and monotonic: a checkpoint, once completed, is never withdrawn inside the same operation.
 */
export class CreateProgressOperation {
  private completedCount = 0;

  public constructor(initiallyCompleted: readonly CreateCheckpointId[] = []) {
    for (const id of initiallyCompleted) this.complete(id);
  }

  public complete(id: CreateCheckpointId): void {
    const index = CREATE_CHECKPOINT_IDS.indexOf(id);
    if (index < this.completedCount) return;
    if (index !== this.completedCount) internalInvariant("PROGRESS_CHECKPOINT_OUT_OF_ORDER", `$.progress.${id}`);
    this.completedCount = index + 1;
  }

  public completed(): readonly CreateCheckpointId[] {
    return CREATE_CHECKPOINT_IDS.slice(0, this.completedCount);
  }

  public snapshot(lifecycleState: IntentLifecycleStatus): CreateProgressSnapshot {
    return Object.freeze({
      plan_version: CREATE_PROGRESS_PLAN_VERSION,
      mode: "DETERMINATE",
      planned_checkpoint_ids: CREATE_CHECKPOINT_IDS,
      completed_checkpoint_ids: Object.freeze([...this.completed()]),
      lifecycle_state: lifecycleState,
      waiting_for_user: WAITING_STATES.has(lifecycleState)
    });
  }
}

const POLICY_EVALUATED_STATES: ReadonlySet<IntentLifecycleStatus> = new Set([
  "NEEDS_CLARIFICATION",
  "READY_WITH_VISIBLE_ASSUMPTIONS",
  "READY",
  "COMPOSING",
  "VALIDATING",
  "VALIDATED",
  "COMPOSITION_FAILED",
  "VALIDATION_REJECTED",
  "INCOMPATIBLE"
]);

export type DurableProgressTruth = {
  readonly lifecycle_status: IntentLifecycleStatus;
  readonly has_structured_intent: boolean;
  readonly has_resolved_intent: boolean;
};

/**
 * F01-RQ-010: a new progress operation is re-derived from still-valid durable truth only (Envelope analysed and
 * policy evaluated → CP-01/02; persisted READY Resolved Intent → CP-03; VALIDATED → all six). Compile-scoped
 * milestones CP-04/05 are request truth and are never copied from a previous failed operation.
 */
export function deriveCreateProgress(truth: DurableProgressTruth): CreateProgressOperation {
  const operation = new CreateProgressOperation();
  if (!truth.has_structured_intent || !POLICY_EVALUATED_STATES.has(truth.lifecycle_status)) return operation;
  operation.complete("F01-CREATE-CP-01");
  operation.complete("F01-CREATE-CP-02");
  if (!truth.has_resolved_intent) return operation;
  operation.complete("F01-CREATE-CP-03");
  if (truth.lifecycle_status === "VALIDATED") {
    for (const id of CREATE_CHECKPOINT_IDS.slice(3)) operation.complete(id);
  }
  return operation;
}

/** F01-API-005 is mandated for CREATE only; other intent kinds own their progress semantics elsewhere. */
export function progressApplies(kind: IntentKind): boolean {
  return kind === "CREATE";
}
