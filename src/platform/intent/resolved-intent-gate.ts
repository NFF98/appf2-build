import { evaluateClarificationPolicy, type ClarificationPolicyEvaluation } from "./clarification-policy.js";
import { internalInvariant, policyItemsOf, type ClarificationDecision } from "./intent-contract.js";
import { requireTrustedState, type TrustedIntentState } from "./intent-state.js";
import { deepFreeze, isPlainRecord, type JsonRecord } from "./json-value.js";
import type { PolicyRuleId } from "./policy-rules.js";
import { invalidRequest, rejectUnexpectedFields, requireJsonObjectBody, requirePositiveInteger } from "./request-boundary.js";

export type CompileRequest = {
  readonly intent_version: number;
  readonly source_blueprint_hash: string | null;
  readonly client_context: JsonRecord;
};

/**
 * F01-API-003 body boundary (F01-SEC-007): a Client can never submit resolved_intent, a decision or
 * policy state with compile; such bodies are F01-ERR-001 rather than trusted or silently ignored.
 */
export function parseCompileRequest(body: unknown): CompileRequest {
  const record = requireJsonObjectBody(body);
  rejectUnexpectedFields(record, { required: ["intent_version"], optional: ["source_blueprint_hash", "client_context"] }, "$");
  const hash = record.source_blueprint_hash ?? null;
  if (hash !== null && typeof hash !== "string") invalidRequest([{ path: "$.source_blueprint_hash", reason: "INVALID_STRING" }]);
  const context = record.client_context ?? {};
  if (!isPlainRecord(context)) invalidRequest([{ path: "$.client_context", reason: "INVALID_JSON_OBJECT" }]);
  return {
    intent_version: requirePositiveInteger(record.intent_version, "$.intent_version"),
    source_blueprint_hash: hash,
    client_context: context as JsonRecord
  };
}

export type ResolvedIntentGateRejection = {
  readonly admitted: false;
  readonly decision: Exclude<ClarificationDecision, "READY">;
  readonly reason: "CLARIFICATION_REQUIRED" | "MATERIAL_ASSUMPTIONS_PENDING";
  readonly evaluation: ClarificationPolicyEvaluation;
};

export type ResolvedIntentAdmission = {
  readonly admitted: true;
  readonly decision: "READY";
  readonly policy_version: string;
  readonly triggered_rule_ids: readonly PolicyRuleId[];
  /** CP-005: unresolved COSMETIC items may only travel as unresolved_non_material_items. */
  readonly unresolved_non_material_item_ids: readonly string[];
  readonly state: TrustedIntentState;
};

/** Only this gate issues admissions; the Prompt B entry point must check isResolvedIntentAdmission. */
const issuedAdmissions = new WeakSet<ResolvedIntentAdmission>();

/**
 * F01-DATA-005 prohibitions re-checked on admitted truth: every MATERIAL item is CONFIRMED with its
 * canonical resolved_value, so no required unknown, material ambiguity or hidden proposal reaches Prompt B.
 */
function unresolvedNonMaterialIds(state: TrustedIntentState): string[] {
  const ids: string[] = [];
  for (const { item } of policyItemsOf(state.envelope)) {
    if (item.materiality === "COSMETIC") {
      if (item.resolution_state !== "CONFIRMED") ids.push(item.id);
    } else if (item.resolution_state !== "CONFIRMED" || item.resolved_value === undefined) {
      internalInvariant("UNRESOLVED_MATERIAL_TRUTH_AT_GATE", `$.items[${item.id}]`);
    }
  }
  return ids.sort();
}

/**
 * resolved_intent gate (F01 §11): admits only a server-sealed state whose fresh policy evaluation is READY.
 * READY_WITH_VISIBLE_ASSUMPTIONS reaches READY only after every material assumption was decided through
 * the trusted answer merge, so a pending assumption or clarification is always a rejection.
 */
export function admitResolvedIntent(stateInput: TrustedIntentState): ResolvedIntentAdmission | ResolvedIntentGateRejection {
  const state = requireTrustedState(stateInput);
  const evaluation = evaluateClarificationPolicy(state);
  if (evaluation.decision !== "READY") {
    return deepFreeze({
      admitted: false,
      decision: evaluation.decision,
      reason: evaluation.decision === "NEEDS_CLARIFICATION" ? "CLARIFICATION_REQUIRED" : "MATERIAL_ASSUMPTIONS_PENDING",
      evaluation
    });
  }
  const admission: ResolvedIntentAdmission = Object.freeze({
    admitted: true,
    decision: "READY",
    policy_version: evaluation.policy_version,
    triggered_rule_ids: evaluation.triggered_rule_ids,
    unresolved_non_material_item_ids: Object.freeze(unresolvedNonMaterialIds(state)),
    state
  });
  issuedAdmissions.add(admission);
  return admission;
}

export function isResolvedIntentAdmission(value: unknown): value is ResolvedIntentAdmission {
  return typeof value === "object" && value !== null && issuedAdmissions.has(value as ResolvedIntentAdmission);
}
