import type { RuntimeStatus } from "../../platform/runtime/runtime-evidence.js";
import type { CreationPhase } from "./creation-session.js";

/** F01-DATA-009 CREATE v1 plan; the Server module that owns it is Node-only, so the Browser restates it. */
export const CREATE_PROGRESS_PLAN_VERSION = "f01-create-v1";
export const CREATE_CHECKPOINT_IDS = Object.freeze([
  "F01-CREATE-CP-01",
  "F01-CREATE-CP-02",
  "F01-CREATE-CP-03",
  "F01-CREATE-CP-04",
  "F01-CREATE-CP-05",
  "F01-CREATE-CP-06"
] as const);

export const STAGE_LABELS = ["理解想法", "整理 App", "檢查互動", "準備 App"] as const;

/** F00-UX-025 composite plan: the six F01 CREATE checkpoints plus the F03 APP_READY checkpoint. */
export const COMPOSITE_CHECKPOINT_COUNT = CREATE_CHECKPOINT_IDS.length + 1;

/** Composite checkpoint count at which each stage is done: 理解想法 CP1–3, 整理 App CP4–5, 檢查互動 CP6, 準備 App CP7. */
const STAGE_DONE_AT = [3, 5, 6, 7] as const;

const WAITING_STATES: ReadonlySet<unknown> = new Set(["NEEDS_CLARIFICATION", "READY_WITH_VISIBLE_ASSUMPTIONS"]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

function isPlanPrefix(value: unknown, length?: number): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  const ids = value as readonly unknown[];
  return ids.length === (length ?? ids.length) && ids.length <= CREATE_CHECKPOINT_IDS.length && ids.every((id, index) => id === CREATE_CHECKPOINT_IDS[index]);
}

/**
 * Reads F01-API-005 `progress` and returns how many of the fixed CREATE plan checkpoints F01 has completed. The
 * plan, version and mode must be exactly the locked ones, completions an in-order prefix of the plan, and the
 * waiting flag consistent with the lifecycle; otherwise the snapshot is not reliable and the caller fails closed.
 */
export function readCreateProgress(value: unknown): number | null {
  if (!isRecord(value) || value.plan_version !== CREATE_PROGRESS_PLAN_VERSION || value.mode !== "DETERMINATE") return null;
  if (!isPlanPrefix(value.planned_checkpoint_ids, CREATE_CHECKPOINT_IDS.length) || !isPlanPrefix(value.completed_checkpoint_ids)) return null;
  if (typeof value.lifecycle_state !== "string" || value.waiting_for_user !== WAITING_STATES.has(value.lifecycle_state)) return null;
  return value.completed_checkpoint_ids.length;
}

/** Truthful composite %: floor(completed × 100 / 7), never rounded up, so 100 needs all seven checkpoints. */
export function compositePercent(completed: number): number {
  return Math.floor((completed * 100) / COMPOSITE_CHECKPOINT_COUNT);
}

/** CP-07 is F03 APP_READY: counted only on top of all six F01 checkpoints and only when F03 reports READY. */
export function compositeCompleted(f01Completed: number, runtimeStatus: RuntimeStatus | null): number {
  return f01Completed === CREATE_CHECKPOINT_IDS.length && runtimeStatus === "READY" ? COMPOSITE_CHECKPOINT_COUNT : f01Completed;
}

/**
 * S02 / O05 view. `percent` is null when the current progress operation has no reliable F01 snapshot yet (a new
 * create or a User retry), which is O05 INDETERMINATE: Stage + bounded activity, no number and no rail value.
 * `active` is true only while work is actually in flight; waiting for the User or a failure freezes everything.
 */
export type CreateProgressView = {
  readonly completedStages: number;
  readonly currentStage: number | null;
  readonly active: boolean;
  readonly percent: number | null;
};

/** Stage-only fallback when no reliable checkpoints exist: only what a trusted response already confirmed. */
function phaseStages(phase: CreationPhase): number {
  switch (phase.kind) {
    case "BUILDING":
      return 1;
    case "BUILD_VALIDATED":
      return 3;
    case "RECOVERABLE_FAILURE":
    case "INTERRUPTED":
      return phase.step.kind === "COMPILE" ? 1 : 0;
    default:
      return 0;
  }
}

function stagesDone(phase: CreationPhase, completed: number | null, runtime: RuntimeStatus | null): number {
  if (completed !== null) return STAGE_DONE_AT.filter((threshold) => completed >= threshold).length;
  return runtime === "READY" ? STAGE_LABELS.length : phaseStages(phase);
}

/**
 * `checkpoints` is the F01 completed count of the current progress operation; `runtimeStatus` is the F03 Runtime
 * Instance status of the validated App (null until F03 hydration is mounted). F03 truth is ignored before F01
 * VALIDATED, and elapsed time is never an input.
 */
export function createProgressView(phase: CreationPhase, checkpoints: number | null, runtimeStatus: RuntimeStatus | null): CreateProgressView {
  const runtime = phase.kind === "BUILD_VALIDATED" ? runtimeStatus : null;
  const completed = checkpoints === null ? null : compositeCompleted(checkpoints, runtime);
  const completedStages = stagesDone(phase, completed, runtime);
  const preparing = runtime !== null && runtime !== "UNINITIALIZED";
  let currentStage: number | null = completedStages;
  if (completedStages >= STAGE_LABELS.length) currentStage = null;
  else if (phase.kind === "BUILD_VALIDATED") currentStage = preparing ? STAGE_LABELS.length - 1 : null;
  return {
    completedStages,
    currentStage,
    active: phase.kind === "ANALYZING" || phase.kind === "BUILDING" || runtime === "HYDRATING",
    percent: completed === null ? null : compositePercent(completed)
  };
}
