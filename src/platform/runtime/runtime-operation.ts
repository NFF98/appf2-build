import { RuntimeFailure } from "./runtime-errors.js";

/** F03 §37 Phase 1 synchronous Action policy: warning after 50 ms, recovery after 250 ms (F03-POL-001). */
export const SOFT_DEADLINE_MS = 50;
export const HARD_DEADLINE_MS = 250;

export type OperationStatus = "STARTED" | "PROCESSING" | "COMMITTED" | "TIMED_OUT" | "FAILED" | "CANCELLED";
export type TerminalOperationStatus = Exclude<OperationStatus, "STARTED" | "PROCESSING" | "COMMITTED">;
/** F03-RQ-012 closed discard-reason set; integrity is deliberately not a member. */
export type DiscardReason = "TOKEN_CLOSED" | "TOKEN_NOT_CURRENT" | "INSTANCE_EPOCH_MISMATCH" | "HARD_DEADLINE_ELAPSED";
export type GuardBoundary =
  | "OPERATION_ADMISSION"
  | "STEP_BEFORE"
  | "STEP_AFTER"
  | "RECOMPUTE_BEFORE"
  | "RECOMPUTE_AFTER"
  | "HANDLER_RETURN"
  | "PRE_COMMIT";

export const PRE_COMMIT_CHECKPOINT = "pre_commit";
export const COMMITTED_CHECKPOINT = "committed";

/** Reliable Action plan: each declared step, pre-commit validation, then commit (F03-RQ-012 checkpoint rule). */
export function actionCheckpointPlan(stepCount: number): readonly string[] {
  return [...Array.from({ length: stepCount }, (_, index) => stepCheckpoint(index)), PRE_COMMIT_CHECKPOINT, COMMITTED_CHECKPOINT];
}

export function stepCheckpoint(stepIndex: number): string {
  return `step:${stepIndex + 1}`;
}

/** Truthful F00 progress source: checkpoint numbers only exist when a reliable plan exists. */
export interface RuntimeOperationProjection {
  readonly operation_token: string;
  readonly status: OperationStatus;
  readonly soft_timeout_observed: boolean;
  readonly completed_checkpoints: number;
  readonly planned_checkpoints?: number;
  readonly progress_percent?: number;
  readonly last_completed_checkpoint_id?: string;
}

export type OperationListener = (projection: RuntimeOperationProjection) => void;

export interface RuntimeOperationHandle {
  readonly operation_token: string;
  projection(): RuntimeOperationProjection;
  subscribe(listener: OperationListener): () => void;
}

export interface RuntimeOperationInit {
  readonly token: string;
  readonly instanceEpoch: number;
  readonly admittedMs: number;
  readonly checkpointPlan?: readonly string[];
  readonly recoveryEpisodeId?: string;
}

/**
 * One admitted interaction (F03-RQ-012). The token is never reopened: once closed, every later completion of
 * this operation is stale. Deadlines are fixed from the monotonic admission instant.
 */
export class RuntimeOperation {
  public readonly token: string;
  public readonly instanceEpoch: number;
  public readonly admittedMs: number;
  public readonly softDeadlineMs: number;
  public readonly hardDeadlineMs: number;
  public readonly checkpointPlan: readonly string[] | undefined;
  public readonly recoveryEpisodeId: string | undefined;
  public readonly handle: RuntimeOperationHandle;
  private currentStatus: OperationStatus = "STARTED";
  private completed = 0;
  private softObserved = false;
  private readonly listeners = new Set<OperationListener>();

  public constructor(init: RuntimeOperationInit) {
    this.token = init.token;
    this.instanceEpoch = init.instanceEpoch;
    this.admittedMs = init.admittedMs;
    this.softDeadlineMs = init.admittedMs + SOFT_DEADLINE_MS;
    this.hardDeadlineMs = init.admittedMs + HARD_DEADLINE_MS;
    this.checkpointPlan = init.checkpointPlan === undefined ? undefined : Object.freeze([...init.checkpointPlan]);
    this.recoveryEpisodeId = init.recoveryEpisodeId;
    this.handle = Object.freeze({
      operation_token: this.token,
      projection: () => this.projection(),
      subscribe: (listener: OperationListener) => this.subscribe(listener)
    });
  }

  public get status(): OperationStatus {
    return this.currentStatus;
  }

  public get isOpen(): boolean {
    return this.currentStatus === "STARTED" || this.currentStatus === "PROCESSING";
  }

  public get lastCompletedCheckpoint(): string | undefined {
    return this.completed === 0 ? undefined : this.checkpointPlan?.[this.completed - 1];
  }

  public begin(): boolean {
    if (this.currentStatus !== "STARTED") {
      return false;
    }
    this.currentStatus = "PROCESSING";
    this.notify();
    return true;
  }

  /** Checkpoints are monotonic: only the next planned, non-final checkpoint can complete, and only while PROCESSING. */
  public completeCheckpoint(checkpointId: string): boolean {
    const plan = this.checkpointPlan;
    if (plan === undefined || this.currentStatus !== "PROCESSING" || this.completed >= plan.length - 1 || plan[this.completed] !== checkpointId) {
      return false;
    }
    this.completed += 1;
    this.notify();
    return true;
  }

  public observeSoftTimeout(): boolean {
    if (this.currentStatus !== "PROCESSING" || this.softObserved) {
      return false;
    }
    this.softObserved = true;
    this.notify();
    return true;
  }

  /** Commit is the only transition that completes the final checkpoint, so 100% is never shown before commit. */
  public markCommitted(): boolean {
    if (this.currentStatus !== "PROCESSING") {
      return false;
    }
    this.currentStatus = "COMMITTED";
    if (this.checkpointPlan !== undefined && this.completed === this.checkpointPlan.length - 1) {
      this.completed += 1;
    }
    this.finish();
    return true;
  }

  public close(status: TerminalOperationStatus): boolean {
    if (!this.isOpen) {
      return false;
    }
    this.currentStatus = status;
    this.finish();
    return true;
  }

  public projection(): RuntimeOperationProjection {
    const plan = this.checkpointPlan;
    const last = this.lastCompletedCheckpoint;
    return {
      operation_token: this.token,
      status: this.currentStatus,
      soft_timeout_observed: this.softObserved,
      completed_checkpoints: this.completed,
      ...(plan === undefined ? {} : { planned_checkpoints: plan.length, progress_percent: (this.completed / plan.length) * 100 }),
      ...(last === undefined ? {} : { last_completed_checkpoint_id: last })
    };
  }

  private subscribe(listener: OperationListener): () => void {
    if (!this.isOpen) {
      return () => undefined;
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private finish(): void {
    this.notify();
    this.listeners.clear();
  }

  private notify(): void {
    const projection = this.projection();
    for (const listener of [...this.listeners]) {
      try {
        listener(projection);
      } catch {
        // Presentation listeners never decide commit, rollback or recovery.
      }
    }
  }
}

export interface OperationContext {
  readonly current: RuntimeOperation | undefined;
  readonly instanceEpoch: number;
}

export function staleReason(operation: RuntimeOperation, context: OperationContext): DiscardReason | undefined {
  if (!operation.isOpen) {
    return "TOKEN_CLOSED";
  }
  if (context.current !== operation) {
    return "TOKEN_NOT_CURRENT";
  }
  return context.instanceEpoch === operation.instanceEpoch ? undefined : "INSTANCE_EPOCH_MISMATCH";
}

/** F03-RQ-013 commit eligibility, in contract order; integrity is checked separately and fails closed as ERR-018. */
export function commitIneligibility(operation: RuntimeOperation, context: OperationContext & { readonly nowMs: number }): DiscardReason | undefined {
  return staleReason(operation, context) ?? (context.nowMs >= operation.hardDeadlineMs ? "HARD_DEADLINE_ELAPSED" : undefined);
}

/** Control-flow signal: the operation's continued execution belongs to a closed / replaced token. */
export class StaleOperation extends Error {
  public constructor(public readonly reason: DiscardReason) {
    super(`Runtime operation completion discarded: ${reason}.`);
    this.name = "StaleOperation";
  }
}

export class HardDeadlineExceeded extends RuntimeFailure {
  public constructor(public readonly boundary: GuardBoundary) {
    super("F03-ERR-021", `Runtime action hard deadline elapsed at ${boundary}.`);
    this.name = "HardDeadlineExceeded";
  }

  /** A handler return or pre-commit after the deadline is a late completion that must be discarded. */
  public get lateCompletion(): boolean {
    return this.boundary === "HANDLER_RETURN" || this.boundary === "PRE_COMMIT";
  }
}

export interface ActionGuard {
  check(boundary: GuardBoundary): void;
  checkpoint(checkpointId: string): void;
}

export interface OperationGuardHost {
  readonly context: () => OperationContext;
  readonly now: () => number;
  readonly softTimeoutObserved: (operation: RuntimeOperation) => void;
  readonly checkpointCompleted: (operation: RuntimeOperation, checkpointId: string) => void;
}

/** Mandatory guard at every Action boundary (F03-RQ-013 / F03-AC-031). */
export class OperationGuard implements ActionGuard {
  public constructor(
    private readonly operation: RuntimeOperation,
    private readonly host: OperationGuardHost
  ) {}

  public check(boundary: GuardBoundary): void {
    const reason = staleReason(this.operation, this.host.context());
    if (reason !== undefined) {
      throw new StaleOperation(reason);
    }
    const now = this.host.now();
    if (now >= this.operation.hardDeadlineMs) {
      throw new HardDeadlineExceeded(boundary);
    }
    if (now >= this.operation.softDeadlineMs && this.operation.observeSoftTimeout()) {
      this.host.softTimeoutObserved(this.operation);
    }
  }

  public checkpoint(checkpointId: string): void {
    if (this.operation.completeCheckpoint(checkpointId)) {
      this.host.checkpointCompleted(this.operation, checkpointId);
    }
  }
}
