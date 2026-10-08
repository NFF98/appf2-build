import { draftValue, type AnswerDraft, type DraftProblem } from "./answer-drafts.js";
import { planDecisions, type AssumptionDraft } from "./assumptions.js";
import {
  newSession,
  pendingAnswers,
  type CreateIntentDraft,
  type CreationPhase,
  type CreationSession,
  type CreationStep,
  type FieldProblem
} from "./creation-session.js";
import type { F01Call, F01Client } from "./f01-client.js";
import type { AnswerSubmissionRequest, CompileOutcome, F01Failure, F01Result, IntentDecision } from "./f01-wire.js";
import { LogicalOperationKeys } from "./logical-operation.js";

export type CreationControllerDependencies = {
  readonly client: F01Client;
  /** F07 first-party anonymous identity (`appf2.anonymous_id.v1`); may throw when Browser storage is unavailable. */
  readonly anonymousId: () => string;
  readonly newIdempotencyKey: () => string;
};

export type StartOutcome = "STARTED" | "RESUMED" | "IGNORED";

type Answer = AnswerSubmissionRequest["answers"][number];

/** F01 retry instruction: retryable failures repeat the same logical operation; F01-ERR-004 needs fresh state. */
function canRetry(failure: F01Failure): boolean {
  if (failure.kind !== "API") return true;
  return failure.retryable && failure.code !== "F01-ERR-004";
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

function omitKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const copy = { ...record };
  delete copy[key];
  return copy;
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

  public updateAnswer(questionId: string, draft: AnswerDraft): void {
    this.patch((session) => ({ answerDrafts: { ...session.answerDrafts, [questionId]: draft }, problems: omitKey(session.problems, questionId) }));
  }

  public updateAssumption(assumptionId: string, draft: AssumptionDraft | null): void {
    this.patch((session) => {
      const rest = omitKey(session.assumptionDrafts, assumptionId);
      return { assumptionDrafts: draft === null ? rest : { ...rest, [assumptionId]: draft }, problems: omitKey(session.problems, assumptionId) };
    });
  }

  /** CLARIFICATION 「繼續」 / ASSUMPTION_REVIEW 「用這些設定繼續」 → local validation → F01-API-002. */
  public submitDecisions(): void {
    const session = this.session;
    const decision = session?.decision ?? null;
    if (session === null || decision === null || this.inFlight !== null) return;
    if (session.phase.kind !== "CLARIFICATION_REQUIRED" && session.phase.kind !== "ASSUMPTION_REVIEW") return;
    const problems: Record<string, DraftProblem> = {};
    const answers: Answer[] = [];
    for (const question of decision.questions) {
      const value = draftValue(question, session.answerDrafts[question.question_id]);
      if (value.ok) answers.push({ question_id: question.question_id, value: value.value });
      else problems[question.question_id] = value.problem;
    }
    const plan = planDecisions(decision.visibleAssumptions, session.assumptionDrafts, session.phase.kind === "ASSUMPTION_REVIEW");
    if (!plan.ok) for (const id of plan.invalidIds) problems[id] = "TYPE_MISMATCH";
    if (!plan.ok || Object.keys(problems).length > 0) return this.patch(() => ({ problems }));
    if (answers.length + plan.decisions.length === 0) return;
    const body: AnswerSubmissionRequest = { answers, assumption_decisions: plan.decisions, intent_version: decision.intentVersion };
    void this.run({ kind: "ANSWERS", intentId: decision.intentId, body, decision });
  }

  /** Recovery 「再試一次」 / resume after leaving: the identical request, therefore the same Idempotency-Key. */
  public retry(): void {
    const phase = this.session?.phase;
    if (this.inFlight !== null || phase === undefined) return;
    if ((phase.kind === "RECOVERABLE_FAILURE" && phase.canRetry) || phase.kind === "INTERRUPTED") void this.run(phase.step);
  }

  /** 「回到建立 App」: stop waiting locally (F00-UX-023); server work is still deduplicated by the open key. */
  public leave(): void {
    this.inFlight?.abort();
  }

  private async run(step: CreationStep): Promise<void> {
    const controller = new AbortController();
    this.inFlight = controller;
    this.patch(() => ({ busy: true, phase: step.kind === "COMPILE" ? { kind: "BUILDING" } : { kind: "ANALYZING" } }));
    const result = await this.send(step, { idempotencyKey: this.keys.keyFor(JSON.stringify(step)), signal: controller.signal });
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
      answerDrafts: {},
      assumptionDrafts: {},
      problems: {},
      provided: [...session.provided, ...pendingAnswers(step)]
    }));
    if (ready) void this.run({ kind: "COMPILE", intentId: decision.intentId, body: { intent_version: decision.intentVersion } });
  }

  private fail(step: CreationStep, failure: F01Failure): void {
    if (failure.kind === "ABORTED") return this.patch(() => ({ busy: false, phase: { kind: "INTERRUPTED", step } }));
    const retry = canRetry(failure);
    if (!retry) this.keys.settle();
    const rejected = step.kind === "ANSWERS" ? rejectedTargets(step.body, failure) : {};
    if (step.kind === "ANSWERS" && Object.keys(rejected).length > 0) {
      return this.patch(() => ({ busy: false, phase: decisionPhase(step.decision), problems: rejected }));
    }
    this.patch(() => ({ busy: false, phase: { kind: "RECOVERABLE_FAILURE", step, canRetry: retry } }));
  }

  private patch(change: (session: CreationSession) => Partial<CreationSession>): void {
    const session = this.session;
    if (session === null) return;
    this.session = { ...session, ...change(session) };
    for (const listener of this.listeners) listener();
  }
}

/** Direct prompts carry the locked `DIRECT_PROMPT` source; a Capsule origin stays local (no unlocked source type is invented). */
function createStep(rawIntent: string, capsuleId: string | null): CreationStep {
  const body: CreateIntentDraft =
    capsuleId === null ? { intent_kind: "CREATE", raw_intent: rawIntent, source: { type: "DIRECT_PROMPT", capsule_id: null } } : { intent_kind: "CREATE", raw_intent: rawIntent };
  return { kind: "CREATE", body };
}
