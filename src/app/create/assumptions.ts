import type { AssumptionClassification } from "../../platform/intent/visible-assumptions.js";
import type { EditShape } from "./edit-shape.js";
import type { AssumptionDecisionRequest, AssumptionView, IntentDecision } from "./f01-wire.js";
import type { NodeProblem } from "./json-draft.js";
import { readDraft, type ValueDraft, type ValueProblem } from "./value-draft.js";

/** F00-UX-010 user-facing source labels; the raw provenance enum is never shown. */
export const SOURCE_LABELS: Readonly<Record<AssumptionClassification, string>> = Object.freeze({
  FACT: "已提供",
  DEFAULT: "預設",
  PROPOSAL: "建議",
  UNKNOWN: "尚未決定"
});

/** Local, unsent User choice. It never changes the F01 source label; only a trusted F01 response can. */
export type AssumptionDraft =
  | { readonly decision: "ACCEPT" }
  | { readonly decision: "REJECT" }
  | { readonly decision: "EDIT"; readonly value: ValueDraft };

export type DecidableAssumption = AssumptionView & { readonly shape: EditShape };

/**
 * Accept / Edit / Reject apply only to pending DEFAULT / PROPOSAL (F01-DATA-004). An item that a question of
 * this round targets is resolved by answering that question: F01 rejects deciding and answering the same
 * target in one request, and a risk item may only be resolved by a clarification answer.
 */
export function decidableAssumptions(decision: IntentDecision): readonly DecidableAssumption[] {
  const asked = new Set(decision.questions.map((question) => question.targetId));
  return decision.assumptions.filter(
    (assumption): assumption is DecidableAssumption => assumption.shape !== null && !asked.has(assumption.assumptionId)
  );
}

export type DecisionPlan = {
  readonly decisions: readonly AssumptionDecisionRequest[];
  readonly problems: Readonly<Record<string, ValueProblem>>;
  readonly nodeProblems: Readonly<Record<string, NodeProblem>>;
};

/**
 * Builds F01-API-002 `assumption_decisions[]` from explicit User choices. On 「用這些設定繼續」 every still
 * undecided item is sent as ACCEPT so F01 — not the Shell — performs the accepted-proposal transition.
 * Edited values go out as native JSON exactly as the projected shape types them.
 */
export function planDecisions(
  assumptions: readonly DecidableAssumption[],
  drafts: Readonly<Record<string, AssumptionDraft>>,
  acceptUndecided: boolean
): DecisionPlan {
  const decisions: AssumptionDecisionRequest[] = [];
  const problems: Record<string, ValueProblem> = {};
  const nodeProblems: Record<string, NodeProblem> = {};
  for (const assumption of assumptions) {
    const id = assumption.assumptionId;
    const draft = drafts[id];
    if (draft === undefined) {
      if (acceptUndecided) decisions.push({ assumption_id: id, decision: "ACCEPT" });
      continue;
    }
    if (draft.decision !== "EDIT") {
      decisions.push({ assumption_id: id, decision: draft.decision });
      continue;
    }
    const read = readDraft(assumption.shape, draft.value, "EDIT");
    if (read.ok) {
      decisions.push({ assumption_id: id, decision: "EDIT", edited_value: read.value });
    } else {
      problems[id] = read.problem;
      Object.assign(nodeProblems, read.nodeProblems);
    }
  }
  return { decisions, problems, nodeProblems };
}
