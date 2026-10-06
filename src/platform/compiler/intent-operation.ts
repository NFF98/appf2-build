import { randomUUID } from "node:crypto";

import type { BlueprintAdmissionRepository } from "../blueprint/blueprint-admission.js";
import { resolveCapabilityCoverage, type CoverageResolutionRequest, type CoverageResult } from "../capabilities/coverage.js";
import type { ValidatorRegistry } from "../capabilities/schema/validator-contract.js";
import type { AnonymousIdentityRepository } from "../evidence/evidence-repository.js";
import { evaluateClarificationPolicy } from "../intent/clarification-policy.js";
import { restoreTrustedIntentState } from "../intent/intent-state.js";
import type { JsonRecord } from "../intent/json-value.js";
import { F01EvidenceBuffer, emitF01Evidence, type F01EvidenceOptions } from "./compiler-evidence.js";
import type { AttemptGuard, CompileOutcomeReader, CompilerRunRepository, IntentRecord, IntentRepository } from "./compiler-records.js";
import { deriveCreateProgress, progressApplies, type CreateProgressSnapshot } from "./create-progress.js";
import { INTENT_API_ERRORS, IntentApiError, toIntentApiFailure, type IntentApiErrorCode, type IntentApiFailure } from "./f01-errors.js";
import { claimOperation, type ClaimRequest, type IdempotencyOperationRow, type IdempotencyRepository, type OperationCompletion } from "./idempotency.js";
import type { ModelGateway } from "./model-gateway.js";
import { StaleAttemptError } from "./provider-attempts.js";

export type IntentServiceDependencies = {
  readonly intents: IntentRepository;
  readonly runs: CompilerRunRepository;
  readonly outcomes: CompileOutcomeReader;
  readonly idempotency: IdempotencyRepository;
  readonly identities: AnonymousIdentityRepository;
  readonly admission: BlueprintAdmissionRepository;
  readonly gateway: ModelGateway;
  /** Server-side F07 intake shared by F01 and the F02 admission Evidence it triggers. */
  readonly evidence?: F01EvidenceOptions;
  readonly clock?: () => Date;
  readonly newId?: () => string;
  readonly newTraceId?: () => string;
  readonly coverage?: (request: CoverageResolutionRequest) => CoverageResult;
  readonly validatorRegistry?: ValidatorRegistry;
  /** Diagnostic hook observing every in-request progress snapshot (no streaming transport in Phase 1). */
  readonly progressObserver?: (snapshot: CreateProgressSnapshot) => void;
};

export type ResolvedServiceDependencies = Required<Omit<IntentServiceDependencies, "evidence" | "validatorRegistry" | "progressObserver">> &
  Pick<IntentServiceDependencies, "evidence" | "validatorRegistry" | "progressObserver">;

export function resolveDependencies(dependencies: IntentServiceDependencies): ResolvedServiceDependencies {
  return {
    ...dependencies,
    clock: dependencies.clock ?? (() => new Date()),
    newId: dependencies.newId ?? randomUUID,
    newTraceId: dependencies.newTraceId ?? (() => randomUUID().replaceAll("-", "")),
    coverage: dependencies.coverage ?? ((request) => resolveCapabilityCoverage(request))
  };
}

export type IntentServiceResult =
  | { readonly ok: true; readonly data: JsonRecord }
  | { readonly ok: false; readonly failure: IntentApiFailure };

export type OperationSuccess = {
  readonly data: JsonRecord;
  readonly resultRef: OperationCompletion["result_ref"];
};

export type OperationHandlers = {
  readonly replaySucceeded: (operation: IdempotencyOperationRow) => Promise<JsonRecord>;
  readonly execute: (guard: AttemptGuard, operation: IdempotencyOperationRow, evidence: (buffer: F01EvidenceBuffer) => void) => Promise<OperationSuccess>;
};

const failed = (code: IntentApiErrorCode): IntentServiceResult => ({ ok: false, failure: new IntentApiError(code).failure });

function isApiErrorCode(value: string | null): value is IntentApiErrorCode {
  return value !== null && Object.hasOwn(INTENT_API_ERRORS, value);
}

/** FAILED_TERMINAL replays the same stable code; bounded details are not stored, so they are not replayed. */
function replayTerminal(operation: IdempotencyOperationRow): IntentServiceResult {
  const code = isApiErrorCode(operation.error_code) ? operation.error_code : "F01-ERR-014";
  const httpStatus = operation.http_status === 422 ? 422 : undefined;
  return { ok: false, failure: new IntentApiError(code, { retryable: code === "F01-ERR-004", ...(httpStatus === undefined ? {} : { httpStatus }) }).failure };
}

/** Retryable failures become FAILED_RETRYABLE (same key may re-acquire); everything else is terminal for the key. */
function completionFor(failure: IntentApiFailure, resultRef: OperationCompletion["result_ref"]): OperationCompletion {
  const retryable = failure.retryable && failure.code !== "F01-ERR-004";
  return { status: retryable ? "FAILED_RETRYABLE" : "FAILED_TERMINAL", http_status: failure.http_status, error_code: failure.code, result_ref: resultRef };
}

function reportUnexpected(dependencies: ResolvedServiceDependencies, error: unknown): void {
  try {
    dependencies.evidence?.diagnostics.reportNonBlockingFailure(error);
  } catch {
    // Diagnostics must never change the API outcome.
  }
}

async function flush(dependencies: ResolvedServiceDependencies, buffers: readonly F01EvidenceBuffer[]): Promise<void> {
  await emitF01Evidence(dependencies.evidence, buffers.flatMap((buffer) => buffer.drain()));
}

/**
 * Runs one mutation under its canonical idempotency operation. Domain failures complete the attempt with
 * the right FAILED_* disposition; a superseded attempt never completes; an unexpected infrastructure fault
 * leaves the row IN_PROGRESS so the bounded route lease (not a permanent lock) governs takeover.
 */
export async function runIdempotentOperation(
  dependencies: ResolvedServiceDependencies,
  claim: Omit<ClaimRequest, "now" | "newOperationId">,
  handlers: OperationHandlers
): Promise<IntentServiceResult> {
  const claimed = await claimOperation(dependencies.idempotency, { ...claim, now: dependencies.clock(), newOperationId: dependencies.newId });
  if (claimed.kind === "CONFLICT") return failed("API-IDEMPOTENCY-CONFLICT");
  if (claimed.kind === "IN_PROGRESS") return failed("API-IDEMPOTENCY-IN-PROGRESS");
  if (claimed.kind === "REPLAY_TERMINAL") return replayTerminal(claimed.operation);
  if (claimed.kind === "REPLAY_SUCCEEDED") return { ok: true, data: await handlers.replaySucceeded(claimed.operation) };
  const buffers: F01EvidenceBuffer[] = [];
  const guard = claimed.guard;
  try {
    const success = await handlers.execute(guard, claimed.operation, (buffer) => buffers.push(buffer));
    const committed = await dependencies.idempotency.complete(guard, { status: "SUCCEEDED", http_status: 200, error_code: null, result_ref: success.resultRef });
    await flush(dependencies, buffers);
    return committed ? { ok: true, data: success.data } : failed("API-IDEMPOTENCY-IN-PROGRESS");
  } catch (error: unknown) {
    if (error instanceof StaleAttemptError) return failed("API-IDEMPOTENCY-IN-PROGRESS");
    const failure = toIntentApiFailure(error);
    if (failure === null) {
      reportUnexpected(dependencies, error);
      return failed("F01-ERR-014");
    }
    const resultRef = claimed.operation.result_ref_type === null || claimed.operation.result_ref_id === null
      ? null
      : { type: claimed.operation.result_ref_type, id: claimed.operation.result_ref_id };
    await dependencies.idempotency.complete(guard, completionFor(failure, resultRef));
    await flush(dependencies, buffers);
    return { ok: false, failure };
  }
}

export function requireTransition(outcome: Awaited<ReturnType<IntentRepository["transitionIntent"]>>): number {
  if (outcome.kind === "STALE_ATTEMPT") throw new StaleAttemptError();
  if (outcome.kind === "VERSION_CONFLICT") throw new IntentApiError("F01-ERR-004");
  return outcome.intent_version;
}

/** F01-API-001/002 decision payload, rebuilt only from durable `intent_record` truth. */
export function decisionData(record: IntentRecord, progress: CreateProgressSnapshot | null): JsonRecord {
  if (record.structured_intent === null) throw new IntentApiError("F01-ERR-014");
  const evaluation = evaluateClarificationPolicy(restoreTrustedIntentState(record.structured_intent));
  return {
    intent_id: record.intent_id,
    status: evaluation.decision,
    policy_version: evaluation.policy_version,
    triggered_rule_ids: [...evaluation.triggered_rule_ids],
    questions: structuredClone(evaluation.questions) as unknown as JsonRecord[],
    visible_assumptions: structuredClone(evaluation.visible_assumptions) as unknown as JsonRecord[],
    intent_version: record.intent_version,
    ...(progress === null ? {} : { progress: progress as unknown as JsonRecord })
  };
}

export function durableProgress(record: IntentRecord): CreateProgressSnapshot | null {
  if (!progressApplies(record.intent_kind)) return null;
  return deriveCreateProgress({
    lifecycle_status: record.lifecycle_status,
    has_structured_intent: record.structured_intent !== null,
    has_resolved_intent: record.resolved_intent !== null
  }).snapshot(record.lifecycle_status);
}

export function guardNow(guard: AttemptGuard, dependencies: ResolvedServiceDependencies): AttemptGuard {
  return { ...guard, now: dependencies.clock().toISOString() };
}
