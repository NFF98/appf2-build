import { parseAnswerSubmission, submitClarificationAnswers } from "../intent/answer-merge.js";
import { restoreTrustedIntentState } from "../intent/intent-state.js";
import type { JsonValue } from "../intent/json-value.js";
import { F01EvidenceBuffer } from "./compiler-evidence.js";
import type { IntentLifecycleStatus, IntentRecord } from "./compiler-records.js";
import { decisionTransition } from "./create-intent.js";
import { IntentApiError } from "./f01-errors.js";
import { INTENT_ROUTE_KEYS, requestDigest } from "./idempotency.js";
import {
  decisionData,
  durableProgress,
  guardNow,
  requireTransition,
  runIdempotentOperation,
  type IntentServiceResult,
  type ResolvedServiceDependencies
} from "./intent-operation.js";
import { requireScopedIntent, type ScopedIntentCommand } from "./scoped-intent.js";

/** Answers merge User truth only before compilation starts; later lifecycle states are semantically closed. */
const ANSWERABLE_STATES: ReadonlySet<IntentLifecycleStatus> = new Set(["NEEDS_CLARIFICATION", "READY_WITH_VISIBLE_ASSUMPTIONS", "READY"]);

function answersData(dependencies: ResolvedServiceDependencies, record: IntentRecord) {
  const progress = durableProgress(record);
  if (progress !== null) dependencies.progressObserver?.(progress);
  return decisionData(record, progress);
}

/**
 * F01-API-002: optimistic intent_version + attempt-guarded CAS; trusted answer merge (stale-proposal
 * invalidation first) then a fresh deterministic policy run. READY persists the gate-issued Resolved Intent.
 */
export async function submitAnswers(dependencies: ResolvedServiceDependencies, command: ScopedIntentCommand): Promise<IntentServiceResult> {
  const submission = parseAnswerSubmission(command.body);
  const scoped = await requireScopedIntent(dependencies, command);
  return runIdempotentOperation(
    dependencies,
    {
      anonymous_id: scoped.anonymousId,
      route_key: INTENT_ROUTE_KEYS.answers,
      idempotency_key: command.idempotencyKey,
      request_digest: requestDigest(INTENT_ROUTE_KEYS.answers, command.intentId, command.body as JsonValue)
    },
    {
      replaySucceeded: async () => answersData(dependencies, await scoped.reload()),
      execute: async (guard, _operation, collect) => {
        const record = await scoped.reload();
        if (record.intent_version !== submission.intent_version) throw new IntentApiError("F01-ERR-004");
        if (!ANSWERABLE_STATES.has(record.lifecycle_status) || record.structured_intent === null) {
          throw new IntentApiError("F01-ERR-001", { details: { reason: "INTENT_NOT_ANSWERABLE" } });
        }
        const merged = submitClarificationAnswers(restoreTrustedIntentState(record.structured_intent), command.body);
        const next = decisionTransition(merged.state, record.intent_id);
        const version = requireTransition(
          await dependencies.intents.transitionIntent(guardNow(guard, dependencies), {
            intent_id: record.intent_id,
            expected_version: record.intent_version,
            lifecycle_status: next.status,
            structured_intent: next.structured as unknown as JsonValue,
            resolved_intent: next.resolved
          })
        );
        const evidence = new F01EvidenceBuffer({ intent_id: record.intent_id, trace_id: dependencies.newTraceId(), intent_kind: record.intent_kind });
        collect(evidence);
        const policy = { policy_version: next.evaluation.policy_version };
        evidence.add("F01-EVT-004", policy);
        if (submission.assumption_decisions.some((decision) => decision.decision === "ACCEPT")) evidence.add("F01-EVT-006", policy);
        if (next.status === "NEEDS_CLARIFICATION") evidence.add("F01-EVT-003", policy);
        if (next.evaluation.visible_assumptions.length > 0) evidence.add("F01-EVT-005", policy);
        if (next.status === "READY") evidence.add("F01-EVT-007", policy);
        const committed: IntentRecord = {
          ...record,
          lifecycle_status: next.status,
          structured_intent: next.structured as unknown as JsonValue,
          resolved_intent: next.resolved,
          intent_version: version
        };
        return { data: answersData(dependencies, committed), resultRef: { type: "INTENT", id: record.intent_id } };
      }
    }
  );
}
