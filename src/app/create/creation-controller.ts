import { decidableAssumptions, planDecisions, type AssumptionDraft } from "./assumptions.js";
import {
  compatibleDrafts,
  newSession,
  stepAnswers,
  type CreateIntentDraft,
  type CreationPhase,
  type CreationSession,
  type CreationStep,
  type FieldProblem,
  type RecoveryReason
} from "./creation-session.js";
import type { F01Call, F01Client } from "./f01-client.js";
import type { AnswerSubmissionRequest, CompileOutcome, F01Failure, F01Result, IntentDecision } from "./f01-wire.js";
import type { NodeProblem } from "./json-draft.js";
import { LogicalOperationKeys } from "./logical-operation.js";
import { draftNodeIds, readDraft, type ValueDraft } from "./value-draft.js";

export type CreationControllerDependencies = {
  readonly client: F01Client;
  /** F07 first-party anonymous identity (`appf2.anonymous_id.v1`); may throw when Browser storage is unavailable. */
  readonly anonymousId: () => string;
  readonly newIdempotencyKey: () => string;
};

export type StartOutcome = "STARTED" | "RESUMED" | "IGNORED";

type Answer = AnswerSubmissionRequest["answers"][number];

/** F01 retry instruction: retryable failures repeat the same logical operation; F01-ERR-004 needs fresh state. */
function recoveryReason(failure: F01Failure): RecoveryReason {
  if (failure.kind === "MALFORMED_RESPONSE") return "MALFORMED";
  if (failure.kind !== "API") return "RETRYABLE";
  if (failure.code === "F01-ERR-004") return "STALE_VERSION";
  if (failure.code === "F01-ERR-015") return "NOT_FOUND";
  return failure.retryable ? "RETRYABLE" : "REJECTED";
}

const VIOLATION_TARGET = /^\$\.(answers|assumption_decisions)\[(\d+)\]/;

/** Maps F01-ERR-003 violation paths back onto the question / assumption the User must fix. */
function rejectedTargets(body: AnswerSubmissionRequest, failure: F01Failure): Record<string, FieldProblem> {
  const problems: Record<string, FieldProblem> = {};
  if (failure.kind !== "API" || failure.code !== "F01-ERR-003") return problems;
  for (const violation of failure.violations) {
    const match = VIOLATION_TARGET.exec(violation.path);
    if (match === null) continue;
    const index = Number(match[2]);
    const target = match[1] === "answers" ? body.answers[index]?.question_id : body.assumption_decisions[index]?.assumption_id;
    if (target !== undefined) problems[target] = "SERVER_REJECTED";
  }
  return problems;
}

const decisionPhase = (decision: IntentDecision): CreationPhase =>
  decision.status === "NEEDS_CLARIFICATION" ? { kind: "CLARIFICATION_REQUIRED" } : { kind: "ASSUMPTION_REVIEW" };

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

function withoutIds<T>(record: Readonly<Record<string, T>>, ids: ReadonlySet<string>): Readonly<Record<string, T>> {
  if (ids.size === 0) return record;
  return Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));
}

const editDraftOf = (draft: AssumptionDraft | undefined): ValueDraft | undefined => (draft?.decision === "EDIT" ? draft.value : undefined);

/** Direct prompts carry the locked `DIRECT_PROMPT` source; a Capsule origin stays local (no unlocked source type is invented). */
function createStep(rawIntent: string, capsuleId: string | null): CreationStep {
  const body: CreateIntentDraft =
    capsuleId === null
      ? { intent_kind: "CREATE", raw_intent: rawIntent, source: { type: "DIRECT_PROMPT", capsule_id: null } }
      : { intent_kind: "CREATE", raw_intent: rawIntent };
  return { kind: "CREATE", body };
}

function stepPath(step: CreationStep): string {
  return step.kind === "CREATE" ? "intents" : `intents/${step.intentId}/${step.kind === "ANSWERS" ? "answers" : "compile"}`;
}

/**
 * F00 Creation orchestration for S01 → S02 over the existing F01 API. F01 owns every semantic decision; this
 * controller only sequences create → (clarify / review) → compile, keeps User input across failures, guards
 * duplicate submits (F00-ERR-004) and hands one stable Idempotency-Key per logical operation to F01.
 */
export class CreationController {
  private session: CreationSession | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly keys: LogicalOperationKeys;
  private inFlight: AbortController | null = null;

  public constructor(private readonly dependencies: CreationControllerDependencies) {
    this.keys = new LogicalOperationKeys(dependencies.newIdempotencyKey);
  }

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): CreationSession | null => this.session;

  /** S01 「建立 App」. Blank prompts are never sent; the same prompt resumes the existing creation context. */
  public start(rawIntent: string, capsuleId: string | null): StartOutcome {
    if (this.inFlight !== null || rawIntent.trim().length === 0) return "IGNORED";
    const current = this.session;
    if (current !== null && current.rawIntent === rawIntent) {
      this.retry();
      return "RESUMED";
    }
    this.session = newSession(rawIntent, capsuleId);
    void this.run(createStep(rawIntent, capsuleId));
    return "STARTED";
  }

  /** S02 「查看／修改需求」 apply: a material edit is a new logical create; prior answers no longer apply. */
  public editIntent(rawIntent: string): void {
    const current = this.session;
    if (current === null || this.inFlight !== null || rawIntent.trim().length === 0) return;
    this.session = newSession(rawIntent, current.capsuleId);
    void this.run(createStep(rawIntent, current.capsuleId));
  }

  /**
   * Recovery 「重新整理需求」: a fresh F01 analysis of the same Intent (new logical operation, new key). Unsent
   * drafts are kept and re-applied only where the new trusted round asks the same thing with the same shape.
   */
  public reanalyze(): void {
    const current = this.session;
    if (current === null || this.inFlight !== null) return;
    this.keys.settle();
    this.session = { ...newSession(current.rawIntent, current.capsuleId), decision: current.decision, answerDrafts: current.answerDrafts, assumptionDrafts: current.assumptionDrafts };
    void this.run(createStep(current.rawIntent, current.capsuleId));
  }

  /** Recovery 「回去修改」: back to the same round with every unsent answer / decision intact. */
  public reviseRound(): void {
    const phase = this.session?.phase;
    if (this.inFlight !== null || phase?.kind !== "RECOVERABLE_FAILURE" || phase.step.kind !== "ANSWERS") return;
    if (phase.reason !== "RETRYABLE" && phase.reason !== "REJECTED") return;
    const decision = phase.step.decision;
    this.patch(() => ({ phase: decisionPhase(decision), decision }));
  }

  public updateAnswer(questionId: string, draft: ValueDraft): void {
    this.patch((session) => ({
      answerDrafts: { ...session.answerDrafts, [questionId]: draft },
      problems: withoutKey(session.problems, questionId),
      nodeProblems: withoutIds(session.nodeProblems, draftNodeIds(session.answerDrafts[questionId]))
    }));
  }

  public updateAssumption(assumptionId: string, draft: AssumptionDraft | null): void {
    this.patch((session) => {
      const rest = withoutKey(session.assumptionDrafts, assumptionId);
      return {
        assumptionDrafts: draft === null ? rest : { ...rest, [assumptionId]: draft },
        problems: withoutKey(session.problems, assumptionId),
        nodeProblems: withoutIds(session.nodeProblems, draftNodeIds(editDraftOf(session.assumptionDrafts[assumptionId])))
      };
    });
  }

  /** CLARIFICATION 「繼續」 / ASSUMPTION_REVIEW 「用這些設定繼續」 → local validation → F01-API-002. */
  public submitDecisions(): void {
    const session = this.session;
    const decision = session?.decision ?? null;
    if (session === null || decision === null || this.inFlight !== null) return;
    if (session.phase.kind !== "CLARIFICATION_REQUIRED" && session.phase.kind !== "ASSUMPTION_REVIEW") return;
    const problems: Record<string, FieldProblem> = {};
    const nodeProblems: Record<string, NodeProblem> = {};
    const answers: Answer[] = [];
    for (const question of decision.questions) {
      const draft = session.answerDrafts[question.questionId];
      const read = draft === undefined ? null : readDraft(question.shape, draft, "ANSWER");
      if (read?.ok === true) answers.push({ question_id: question.questionId, value: read.value });
      else if (read === null) problems[question.questionId] = "REQUIRED";
      else {
        problems[question.questionId] = read.problem;
        Object.assign(nodeProblems, read.nodeProblems);
      }
    }
    const plan = planDecisions(decidableAssumptions(decision), session.assumptionDrafts, session.phase.kind === "ASSUMPTION_REVIEW");
    Object.assign(problems, plan.problems);
    Object.assign(nodeProblems, plan.nodeProblems);
    if (Object.keys(problems).length > 0) return this.patch(() => ({ problems, nodeProblems }));
    if (answers.length + plan.decisions.length === 0) return;
    const body: AnswerSubmissionRequest = { answers, assumption_decisions: plan.decisions, intent_version: decision.intentVersion };
    void this.run({ kind: "ANSWERS", intentId: decision.intentId, body, decision });
  }

  /** Recovery 「再試一次」 / resume after leaving: the identical request, therefore the same Idempotency-Key. */
  public retry(): void {
    const phase = this.session?.phase;
    if (this.inFlight !== null || phase === undefined) return;
    if ((phase.kind === "RECOVERABLE_FAILURE" && phase.reason === "RETRYABLE") || phase.kind === "INTERRUPTED") void this.run(phase.step);
  }

  /** 「回到建立 App」: stop waiting locally (F00-UX-023); server work is still deduplicated by the open key. */
  public leave(): void {
    this.inFlight?.abort();
  }

  private async run(step: CreationStep): Promise<void> {
    const controller = new AbortController();
    this.inFlight = controller;
    this.patch(() => ({ busy: true, phase: step.kind === "COMPILE" ? { kind: "BUILDING" } : { kind: "ANALYZING" } }));
    const fingerprint = `${stepPath(step)}\n${JSON.stringify(step.body)}`;
    const result = await this.send(step, { idempotencyKey: this.keys.keyFor(fingerprint), signal: controller.signal });
    this.inFlight = null;
    if (!result.ok) return this.fail(step, result.failure);
    this.keys.settle();
    if (step.kind === "COMPILE") {
      return this.patch(() => ({ busy: false, phase: { kind: "BUILD_VALIDATED", contentHash: (result.data as CompileOutcome).contentHash } }));
    }
    this.decide(step, result.data as IntentDecision);
  }

  private send(step: CreationStep, call: F01Call): Promise<F01Result<IntentDecision | CompileOutcome>> {
    const { client } = this.dependencies;
    if (step.kind === "ANSWERS") return client.submitAnswers(step.intentId, step.body, call);
    if (step.kind === "COMPILE") return client.compile(step.intentId, step.body, call);
    let anonymousId: string;
    try {
      anonymousId = this.dependencies.anonymousId();
    } catch {
      return Promise.resolve({ ok: false, failure: { kind: "IDENTITY_UNAVAILABLE" } });
    }
    return client.createIntent({ anonymous_id: anonymousId, ...step.body }, call);
  }

  /** F00-UX-011 fast path: READY goes straight to BUILDING; only F01 decisions stop for the User. */
  private decide(step: CreationStep, decision: IntentDecision): void {
    const ready = decision.status === "READY";
    this.patch((session) => ({
      busy: ready,
      decision,
      ...(ready ? {} : { phase: decisionPhase(decision) }),
      ...compatibleDrafts(session, decision),
      problems: {},
      nodeProblems: {},
      provided: [...session.provided, ...stepAnswers(step)]
    }));
    if (ready) void this.run({ kind: "COMPILE", intentId: decision.intentId, body: { intent_version: decision.intentVersion } });
  }

  private fail(step: CreationStep, failure: F01Failure): void {
    if (failure.kind === "ABORTED") return this.patch(() => ({ busy: false, phase: { kind: "INTERRUPTED", step } }));
    const reason = recoveryReason(failure);
    if (reason !== "RETRYABLE") this.keys.settle();
    const rejected = step.kind === "ANSWERS" ? rejectedTargets(step.body, failure) : {};
    if (step.kind === "ANSWERS" && Object.keys(rejected).length > 0) {
      return this.patch(() => ({ busy: false, phase: decisionPhase(step.decision), problems: rejected }));
    }
    this.patch(() => ({ busy: false, phase: { kind: "RECOVERABLE_FAILURE", step, reason } }));
  }

  private patch(change: (session: CreationSession) => Partial<CreationSession>): void {
    const session = this.session;
    if (session === null) return;
    this.session = { ...session, ...change(session) };
    for (const listener of this.listeners) listener();
  }
}
