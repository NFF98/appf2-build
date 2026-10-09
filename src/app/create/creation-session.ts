import type { JsonValue } from "../../platform/intent/json-value.js";
import type { AssumptionDraft } from "./assumptions.js";
import { sameShape } from "./edit-shape.js";
import type { AnswerSubmissionRequest, CompileRequest, CreateIntentRequest, IntentDecision } from "./f01-wire.js";
import type { NodeProblem } from "./json-draft.js";
import type { ValueDraft, ValueProblem } from "./value-draft.js";

/** F01-API-001 body minus `anonymous_id`, which is read from F07 browser identity at send time. */
export type CreateIntentDraft = Omit<CreateIntentRequest, "anonymous_id">;

/** One F01 request the Shell may need to repeat verbatim (same payload → same Idempotency-Key). */
export type CreationStep =
  | { readonly kind: "CREATE"; readonly body: CreateIntentDraft }
  | { readonly kind: "ANSWERS"; readonly intentId: string; readonly body: AnswerSubmissionRequest; readonly decision: IntentDecision }
  | { readonly kind: "COMPILE"; readonly intentId: string; readonly body: CompileRequest };

/**
 * Why a request did not complete, which decides the honest recovery actions (F12):
 * RETRYABLE — the identical request may succeed (same Idempotency-Key);
 * STALE_VERSION — F01-ERR-004, a replay would surely fail, so the Intent must be re-analysed;
 * MALFORMED — the response broke the F01 contract and nothing from it is shown or applied;
 * NOT_FOUND — the Intent is gone; REJECTED — any other non-retryable F01 outcome.
 */
export type RecoveryReason = "RETRYABLE" | "STALE_VERSION" | "MALFORMED" | "NOT_FOUND" | "REJECTED";

/**
 * F00-STATE-002 Creation states rendered by S02. BUILD_VALIDATED is the F01 VALIDATED boundary: HYDRATING /
 * APP_READY belong to F03 and are not entered here. INTERRUPTED means the User left while waiting; the
 * logical operation stays open so an identical resubmission replays it instead of duplicating it.
 */
export type CreationPhase =
  | { readonly kind: "ANALYZING" }
  | { readonly kind: "CLARIFICATION_REQUIRED" }
  | { readonly kind: "ASSUMPTION_REVIEW" }
  | { readonly kind: "BUILDING" }
  | { readonly kind: "BUILD_VALIDATED"; readonly contentHash: string }
  | { readonly kind: "RECOVERABLE_FAILURE"; readonly step: CreationStep; readonly reason: RecoveryReason }
  | { readonly kind: "INTERRUPTED"; readonly step: CreationStep };

export type ProvidedAnswer = { readonly key: string; readonly label: string; readonly value: JsonValue };

export type FieldProblem = ValueProblem | "SERVER_REJECTED";

export type CreationSession = {
  readonly rawIntent: string;
  /** Local origin marker only (F00-DATA-001 `source_capsule_id`); never sent to F01 as a User fact. */
  readonly capsuleId: string | null;
  readonly phase: CreationPhase;
  /** Latest trusted F01 decision for the current round; questions / assumptions render only from here. */
  readonly decision: IntentDecision | null;
  readonly answerDrafts: Readonly<Record<string, ValueDraft>>;
  readonly assumptionDrafts: Readonly<Record<string, AssumptionDraft>>;
  readonly provided: readonly ProvidedAnswer[];
  /** Keyed by question / assumption id. */
  readonly problems: Readonly<Record<string, FieldProblem>>;
  /** Keyed by RECORD field / value node id. */
  readonly nodeProblems: Readonly<Record<string, NodeProblem>>;
  readonly busy: boolean;
};

export function newSession(rawIntent: string, capsuleId: string | null): CreationSession {
  return {
    rawIntent,
    capsuleId,
    phase: { kind: "ANALYZING" },
    decision: null,
    answerDrafts: {},
    assumptionDrafts: {},
    provided: [],
    problems: {},
    nodeProblems: {},
    busy: false
  };
}

/** Answers carried by an ANSWERS request, labelled by the question they answered. */
export function stepAnswers(step: CreationStep): readonly ProvidedAnswer[] {
  if (step.kind !== "ANSWERS") return [];
  const prompts = new Map(step.decision.questions.map((question) => [question.questionId, question.prompt]));
  return step.body.answers.map((answer) => ({ key: answer.question_id, label: prompts.get(answer.question_id) ?? "", value: answer.value }));
}

/**
 * Unsent drafts stay only where the new trusted round still asks the same thing with the same shape, so a
 * re-analysis keeps compatible User input and a stale draft can never target a changed item.
 */
export function compatibleDrafts(session: CreationSession, decision: IntentDecision): Pick<CreationSession, "answerDrafts" | "assumptionDrafts"> {
  const answerDrafts: Record<string, ValueDraft> = {};
  const previousQuestions = new Map(session.decision?.questions.map((question) => [question.questionId, question.shape]));
  for (const question of decision.questions) {
    const draft = session.answerDrafts[question.questionId];
    const previous = previousQuestions.get(question.questionId);
    if (draft !== undefined && previous !== undefined && sameShape(previous, question.shape)) answerDrafts[question.questionId] = draft;
  }
  const assumptionDrafts: Record<string, AssumptionDraft> = {};
  const previousAssumptions = new Map(session.decision?.assumptions.map((assumption) => [assumption.assumptionId, assumption.shape]));
  for (const assumption of decision.assumptions) {
    const draft = session.assumptionDrafts[assumption.assumptionId];
    const previous = previousAssumptions.get(assumption.assumptionId) ?? null;
    if (draft !== undefined && assumption.shape !== null && previous !== null && sameShape(previous, assumption.shape)) {
      assumptionDrafts[assumption.assumptionId] = draft;
    }
  }
  return { answerDrafts, assumptionDrafts };
}

export const STAGE_LABELS = ["理解想法", "整理 App", "檢查互動", "準備 App"] as const;

/**
 * Stage-only presentation (O05 INDETERMINATE mode): `completed` counts stages whose F01 checkpoints are
 * confirmed by a response (VALIDATED → stages 1–3); `active` only while a request is actually in flight.
 * Waiting for the User or a failure shows no activity, and no percentage is ever derived here.
 */
export type StageView = { readonly completed: number; readonly current: number | null; readonly active: boolean };

export function stageView(phase: CreationPhase): StageView {
  switch (phase.kind) {
    case "ANALYZING":
      return { completed: 0, current: 0, active: true };
    case "CLARIFICATION_REQUIRED":
    case "ASSUMPTION_REVIEW":
      return { completed: 0, current: 0, active: false };
    case "BUILDING":
      return { completed: 1, current: 1, active: true };
    case "BUILD_VALIDATED":
      return { completed: 3, current: null, active: false };
    case "RECOVERABLE_FAILURE":
    case "INTERRUPTED":
      return phase.step.kind === "COMPILE" ? { completed: 1, current: 1, active: false } : { completed: 0, current: 0, active: false };
  }
}
