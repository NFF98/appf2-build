import type { CoverageResult } from "../capabilities/coverage.js";
import { internalInvariant } from "../intent/intent-contract.js";
import { restoreTrustedIntentState } from "../intent/intent-state.js";
import { canonicalJson, isPlainRecord, tryCanonicalJson, type JsonRecord, type JsonValue } from "../intent/json-value.js";
import { admitResolvedIntent, isResolvedIntentAdmission, parseCompileRequest } from "../intent/resolved-intent-gate.js";
import { projectResolvedIntent, type ResolvedIntentProjection } from "../intent/resolved-intent.js";
import type { CapabilityRequirement } from "../intent/capability-requirements.js";
import { F01EvidenceBuffer } from "./compiler-evidence.js";
import type { AttemptGuard, IntentLifecycleStatus, IntentRecord, ValidatedResultRow, ValidationOutcomeRow } from "./compiler-records.js";
import { composeAndValidate, coverageSupport, isCoverageAllowed, RAW_INTENT_RETENTION_MS } from "./compose-validate.js";
import { deriveCreateProgress, progressApplies, type CreateProgressOperation } from "./create-progress.js";
import { IntentApiError } from "./f01-errors.js";
import { INTENT_ROUTE_KEYS, ROUTE_LEASE_MS, requestDigest, type IdempotencyOperationRow } from "./idempotency.js";
import {
  durableProgress,
  guardNow,
  requireTransition,
  runIdempotentOperation,
  type IntentServiceResult,
  type OperationSuccess,
  type ResolvedServiceDependencies
} from "./intent-operation.js";
import { RequestDeadline } from "./model-gateway.js";
import { classifyRejection, isFixableClass } from "./rejection-classification.js";
import { requireScopedIntent, type ScopedIntent, type ScopedIntentCommand } from "./scoped-intent.js";

const RETRY_ENTRY_STATES: ReadonlySet<IntentLifecycleStatus> = new Set(["COMPOSITION_FAILED", "VALIDATION_REJECTED"]);
const IN_FLIGHT_STATES: ReadonlySet<IntentLifecycleStatus> = new Set(["COMPOSING", "VALIDATING"]);

type CompileEntry = "NORMAL" | "RETRY" | "RECOVER_VALIDATED";

/** A FAILED_RETRYABLE / lease-takeover re-acquisition of the same logical compile (not a fresh or TTL-reset row). */
function isReacquired(operation: IdempotencyOperationRow): boolean {
  return Date.parse(operation.updated_at) !== Date.parse(operation.created_at);
}

const notCompilable = (record: IntentRecord): IntentApiError =>
  new IntentApiError("F01-ERR-001", { httpStatus: 422, details: { reason: "INTENT_NOT_COMPILABLE", lifecycle_status: record.lifecycle_status } });

/**
 * Optimistic concurrency: a fresh compile must carry the current intent_version. A re-acquired attempt of the
 * same logical operation keeps its pinned body, so it may trail only the versions its own compile-owned
 * transitions produced (answers are closed once compilation starts, so Resolved Intent cannot have changed).
 */
function assertCompileVersion(record: IntentRecord, bodyVersion: number, reacquired: boolean): void {
  if (bodyVersion === record.intent_version) return;
  const compileOwned = RETRY_ENTRY_STATES.has(record.lifecycle_status) || IN_FLIGHT_STATES.has(record.lifecycle_status) || record.lifecycle_status === "VALIDATED";
  if (reacquired && bodyVersion < record.intent_version && compileOwned) return;
  throw new IntentApiError("F01-ERR-004");
}

/**
 * F02 error codes of one durable outcome. A PASSED run whose admitted content is not VALIDATED (REVOKED /
 * INCOMPATIBLE reuse) is the F02-ERR-016 / F02-ERR-017 rejection; `null` means a genuinely validated outcome.
 */
async function rejectionCodesOf(dependencies: ResolvedServiceDependencies, outcome: ValidationOutcomeRow): Promise<readonly unknown[] | null> {
  if (outcome.status !== "PASSED") return outcome.error_codes;
  const admitted = await dependencies.outcomes.readValidatedResult(outcome.validation_run_id);
  if (admitted?.trust_status === "REVOKED") return ["F02-ERR-016"];
  if (admitted?.trust_status === "INCOMPATIBLE") return ["F02-ERR-017"];
  return null;
}

/** RQ-008A terminal classes stay terminal: no direct same-body retry out of a terminal VALIDATION_REJECTED. */
async function validationRejectedEntry(dependencies: ResolvedServiceDependencies, record: IntentRecord): Promise<CompileEntry> {
  const [latest] = await dependencies.outcomes.listValidationOutcomes(record.intent_id, null);
  const codes = latest === undefined ? null : await rejectionCodesOf(dependencies, latest);
  if (codes === null) internalInvariant("VALIDATION_REJECTED_WITHOUT_REJECTION", "$.lifecycle_status");
  const classified = classifyRejection(codes);
  if (isFixableClass(classified.rejection_class)) return "RETRY";
  if (classified.rejection_class === "RESOURCE_TERMINAL") throw new IntentApiError("F01-ERR-011", { retryable: false, details: { rejection_class: "RESOURCE_TERMINAL" } });
  throw new IntentApiError(classified.error_code === "F02-ERR-015" ? "F01-ERR-014" : "F01-ERR-012");
}

async function compileEntry(dependencies: ResolvedServiceDependencies, record: IntentRecord, reacquired: boolean): Promise<CompileEntry> {
  const status = record.lifecycle_status;
  if (status === "READY") return "NORMAL";
  if (status === "COMPOSITION_FAILED") return "RETRY";
  if (status === "VALIDATION_REJECTED") return validationRejectedEntry(dependencies, record);
  if (reacquired && IN_FLIGHT_STATES.has(status)) return "RETRY";
  if (reacquired && status === "VALIDATED") return "RECOVER_VALIDATED";
  throw notCompilable(record);
}

/** Re-runs the Clarification Gate on durable truth (AC-007) and proves the persisted projection is exact. */
function verifiedResolvedIntent(record: IntentRecord): ResolvedIntentProjection {
  if (record.structured_intent === null || record.resolved_intent === null) throw notCompilable(record);
  const admission = admitResolvedIntent(restoreTrustedIntentState(record.structured_intent));
  if (!isResolvedIntentAdmission(admission)) throw notCompilable(record);
  const projection = projectResolvedIntent(admission, record.intent_id);
  if (tryCanonicalJson(record.resolved_intent) !== canonicalJson(projection.resolved_intent as unknown as JsonValue)) {
    internalInvariant("PERSISTED_RESOLVED_INTENT_DRIFT", "$.resolved_intent");
  }
  return projection;
}

/** The single recompose belongs to the logical operation: a re-acquired attempt inherits a spent budget. */
async function recomposeAvailable(dependencies: ResolvedServiceDependencies, record: IntentRecord, operation: IdempotencyOperationRow, reacquired: boolean): Promise<boolean> {
  if (!reacquired) return true;
  const outcomes = await dependencies.outcomes.listValidationOutcomes(record.intent_id, operation.created_at);
  for (const outcome of outcomes) {
    const codes = await rejectionCodesOf(dependencies, outcome);
    if (codes !== null && isFixableClass(classifyRejection(codes).rejection_class)) return false;
  }
  return true;
}

function requirementsOf(resolvedIntent: JsonValue | null): readonly CapabilityRequirement[] {
  const requirements = isPlainRecord(resolvedIntent) ? resolvedIntent.capability_requirements : undefined;
  if (!Array.isArray(requirements)) internalInvariant("RESOLVED_INTENT_WITHOUT_REQUIREMENTS", "$.resolved_intent.capability_requirements");
  return requirements as readonly CapabilityRequirement[];
}

function compileData(record: IntentRecord, validated: ValidatedResultRow, coverage: CoverageResult, progress: JsonRecord | null): JsonRecord {
  return {
    intent_id: record.intent_id,
    status: "VALIDATED",
    content_hash: validated.content_hash,
    schema_version: validated.schema_version,
    registry_version: validated.registry_version,
    support: coverageSupport(coverage),
    ...(progress === null ? {} : { progress })
  };
}

/** SUCCEEDED replay: admitting validation_run → immutable blueprint_content; never a stored response blob. */
async function validatedData(dependencies: ResolvedServiceDependencies, record: IntentRecord, validationRunId: string | null): Promise<JsonRecord> {
  const validated = validationRunId === null ? undefined : await dependencies.outcomes.readValidatedResult(validationRunId);
  if (validated?.intent_id !== record.intent_id) internalInvariant("COMPILE_RESULT_REF_UNRESOLVABLE", "$.result_ref");
  const coverage = dependencies.coverage({ requirements: requirementsOf(record.resolved_intent) });
  const progress = durableProgress(record);
  return compileData(record, validated, coverage, progress as unknown as JsonRecord | null);
}

async function recoverValidated(dependencies: ResolvedServiceDependencies, record: IntentRecord, operation: IdempotencyOperationRow): Promise<OperationSuccess> {
  const outcomes = await dependencies.outcomes.listValidationOutcomes(record.intent_id, operation.created_at);
  const passed = outcomes.find((outcome) => outcome.status === "PASSED");
  if (passed === undefined) throw notCompilable(record);
  return { data: await validatedData(dependencies, record, passed.validation_run_id), resultRef: { type: "VALIDATION_RUN", id: passed.validation_run_id } };
}

type CompileRun = {
  readonly dependencies: ResolvedServiceDependencies;
  readonly guard: AttemptGuard;
  readonly operation: IdempotencyOperationRow;
  readonly record: IntentRecord;
  readonly reacquired: boolean;
  readonly evidence: F01EvidenceBuffer;
  readonly traceId: string;
};

function observe(run: CompileRun, progress: CreateProgressOperation | null, lifecycle: IntentLifecycleStatus): void {
  if (progress !== null) run.dependencies.progressObserver?.(progress.snapshot(lifecycle));
}

async function compileResolved(run: CompileRun): Promise<OperationSuccess> {
  const { dependencies, guard, record, evidence } = run;
  const projection = verifiedResolvedIntent(record);
  const progress = progressApplies(record.intent_kind) ? deriveCreateProgress({ lifecycle_status: "READY", has_structured_intent: true, has_resolved_intent: true }) : null;
  observe(run, progress, record.lifecycle_status);
  const refreshCoverage = (): CoverageResult => dependencies.coverage({ requirements: projection.resolved_intent.capability_requirements });
  const coverage = refreshCoverage();
  evidence.add("F01-EVT-008", { coverage_status: coverage.status, registry_version: coverage.registryVersion });
  if (!isCoverageAllowed(coverage)) {
    const expires = new Date(dependencies.clock().getTime() + RAW_INTENT_RETENTION_MS).toISOString();
    requireTransition(await dependencies.intents.transitionIntent(guardNow(guard, dependencies), { intent_id: record.intent_id, expected_version: record.intent_version, lifecycle_status: "INCOMPATIBLE", expires_at: expires }));
    throw new IntentApiError("F01-ERR-008", { details: { coverage_status: coverage.status } });
  }
  progress?.complete("F01-CREATE-CP-04");
  const composingVersion = requireTransition(
    await dependencies.intents.transitionIntent(guardNow(guard, dependencies), { intent_id: record.intent_id, expected_version: record.intent_version, lifecycle_status: "COMPOSING" })
  );
  observe(run, progress, "COMPOSING");
  const outcome = await composeAndValidate({
    dependencies,
    guard,
    intentId: record.intent_id,
    traceId: run.traceId,
    evidence,
    deadline: new RequestDeadline(ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.compile], () => dependencies.clock().getTime()),
    progress,
    resolved: projection.resolved_intent,
    ephemeral: projection.ephemeral_context,
    recomposeAvailable: await recomposeAvailable(dependencies, record, run.operation, run.reacquired),
    refreshCoverage
  }, composingVersion, coverage);
  observe(run, progress, "VALIDATED");
  const validated = await dependencies.outcomes.readValidatedResult(outcome.validationRunId);
  if (validated === undefined) internalInvariant("ADMITTED_RESULT_UNREADABLE", "$.validation_run_id");
  const committed: IntentRecord = { ...record, lifecycle_status: "VALIDATED", intent_version: outcome.intentVersion };
  const snapshot = progress === null ? null : (progress.snapshot("VALIDATED") as unknown as JsonRecord);
  return { data: compileData(committed, validated, outcome.coverage, snapshot), resultRef: { type: "VALIDATION_RUN", id: outcome.validationRunId } };
}

type CompileAttempt = {
  readonly scoped: ScopedIntent;
  readonly bodyVersion: number;
  readonly guard: AttemptGuard;
  readonly operation: IdempotencyOperationRow;
  readonly collect: (buffer: F01EvidenceBuffer) => void;
};

async function executeCompile(dependencies: ResolvedServiceDependencies, { scoped, bodyVersion, guard, operation, collect }: CompileAttempt): Promise<OperationSuccess> {
  const record = await scoped.reload();
  const reacquired = isReacquired(operation);
  assertCompileVersion(record, bodyVersion, reacquired);
  const entry = await compileEntry(dependencies, record, reacquired);
  if (entry === "RECOVER_VALIDATED") return recoverValidated(dependencies, record, operation);
  const traceId = dependencies.newTraceId();
  const evidence = new F01EvidenceBuffer({ intent_id: record.intent_id, trace_id: traceId, intent_kind: record.intent_kind });
  collect(evidence);
  return compileResolved({ dependencies, guard, operation, record, reacquired, evidence, traceId });
}

/**
 * F01-API-003: READY (or an RQ-008A-eligible failure, entered directly into COMPOSING without a fake READY)
 * → F04 coverage → bounded Prompt B → mandatory F02 validate/admit; SUCCEEDED replays the same content_hash.
 */
export async function compileIntent(dependencies: ResolvedServiceDependencies, command: ScopedIntentCommand): Promise<IntentServiceResult> {
  const request = parseCompileRequest(command.body);
  const scoped = await requireScopedIntent(dependencies, command);
  return runIdempotentOperation(
    dependencies,
    {
      anonymous_id: scoped.anonymousId,
      route_key: INTENT_ROUTE_KEYS.compile,
      idempotency_key: command.idempotencyKey,
      request_digest: requestDigest(INTENT_ROUTE_KEYS.compile, command.intentId, command.body as JsonValue)
    },
    {
      replaySucceeded: async (operation) => validatedData(dependencies, await scoped.reload(), operation.result_ref_id),
      execute: (guard, operation, collect) => executeCompile(dependencies, { scoped, bodyVersion: request.intent_version, guard, operation, collect })
    }
  );
}
