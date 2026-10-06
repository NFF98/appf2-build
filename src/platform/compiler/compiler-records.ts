import type { JsonValue } from "../intent/json-value.js";
import type { ModelOperation } from "./model-gateway.js";

export const INTENT_KINDS = ["CREATE", "REFINE", "REMIX", "CORRECT"] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const INTENT_LIFECYCLE_STATUSES = [
  "RECEIVED",
  "ANALYZING",
  "NEEDS_CLARIFICATION",
  "READY_WITH_VISIBLE_ASSUMPTIONS",
  "READY",
  "COMPOSING",
  "VALIDATING",
  "VALIDATED",
  "ANALYSIS_FAILED",
  "COMPOSITION_FAILED",
  "VALIDATION_REJECTED",
  "INCOMPATIBLE",
  "CANCELLED"
] as const;
export type IntentLifecycleStatus = (typeof INTENT_LIFECYCLE_STATUSES)[number];

/** DATA-MODEL §6.2 durable row; `structured_intent` / `resolved_intent` payload schemas are F01-owned. */
export type IntentRecord = {
  readonly intent_id: string;
  readonly anonymous_id: string;
  readonly intent_kind: IntentKind;
  readonly raw_intent: string | null;
  readonly structured_intent: JsonValue | null;
  readonly resolved_intent: JsonValue | null;
  readonly lifecycle_status: IntentLifecycleStatus;
  readonly intent_version: number;
  readonly source_blueprint_hash: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string | null;
};

/** Write authority of one idempotency attempt (Shared API rule 6): every side effect re-checks it atomically. */
export type AttemptGuard = {
  readonly idempotency_operation_id: string;
  readonly attempt_no: number;
  readonly now: string;
};

export type NewIntentRecord = {
  readonly intent_id: string;
  readonly anonymous_id: string;
  readonly intent_kind: IntentKind;
  readonly raw_intent: string;
  readonly source_blueprint_hash: string | null;
};

export type IntentTransition = {
  readonly intent_id: string;
  readonly expected_version: number;
  readonly lifecycle_status: IntentLifecycleStatus;
  /** `undefined` keeps the stored value; `null` clears it. */
  readonly structured_intent?: JsonValue | null;
  readonly resolved_intent?: JsonValue | null;
  readonly expires_at?: string | null;
};

export type IntentWriteOutcome =
  | { readonly kind: "WRITTEN"; readonly intent_version: number }
  | { readonly kind: "VERSION_CONFLICT" }
  | { readonly kind: "STALE_ATTEMPT" };

export interface IntentRepository {
  /** Atomically binds the operation's INTENT result_ref and inserts the RECEIVED v1 row before provider work. */
  createReceivedIntent(guard: AttemptGuard, record: NewIntentRecord): Promise<"CREATED" | "STALE_ATTEMPT">;
  /** (intent_id, request_anonymous_id)-scoped read: a foreign intent is indistinguishable from a missing one. */
  findScopedIntent(intentId: string, anonymousId: string): Promise<IntentRecord | undefined>;
  /** CAS on intent_version AND current attempt ownership; increments intent_version by exactly one. */
  transitionIntent(guard: AttemptGuard, transition: IntentTransition): Promise<IntentWriteOutcome>;
}

export type CompilerRunStage = ModelOperation;

export type CompilerRunStart = {
  readonly compiler_run_id: string;
  readonly intent_id: string;
  readonly stage: CompilerRunStage;
  readonly prompt_version: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly model_adapter: string;
  readonly started_at: string;
  readonly trace_id: string;
};

export type CompilerRunStatus = "STARTED" | "SUCCEEDED" | "FAILED" | "TIMED_OUT";

export type CompilerRunFinish = {
  readonly compiler_run_id: string;
  readonly status: Exclude<CompilerRunStatus, "STARTED">;
  readonly provider_model: string | null;
  readonly finished_at: string;
  readonly latency_ms: number;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly estimated_cost: number | null;
  readonly failure_code: string | null;
};

/** DATA-MODEL §6.3 row: attempt detail + economics only; never a raw provider response or provider secret. */
export type CompilerRunRecord = CompilerRunStart & Omit<CompilerRunFinish, "status" | "finished_at" | "latency_ms" | "provider_model"> & {
  readonly status: CompilerRunStatus;
  readonly attempt_no: number;
  readonly provider_model: string | null;
  readonly finished_at: string | null;
  readonly latency_ms: number | null;
};

export interface CompilerRunRepository {
  /** attempt_no is assigned server-side as max(attempt_no)+1 per (intent_id, stage). */
  startRun(guard: AttemptGuard, run: CompilerRunStart): Promise<{ readonly attempt_no: number } | "STALE_ATTEMPT">;
  finishRun(run: CompilerRunFinish): Promise<void>;
}

export type ValidationOutcomeRow = {
  readonly validation_run_id: string;
  readonly status: "PASSED" | "REJECTED" | "INCOMPATIBLE";
  readonly error_codes: readonly unknown[];
  readonly created_at: string;
};

export type ValidatedResultRow = {
  readonly validation_run_id: string;
  readonly intent_id: string;
  readonly content_hash: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: string;
};

export interface CompileOutcomeReader {
  /** Validation runs of this intent's compose attempts (via compiler_run), newest first, optionally since a time. */
  listValidationOutcomes(intentId: string, since: string | null): Promise<readonly ValidationOutcomeRow[]>;
  /** Rebuilds a compile success from the admitting validation_run → immutable blueprint_content. */
  readValidatedResult(validationRunId: string): Promise<ValidatedResultRow | undefined>;
}
