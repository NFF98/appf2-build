import type { OperationListener, OperationStatus, RuntimeOperationProjection } from "../../platform/runtime/runtime-operation.js";

/**
 * The only F03 surface the Shell consumes for processing: read-only RuntimeOperation projections. The Shell
 * never holds the Runtime Instance Store and never decides commit, rollback or recovery (F00-AC-020).
 */
export type RuntimeOperationFeed = {
  subscribeOperations(listener: OperationListener): () => void;
};

export type SettledStatus = Exclude<OperationStatus, "STARTED" | "PROCESSING">;

/** An admitted operation that is still open: the S03 logical GLOBAL_PROCESSING state. */
export type ProcessingOperation = {
  readonly operationToken: string;
  /** Floored checkpoint-derived %, or null when F03 reports no reliable plan (Stage + activity only). */
  readonly percent: number | null;
  readonly longWait: boolean;
};

/** COMMITTED returns to the App at once; TIMED_OUT / FAILED / CANCELLED belong to F12 recovery, never 100%. */
export type SettledOperation = {
  readonly operationToken: string;
  readonly status: SettledStatus;
  readonly percent: number | null;
};

export type RuntimeProcessingView = {
  readonly processing: ProcessingOperation | null;
  readonly settled: SettledOperation | null;
};

const IDLE: RuntimeProcessingView = Object.freeze({ processing: null, settled: null });

const isOpen = (status: OperationStatus): boolean => status === "STARTED" || status === "PROCESSING";

/**
 * Truthful % from integer checkpoint counts: floored, and the full plan only counts once F03 reports COMMITTED,
 * so commit-ready is never 100%. Inconsistent counts are treated as no reliable plan rather than repaired.
 */
export function operationPercent(projection: RuntimeOperationProjection): number | null {
  const planned = projection.planned_checkpoints;
  const completed = projection.completed_checkpoints;
  if (planned === undefined || !Number.isInteger(planned) || planned <= 0) return null;
  if (!Number.isInteger(completed) || completed < 0 || completed > planned) return null;
  if (completed === planned && projection.status !== "COMMITTED") return null;
  return Math.floor((completed * 100) / planned);
}

/**
 * F00 Runtime processing presentation (F00 §31, O05 §13): every admitted operation enters GLOBAL_PROCESSING
 * synchronously from its F03 STARTED projection and leaves it on the terminal projection. No timer, minimum
 * display time or animation gate exists here, so an operation that finishes within one frame may never paint.
 */
export class RuntimeProcessingPresenter {
  private readonly open = new Map<string, RuntimeOperationProjection>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private view: RuntimeProcessingView = IDLE;
  private settled: SettledOperation | null = null;

  public constructor(feed: RuntimeOperationFeed) {
    this.unsubscribe = feed.subscribeOperations((projection) => this.observe(projection));
  }

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): RuntimeProcessingView => this.view;

  public dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
    this.open.clear();
  }

  private observe(projection: RuntimeOperationProjection): void {
    const token = projection.operation_token;
    if (isOpen(projection.status)) {
      this.open.set(token, projection);
    } else {
      this.open.delete(token);
      this.settled = { operationToken: token, status: projection.status as SettledStatus, percent: operationPercent(projection) };
    }
    this.view = { processing: this.current(), settled: this.settled };
    for (const listener of [...this.listeners]) listener();
  }

  /** The single-writer F03 queue runs one operation at a time: the PROCESSING one, else the oldest admitted. */
  private current(): ProcessingOperation | null {
    let shown: RuntimeOperationProjection | undefined;
    for (const projection of this.open.values()) {
      if (projection.status === "PROCESSING") {
        shown = projection;
        break;
      }
      shown ??= projection;
    }
    return shown === undefined ? null : { operationToken: shown.operation_token, percent: operationPercent(shown), longWait: shown.soft_timeout_observed };
  }
}
