import type { JsonRecord, JsonValue } from "../intent/json-value.js";
import type { F01EvidenceBuffer } from "./compiler-evidence.js";
import type { AttemptGuard, CompilerRunRepository, CompilerRunStatus } from "./compiler-records.js";
import { IntentApiError, type F01ErrorCode } from "./f01-errors.js";
import {
  DEFAULT_PROVIDER_POLICY,
  MAX_PROVIDER_ATTEMPTS,
  isRetryableFailure,
  type ModelFailure,
  type ModelGateway,
  type ModelGatewayResponse,
  type ModelOperation,
  type RequestDeadline
} from "./model-gateway.js";

/** A superseded idempotency attempt lost write authority; the caller must stop without completing the operation. */
export class StaleAttemptError extends IntentApiError {
  public constructor() {
    super("API-IDEMPOTENCY-IN-PROGRESS");
    this.name = "StaleAttemptError";
  }
}

export type ProviderCallContext = {
  readonly gateway: ModelGateway;
  readonly runs: CompilerRunRepository;
  readonly guard: AttemptGuard;
  readonly deadline: RequestDeadline;
  readonly intentId: string;
  readonly traceId: string;
  readonly registryVersion: string;
  readonly now: () => Date;
  readonly newId: () => string;
  readonly evidence: F01EvidenceBuffer;
};

export type ProviderCallSpec<T> = {
  readonly operation: ModelOperation;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly responseSchema: JsonRecord;
  readonly inputPayload: JsonRecord;
  /** Deterministic acceptance of untrusted output; `null` counts as invalid structured output (retry once). */
  readonly accept: (output: JsonValue) => T | null;
  /** F01 code for output that parsed as JSON but failed `accept` after the attempt budget. */
  readonly rejectedOutputCode: F01ErrorCode;
};

export type ProviderCallSuccess<T> = {
  readonly value: T;
  readonly compilerRunId: string;
  readonly attemptNo: number;
  readonly latencyMs: number;
};

type AttemptOutcome<T> =
  | { readonly ok: true; readonly success: ProviderCallSuccess<T> }
  | { readonly ok: false; readonly failure: ModelFailure; readonly code: F01ErrorCode };

function failureCode(failure: ModelFailure, rejectedOutputCode: F01ErrorCode | null): F01ErrorCode {
  switch (failure.kind) {
    case "TIMEOUT":
      return "F01-ERR-009";
    case "RATE_LIMITED":
      return "F01-ERR-005";
    case "INVALID_OUTPUT":
      return rejectedOutputCode ?? "F01-ERR-007";
    default:
      return "F01-ERR-006";
  }
}

function runStatus(outcome: AttemptOutcome<unknown>): Exclude<CompilerRunStatus, "STARTED"> {
  if (outcome.ok) return "SUCCEEDED";
  return outcome.failure.kind === "TIMEOUT" ? "TIMED_OUT" : "FAILED";
}

async function invoke(context: ProviderCallContext, spec: ProviderCallSpec<unknown>, timeoutMs: number): Promise<ModelGatewayResponse> {
  const request = {
    operation: spec.operation,
    prompt_version: spec.promptVersion,
    response_schema: spec.responseSchema,
    input_payload: spec.inputPayload,
    timeout_ms: timeoutMs,
    trace_id: context.traceId,
    provider_policy: DEFAULT_PROVIDER_POLICY
  };
  try {
    return spec.operation === "INTENT_ANALYSIS" ? await context.gateway.analyzeIntent(request) : await context.gateway.composeBlueprint(request);
  } catch {
    return { status: "FAILED", provider_metadata: { model_adapter: context.gateway.modelAdapter, provider_model: null }, latency_ms: 0, failure: { kind: "NETWORK" } };
  }
}

function interpret<T>(response: ModelGatewayResponse, spec: ProviderCallSpec<T>): { value: T } | { failure: ModelFailure; rejected: boolean } {
  if (response.status !== "SUCCEEDED" || response.structured_output === undefined) {
    return { failure: response.failure ?? { kind: "INVALID_OUTPUT" }, rejected: false };
  }
  const value = spec.accept(response.structured_output);
  return value === null ? { failure: { kind: "INVALID_OUTPUT" }, rejected: true } : { value };
}

async function attempt<T>(context: ProviderCallContext, spec: ProviderCallSpec<T>): Promise<AttemptOutcome<T>> {
  const compilerRunId = context.newId();
  const started = await context.runs.startRun(context.guard, {
    compiler_run_id: compilerRunId,
    intent_id: context.intentId,
    stage: spec.operation,
    prompt_version: spec.promptVersion,
    schema_version: spec.schemaVersion,
    registry_version: context.registryVersion,
    model_adapter: context.gateway.modelAdapter,
    started_at: context.now().toISOString(),
    trace_id: context.traceId
  });
  if (started === "STALE_ATTEMPT") throw new StaleAttemptError();
  const timeoutMs = context.deadline.attemptTimeoutMs(spec.operation);
  const response: ModelGatewayResponse = timeoutMs > 0
    ? await invoke(context, spec as ProviderCallSpec<unknown>, timeoutMs)
    : { status: "FAILED", provider_metadata: { model_adapter: context.gateway.modelAdapter, provider_model: null }, latency_ms: 0, failure: { kind: "TIMEOUT" } };
  const interpreted = interpret(response, spec);
  const latencyMs = Math.max(0, Math.round(response.latency_ms));
  const outcome: AttemptOutcome<T> = "value" in interpreted
    ? { ok: true, success: { value: interpreted.value, compilerRunId, attemptNo: started.attempt_no, latencyMs } }
    : { ok: false, failure: interpreted.failure, code: failureCode(interpreted.failure, interpreted.rejected ? spec.rejectedOutputCode : null) };
  await context.runs.finishRun({
    compiler_run_id: compilerRunId,
    status: runStatus(outcome),
    provider_model: response.provider_metadata.provider_model,
    finished_at: context.now().toISOString(),
    latency_ms: latencyMs,
    input_tokens: response.token_usage?.input_tokens ?? null,
    output_tokens: response.token_usage?.output_tokens ?? null,
    estimated_cost: response.estimated_cost ?? null,
    failure_code: outcome.ok ? null : outcome.code
  });
  if (!outcome.ok) {
    context.evidence.add("F01-EVT-014", { prompt_version: spec.promptVersion, model_adapter: context.gateway.modelAdapter, attempt_no: started.attempt_no, latency_ms: latencyMs }, outcome.code);
  }
  return outcome;
}

/**
 * F01-POL-007: at most MAX_PROVIDER_ATTEMPTS per operation; retry only network / 429 / 5xx / first invalid
 * structured output, never a timeout or a deterministic provider rejection. Every attempt is its own
 * compiler_run row (tokens / cost / latency) and is clipped to the remaining server route budget.
 */
export async function callProviderWithBoundedRetry<T>(context: ProviderCallContext, spec: ProviderCallSpec<T>): Promise<ProviderCallSuccess<T>> {
  let localAttempt = 1;
  for (;;) {
    const outcome = await attempt(context, spec);
    if (outcome.ok) return outcome.success;
    if (localAttempt >= MAX_PROVIDER_ATTEMPTS || !isRetryableFailure(outcome.failure.kind, localAttempt) || context.deadline.remainingMs() <= 0) {
      throw new IntentApiError(outcome.code, { retryAfterSeconds: outcome.failure.retry_after_seconds ?? null });
    }
    localAttempt += 1;
  }
}
