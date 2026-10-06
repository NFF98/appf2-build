import { isUuid } from "../evidence/evidence-validator.js";
import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "../intent/clarification-policy.js";
import { IntentContractError, type StructuredIntentEnvelope } from "../intent/intent-contract.js";
import { startIntentClarification, type TrustedIntentState } from "../intent/intent-state.js";
import { isPlainRecord, type JsonRecord, type JsonValue } from "../intent/json-value.js";
import { invalidRequest, rejectUnexpectedFields, requireJsonObjectBody, requireNonEmptyString, requireRecord } from "../intent/request-boundary.js";
import { admitResolvedIntent, isResolvedIntentAdmission } from "../intent/resolved-intent-gate.js";
import { projectResolvedIntent, toDurableStructuredIntent } from "../intent/resolved-intent.js";
import { COMPILER_CATALOG_INTENT_CLASSES } from "../intent/semantic-descriptors.js";
import { REGISTRY_VERSION } from "../capabilities/registry.js";
import { F01EvidenceBuffer } from "./compiler-evidence.js";
import { INTENT_KINDS, type AttemptGuard, type IntentKind, type IntentLifecycleStatus, type IntentRecord } from "./compiler-records.js";
import { IntentApiError } from "./f01-errors.js";
import { INTENT_ROUTE_KEYS, ROUTE_LEASE_MS, requestDigest } from "./idempotency.js";
import {
  decisionData,
  durableProgress,
  guardNow,
  requireTransition,
  runIdempotentOperation,
  type IntentServiceResult,
  type OperationSuccess,
  type ResolvedServiceDependencies
} from "./intent-operation.js";
import { RequestDeadline } from "./model-gateway.js";
import { ANALYSIS_RESPONSE_SCHEMA, ENVELOPE_VERSION, PROMPT_A_VERSION } from "./prompts.js";
import { StaleAttemptError, callProviderWithBoundedRetry, type ProviderCallSuccess } from "./provider-attempts.js";

const BLUEPRINT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export type CreateIntentBody = {
  readonly anonymous_id: string;
  readonly intent_kind: IntentKind;
  readonly raw_intent: string;
  readonly source: { readonly type: string; readonly capsule_id: string | null } | null;
  readonly source_blueprint_hash: string | null;
};

function optionalString(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  return requireNonEmptyString(value, path);
}

function parseSource(value: unknown): CreateIntentBody["source"] {
  if (value === undefined || value === null) return null;
  const record = requireRecord(value, "$.source");
  rejectUnexpectedFields(record, { required: ["type"], optional: ["capsule_id"] }, "$.source");
  return { type: requireNonEmptyString(record.type, "$.source.type"), capsule_id: optionalString(record.capsule_id, "$.source.capsule_id") };
}

function parseSourceBlueprintHash(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const record = requireRecord(value, "$.context");
  rejectUnexpectedFields(record, { required: [], optional: ["source_blueprint_hash"] }, "$.context");
  const hash = optionalString(record.source_blueprint_hash, "$.context.source_blueprint_hash");
  if (hash !== null && !BLUEPRINT_HASH_PATTERN.test(hash)) invalidRequest([{ path: "$.context.source_blueprint_hash", reason: "INVALID_CONTENT_HASH" }]);
  return hash;
}

/** F01-API-001 body boundary: server-owned fields (resolved_intent, status, versions …) are F01-ERR-001. */
export function parseCreateIntentBody(body: unknown): CreateIntentBody {
  const record = requireJsonObjectBody(body);
  rejectUnexpectedFields(record, { required: ["anonymous_id", "intent_kind", "raw_intent"], optional: ["source", "context"] }, "$");
  if (!isUuid(record.anonymous_id)) invalidRequest([{ path: "$.anonymous_id", reason: "INVALID_UUID" }]);
  if (typeof record.intent_kind !== "string" || !(INTENT_KINDS as readonly string[]).includes(record.intent_kind)) {
    invalidRequest([{ path: "$.intent_kind", reason: "INVALID_ENUM" }]);
  }
  const rawIntent = requireNonEmptyString(record.raw_intent, "$.raw_intent");
  if (rawIntent.trim().length === 0) invalidRequest([{ path: "$.raw_intent", reason: "EMPTY_STRING" }]);
  return {
    anonymous_id: record.anonymous_id,
    intent_kind: record.intent_kind as IntentKind,
    raw_intent: rawIntent,
    source: parseSource(record.source),
    source_blueprint_hash: parseSourceBlueprintHash(record.context)
  };
}

export type CreateIntentCommand = {
  readonly body: unknown;
  readonly idempotencyKey: string;
  /** Server-owned trusted request context identity, when the platform provides one. */
  readonly trustedAnonymousId: string | null;
};

/** Pre-decision states a (re-)acquired attempt analyses; any later state is replayed from durable truth. */
const NEEDS_ANALYSIS_STATES: ReadonlySet<IntentLifecycleStatus> = new Set(["RECEIVED", "ANALYZING", "ANALYSIS_FAILED"]);

/** The server stamps its own prompt_version; Prompt A cannot claim provenance metadata. */
function acceptAnalysis(output: JsonValue): TrustedIntentState | null {
  if (!isPlainRecord(output)) return null;
  const metadata = isPlainRecord(output.analysis_metadata) ? output.analysis_metadata : {};
  try {
    return startIntentClarification({ ...output, analysis_metadata: { ...metadata, prompt_version: PROMPT_A_VERSION } });
  } catch (error: unknown) {
    if (error instanceof IntentContractError) return null;
    throw error;
  }
}

function analysisInput(body: CreateIntentBody): JsonRecord {
  return {
    raw_user_intent: body.raw_intent,
    intent_kind: body.intent_kind,
    source: body.source,
    context: { source_blueprint_hash: body.source_blueprint_hash },
    capability_semantic_catalog: [...COMPILER_CATALOG_INTENT_CLASSES].sort(),
    prompt_version: PROMPT_A_VERSION,
    envelope_version: ENVELOPE_VERSION
  };
}

type AnalysisScope = {
  readonly dependencies: ResolvedServiceDependencies;
  readonly guard: AttemptGuard;
  readonly body: CreateIntentBody;
  readonly evidence: F01EvidenceBuffer;
  readonly traceId: string;
};

async function bindIntent(
  dependencies: ResolvedServiceDependencies,
  guard: AttemptGuard,
  body: CreateIntentBody,
  intentId: string | null
): Promise<{ record: IntentRecord; fresh: boolean }> {
  if (intentId !== null) {
    const existing = await dependencies.intents.findScopedIntent(intentId, body.anonymous_id);
    if (existing === undefined) throw new IntentApiError("F01-ERR-014");
    return { record: existing, fresh: false };
  }
  const newIntentId = dependencies.newId();
  const created = await dependencies.intents.createReceivedIntent(guard, {
    intent_id: newIntentId,
    anonymous_id: body.anonymous_id,
    intent_kind: body.intent_kind,
    raw_intent: body.raw_intent,
    source_blueprint_hash: body.source_blueprint_hash
  });
  if (created === "STALE_ATTEMPT") throw new StaleAttemptError();
  const record = await dependencies.intents.findScopedIntent(newIntentId, body.anonymous_id);
  if (record === undefined) throw new IntentApiError("F01-ERR-014");
  return { record, fresh: true };
}

type DecisionTransition = {
  readonly evaluation: ClarificationPolicyEvaluation;
  readonly status: IntentLifecycleStatus;
  readonly structured: StructuredIntentEnvelope;
  readonly resolved: JsonValue | null;
};

/** Shared by analysis and answers: READY persists the gate-issued F01-DATA-005 projection, never a Client value. */
export function decisionTransition(state: TrustedIntentState, intentId: string): DecisionTransition {
  const evaluation = evaluateClarificationPolicy(state);
  const structured = toDurableStructuredIntent(state.envelope);
  if (evaluation.decision !== "READY") return { evaluation, status: evaluation.decision, structured, resolved: null };
  const admission = admitResolvedIntent(state);
  if (!isResolvedIntentAdmission(admission)) throw new IntentApiError("F01-ERR-014");
  const projection = projectResolvedIntent(admission, intentId);
  return { evaluation, status: "READY", structured, resolved: projection.resolved_intent as unknown as JsonValue };
}

function decisionEvidence(scope: AnalysisScope, next: DecisionTransition, analysis: ProviderCallSuccess<TrustedIntentState>): void {
  const evaluation = next.evaluation;
  const policy = { policy_version: evaluation.policy_version };
  scope.evidence.add("F01-EVT-002", {
    ...policy,
    prompt_version: PROMPT_A_VERSION,
    model_adapter: scope.dependencies.gateway.modelAdapter,
    attempt_no: analysis.attemptNo,
    latency_ms: analysis.latencyMs
  });
  if (evaluation.decision === "NEEDS_CLARIFICATION") scope.evidence.add("F01-EVT-003", policy);
  if (evaluation.visible_assumptions.length > 0) scope.evidence.add("F01-EVT-005", policy);
  if (next.status === "READY") scope.evidence.add("F01-EVT-007", policy);
}

async function analyze(scope: AnalysisScope, record: IntentRecord): Promise<IntentRecord> {
  const { dependencies, guard } = scope;
  const analyzingVersion = requireTransition(
    await dependencies.intents.transitionIntent(guardNow(guard, dependencies), { intent_id: record.intent_id, expected_version: record.intent_version, lifecycle_status: "ANALYZING" })
  );
  const deadline = new RequestDeadline(ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.create], () => dependencies.clock().getTime());
  let analysis: ProviderCallSuccess<TrustedIntentState>;
  try {
    analysis = await callProviderWithBoundedRetry(
      { gateway: dependencies.gateway, runs: dependencies.runs, guard, deadline, intentId: record.intent_id, traceId: scope.traceId, registryVersion: REGISTRY_VERSION, now: dependencies.clock, newId: dependencies.newId, evidence: scope.evidence },
      { operation: "INTENT_ANALYSIS", promptVersion: PROMPT_A_VERSION, schemaVersion: ENVELOPE_VERSION, responseSchema: ANALYSIS_RESPONSE_SCHEMA, inputPayload: analysisInput(scope.body), accept: acceptAnalysis, rejectedOutputCode: "F01-ERR-002" }
    );
  } catch (error: unknown) {
    if (error instanceof IntentApiError && !(error instanceof StaleAttemptError)) {
      requireTransition(await dependencies.intents.transitionIntent(guardNow(guard, dependencies), { intent_id: record.intent_id, expected_version: analyzingVersion, lifecycle_status: "ANALYSIS_FAILED" }));
    }
    throw error;
  }
  const next = decisionTransition(analysis.value, record.intent_id);
  const version = requireTransition(
    await dependencies.intents.transitionIntent(guardNow(guard, dependencies), {
      intent_id: record.intent_id,
      expected_version: analyzingVersion,
      lifecycle_status: next.status,
      structured_intent: next.structured as unknown as JsonValue,
      resolved_intent: next.resolved
    })
  );
  const committed: IntentRecord = { ...record, lifecycle_status: next.status, structured_intent: next.structured as unknown as JsonValue, resolved_intent: next.resolved, intent_version: version };
  decisionEvidence(scope, next, analysis);
  return committed;
}

function success(dependencies: ResolvedServiceDependencies, record: IntentRecord): OperationSuccess {
  const progress = durableProgress(record);
  if (progress !== null) dependencies.progressObserver?.(progress);
  return { data: decisionData(record, progress), resultRef: { type: "INTENT", id: record.intent_id } };
}

/**
 * F01-API-001: the logical operation is bound to exactly one intent_record before any provider work; a retry
 * (FAILED_RETRYABLE / lease takeover) reuses that intent_id, re-entering ANALYZING only from a pre-decision state.
 */
export async function createIntent(dependencies: ResolvedServiceDependencies, command: CreateIntentCommand): Promise<IntentServiceResult> {
  const body = parseCreateIntentBody(command.body);
  if (command.trustedAnonymousId !== null && command.trustedAnonymousId !== body.anonymous_id) {
    invalidRequest([{ path: "$.anonymous_id", reason: "ANONYMOUS_CONTINUITY_MISMATCH" }]);
  }
  const identity = await dependencies.identities.ensure(body.anonymous_id, dependencies.clock().toISOString());
  if (identity !== "ACTIVE") invalidRequest([{ path: "$.anonymous_id", reason: "ANONYMOUS_IDENTITY_UNAVAILABLE" }]);
  return runIdempotentOperation(
    dependencies,
    {
      anonymous_id: body.anonymous_id,
      route_key: INTENT_ROUTE_KEYS.create,
      idempotency_key: command.idempotencyKey,
      request_digest: requestDigest(INTENT_ROUTE_KEYS.create, null, command.body as JsonValue)
    },
    {
      replaySucceeded: async (operation) => {
        const record = operation.result_ref_id === null ? undefined : await dependencies.intents.findScopedIntent(operation.result_ref_id, body.anonymous_id);
        if (record === undefined) throw new IntentApiError("F01-ERR-014");
        return success(dependencies, record).data;
      },
      execute: async (guard, operation, collect) => {
        const bound = await bindIntent(dependencies, guard, body, operation.result_ref_id);
        const traceId = dependencies.newTraceId();
        const evidence = new F01EvidenceBuffer({ intent_id: bound.record.intent_id, trace_id: traceId, intent_kind: body.intent_kind });
        collect(evidence);
        if (bound.fresh) evidence.add("F01-EVT-001");
        const record = NEEDS_ANALYSIS_STATES.has(bound.record.lifecycle_status)
          ? await analyze({ dependencies, guard, body, evidence, traceId }, bound.record)
          : bound.record;
        return success(dependencies, record);
      }
    }
  );
}
