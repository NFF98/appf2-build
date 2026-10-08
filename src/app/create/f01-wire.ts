import type { JsonValue } from "../../platform/intent/json-value.js";
import type { ClarificationQuestion } from "../../platform/intent/question-projection.js";
import type { VisibleAssumption } from "../../platform/intent/visible-assumptions.js";

export type ClarificationQuestionView = ClarificationQuestion;
export type VisibleAssumptionView = VisibleAssumption;

/** F01-RQ-002 per-round ceiling; the Server module that owns it is Node-only, so the Browser restates the bound. */
const MAX_QUESTIONS_PER_ROUND = 3;

/** F01-API-001/002 decision statuses; anything else is a contract violation, never guessed. */
export const DECISION_STATUSES = ["NEEDS_CLARIFICATION", "READY_WITH_VISIBLE_ASSUMPTIONS", "READY"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type IntentDecision = {
  readonly intentId: string;
  readonly status: DecisionStatus;
  readonly intentVersion: number;
  readonly questions: readonly ClarificationQuestionView[];
  readonly visibleAssumptions: readonly VisibleAssumptionView[];
};

export type CompileOutcome = {
  readonly intentId: string;
  readonly contentHash: string;
};

export type F01Failure =
  | {
      readonly kind: "API";
      readonly code: string;
      readonly retryable: boolean;
      readonly httpStatus: number;
      readonly violations: readonly { readonly path: string; readonly reason: string }[];
    }
  | { readonly kind: "NETWORK" }
  | { readonly kind: "IDENTITY_UNAVAILABLE" }
  | { readonly kind: "ABORTED" }
  | { readonly kind: "MALFORMED_RESPONSE" };

export type F01Result<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: F01Failure };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

function readQuestions(value: unknown): ClarificationQuestionView[] | null {
  if (!Array.isArray(value) || value.length > MAX_QUESTIONS_PER_ROUND) return null;
  const questions: ClarificationQuestionView[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.question_id !== "string" || typeof entry.prompt !== "string") return null;
    if (typeof entry.question_type !== "string" || typeof entry.expected_value_type !== "string") return null;
    questions.push(entry as unknown as ClarificationQuestionView);
  }
  return questions;
}

function readAssumptions(value: unknown): VisibleAssumptionView[] | null {
  if (!Array.isArray(value)) return null;
  const assumptions: VisibleAssumptionView[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.assumption_id !== "string" || typeof entry.classification !== "string") return null;
    if (typeof entry.description !== "string") return null;
    assumptions.push(entry as unknown as VisibleAssumptionView);
  }
  return assumptions;
}

/**
 * Reads the F01 decision payload exactly as returned. A round with more than the locked 1–3 questions, an
 * unknown status or a missing identity is a malformed response: the Shell never trims or repairs F01 truth.
 */
export function readDecision(data: unknown): IntentDecision | null {
  if (!isRecord(data) || typeof data.intent_id !== "string" || !isPositiveInteger(data.intent_version)) return null;
  const status = (DECISION_STATUSES as readonly unknown[]).includes(data.status) ? (data.status as DecisionStatus) : null;
  const questions = readQuestions(data.questions);
  const visibleAssumptions = readAssumptions(data.visible_assumptions);
  if (status === null || questions === null || visibleAssumptions === null) return null;
  if (status === "NEEDS_CLARIFICATION" && questions.length === 0) return null;
  return { intentId: data.intent_id, status, intentVersion: data.intent_version, questions, visibleAssumptions };
}

export function readCompileOutcome(data: unknown): CompileOutcome | null {
  if (!isRecord(data) || typeof data.intent_id !== "string" || data.status !== "VALIDATED" || typeof data.content_hash !== "string") return null;
  return { intentId: data.intent_id, contentHash: data.content_hash };
}

function readViolations(details: unknown): { path: string; reason: string }[] {
  const violations = isRecord(details) ? details.violations : undefined;
  if (!Array.isArray(violations)) return [];
  return violations.filter(
    (entry): entry is { path: string; reason: string } => isRecord(entry) && typeof entry.path === "string" && typeof entry.reason === "string"
  );
}

/** Shared API §6 stable error envelope → bounded failure; message text and stacks are never surfaced. */
export function readFailure(httpStatus: number, body: unknown): F01Failure {
  const error = isRecord(body) ? body.error : undefined;
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.retryable !== "boolean") return { kind: "MALFORMED_RESPONSE" };
  return { kind: "API", code: error.code, retryable: error.retryable, httpStatus, violations: readViolations(error.details) };
}

export type CreateIntentRequest = {
  readonly anonymous_id: string;
  readonly intent_kind: "CREATE";
  readonly raw_intent: string;
  readonly source?: { readonly type: "DIRECT_PROMPT"; readonly capsule_id: null };
};

export type AnswerSubmissionRequest = {
  readonly answers: readonly { readonly question_id: string; readonly value: JsonValue }[];
  readonly assumption_decisions: readonly AssumptionDecisionRequest[];
  readonly intent_version: number;
};

export type AssumptionDecisionRequest =
  | { readonly assumption_id: string; readonly decision: "ACCEPT" | "REJECT" }
  | { readonly assumption_id: string; readonly decision: "EDIT"; readonly edited_value: JsonValue };

export type CompileRequest = { readonly intent_version: number };
