import { INTENT_SOURCES, type IntentSource } from "../../platform/intent/intent-contract.js";
import { isJsonValue, type JsonValue } from "../../platform/intent/json-value.js";
import { ASSUMPTION_CLASSIFICATIONS, isPendingDecision, type AssumptionClassification } from "../../platform/intent/visible-assumptions.js";
import { readCreateProgress } from "./create-progress.js";
import { readAssumptionShape, readQuestionShape, type EditShape } from "./edit-shape.js";

/** F01-RQ-002 per-round ceiling; the Server module that owns it is Node-only, so the Browser restates the bound. */
const MAX_QUESTIONS_PER_ROUND = 3;

/** F01-API-001/002 decision statuses; anything else is a contract violation, never guessed. */
export const DECISION_STATUSES = ["NEEDS_CLARIFICATION", "READY_WITH_VISIBLE_ASSUMPTIONS", "READY"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export type QuestionView = {
  readonly questionId: string;
  readonly prompt: string;
  /** The single semantic item this question resolves (`semantic_item_ids[0]`). */
  readonly targetId: string;
  readonly shape: EditShape;
};

/**
 * F01-DATA-004 visible assumption. `value` is what F01 presents (FACT `resolved_value`, DEFAULT / PROPOSAL
 * `proposed_default`); `shape` exists only for the pending DEFAULT / PROPOSAL that F01 lets the User decide.
 */
export type AssumptionView = {
  readonly assumptionId: string;
  readonly classification: AssumptionClassification;
  readonly description: string;
  readonly value: JsonValue | undefined;
  readonly shape: EditShape | null;
};

/** F01-API-005 CREATE checkpoints completed so far; absent when the response carries no progress snapshot. */
type ProgressField = { readonly checkpoints?: number };

export type IntentDecision = {
  readonly intentId: string;
  readonly status: DecisionStatus;
  readonly intentVersion: number;
  readonly questions: readonly QuestionView[];
  readonly assumptions: readonly AssumptionView[];
} & ProgressField;

export type CompileOutcome = {
  readonly intentId: string;
  readonly contentHash: string;
} & ProgressField;

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

type WireRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is WireRecord => typeof value === "object" && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1;

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;

function readQuestion(entry: unknown): QuestionView | null {
  if (!isRecord(entry) || !isNonEmptyString(entry.question_id) || typeof entry.prompt !== "string" || entry.required !== true) return null;
  const targets = entry.semantic_item_ids;
  if (!Array.isArray(targets) || targets.length !== 1 || !isNonEmptyString(targets[0])) return null;
  const shape = readQuestionShape(entry);
  return shape === null ? null : { questionId: entry.question_id, prompt: entry.prompt, targetId: targets[0], shape };
}

function readClassification(value: unknown): AssumptionClassification | null {
  return (ASSUMPTION_CLASSIFICATIONS as readonly unknown[]).includes(value) ? (value as AssumptionClassification) : null;
}

/** F01-DATA-004 provenance each label may carry: an LLM proposal or a default can never be labelled as a User fact. */
const LABEL_SOURCES: Readonly<Record<AssumptionClassification, readonly IntentSource[]>> = {
  FACT: ["USER_EXPLICIT", "DOMAIN_KNOWN", "USER_ACCEPTED_PROPOSAL"],
  DEFAULT: ["NFF_DEFAULT"],
  PROPOSAL: ["LLM_PROPOSED"],
  UNKNOWN: INTENT_SOURCES
};

const sourceFits = (classification: AssumptionClassification, source: unknown): boolean =>
  source === undefined || (LABEL_SOURCES[classification] as readonly unknown[]).includes(source);

/**
 * A pending DEFAULT / PROPOSAL without a complete, consistent F01-DATA-004A edit shape makes the whole
 * response unusable (rule 6): the Shell fails closed rather than offering a guessed or disabled editor. So does
 * a label that its own reported provenance contradicts.
 */
function readAssumption(entry: unknown): AssumptionView | null {
  if (!isRecord(entry) || !isNonEmptyString(entry.assumption_id) || typeof entry.description !== "string") return null;
  const classification = readClassification(entry.classification);
  if (classification === null || !sourceFits(classification, entry.source)) return null;
  const base = { assumptionId: entry.assumption_id, classification, description: entry.description };
  if (classification === "UNKNOWN") return { ...base, value: undefined, shape: null };
  const value = classification === "FACT" ? entry.resolved_value : entry.proposed_default;
  if (!isJsonValue(value)) return null;
  if (classification === "FACT") return { ...base, value, shape: null };
  const shape = readAssumptionShape(entry, value);
  return shape === null ? null : { ...base, value, shape };
}

function readAll<T>(value: unknown, read: (entry: unknown) => T | null, idOf: (item: T) => string): T[] | null {
  if (!Array.isArray(value)) return null;
  const items: T[] = [];
  const ids = new Set<string>();
  for (const entry of value as readonly unknown[]) {
    const item = read(entry);
    if (item === null || ids.has(idOf(item))) return null;
    ids.add(idOf(item));
    items.push(item);
  }
  return items;
}

/** Status-specific invariants: only NEEDS_CLARIFICATION asks (1–3); assumption review needs a pending item. */
function consistent(status: DecisionStatus, questions: readonly QuestionView[], assumptions: readonly AssumptionView[]): boolean {
  if (status === "NEEDS_CLARIFICATION") return questions.length >= 1 && questions.length <= MAX_QUESTIONS_PER_ROUND;
  if (questions.length > 0) return false;
  return status === "READY" || assumptions.some((assumption) => isPendingDecision(assumption.classification));
}

/**
 * Reads the F01 decision payload exactly as returned. Any contract violation — unknown status, a round
 * outside 1–3 questions, a broken answer / edit shape, duplicate ids — is a malformed response: the Shell
 * never trims, repairs or guesses F01 truth.
 */
export function readDecision(data: unknown): IntentDecision | null {
  if (!isRecord(data) || !isNonEmptyString(data.intent_id) || !isPositiveInteger(data.intent_version)) return null;
  const status = (DECISION_STATUSES as readonly unknown[]).includes(data.status) ? (data.status as DecisionStatus) : null;
  const questions = readAll(data.questions, readQuestion, (question) => question.questionId);
  const assumptions = readAll(data.visible_assumptions, readAssumption, (assumption) => assumption.assumptionId);
  const progress = readProgressField(data);
  if (status === null || questions === null || assumptions === null || progress === null || !consistent(status, questions, assumptions)) return null;
  return { intentId: data.intent_id, status, intentVersion: data.intent_version, questions, assumptions, ...progress };
}

export function readCompileOutcome(data: unknown): CompileOutcome | null {
  if (!isRecord(data) || !isNonEmptyString(data.intent_id) || data.status !== "VALIDATED" || !isNonEmptyString(data.content_hash)) return null;
  const progress = readProgressField(data);
  return progress === null ? null : { intentId: data.intent_id, contentHash: data.content_hash, ...progress };
}

/** An absent snapshot leaves progress indeterminate; a present but unreliable one makes the response malformed. */
function readProgressField(data: WireRecord): ProgressField | null {
  if (data.progress === undefined) return {};
  const checkpoints = readCreateProgress(data.progress);
  return checkpoints === null ? null : { checkpoints };
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
