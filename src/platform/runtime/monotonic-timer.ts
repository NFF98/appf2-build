/** `performance.now()`-class monotonic source (F03-RQ-010). */
export interface MonotonicClock {
  now(): number;
}

/** Wake-up only: `setTimeout`-class scheduler. Elapsed truth is always recomputed from MonotonicClock. */
export interface WakeScheduler {
  schedule(delayMs: number, wake: () => void): () => void;
}

export type TimerStatus = "IDLE" | "RUNNING" | "PAUSED" | "COMPLETE";

export interface MonotonicTimerState {
  readonly status: TimerStatus;
  readonly duration_ms: number;
  /** Elapsed time accumulated before the current anchor (saved on pause). */
  readonly elapsed_offset_ms: number;
  /** Monotonic anchor of the current RUNNING span. */
  readonly anchor_ms?: number;
}

export interface TimerObservation {
  readonly timer: MonotonicTimerState;
  readonly elapsed_ms: number;
  readonly remaining_ms: number;
  /** True only on the observation that moves RUNNING → COMPLETE, so completion is emitted once. */
  readonly completed: boolean;
}

export function idleTimer(durationMs: number): MonotonicTimerState {
  return { status: "IDLE", duration_ms: durationMs, elapsed_offset_ms: 0 };
}

function elapsedAt(timer: MonotonicTimerState, now: number): number {
  const running = timer.status === "RUNNING" && timer.anchor_ms !== undefined ? Math.max(now - timer.anchor_ms, 0) : 0;
  return Math.min(timer.elapsed_offset_ms + running, timer.duration_ms);
}

/** Transitions apply only from their source status; any other status returns the same state object. */
export function startTimer(timer: MonotonicTimerState, now: number): MonotonicTimerState {
  return timer.status === "IDLE" ? { status: "RUNNING", duration_ms: timer.duration_ms, elapsed_offset_ms: 0, anchor_ms: now } : timer;
}

export function pauseTimer(timer: MonotonicTimerState, now: number): MonotonicTimerState {
  return timer.status === "RUNNING"
    ? { status: "PAUSED", duration_ms: timer.duration_ms, elapsed_offset_ms: elapsedAt(timer, now) }
    : timer;
}

export function resumeTimer(timer: MonotonicTimerState, now: number): MonotonicTimerState {
  return timer.status === "PAUSED"
    ? { status: "RUNNING", duration_ms: timer.duration_ms, elapsed_offset_ms: timer.elapsed_offset_ms, anchor_ms: now }
    : timer;
}

/** Reset returns to the initial duration with no elapsed time. */
export function resetTimer(timer: MonotonicTimerState): MonotonicTimerState {
  return idleTimer(timer.duration_ms);
}

export function observeTimer(timer: MonotonicTimerState, now: number): TimerObservation {
  const elapsed = elapsedAt(timer, now);
  const reachedEnd = timer.status === "RUNNING" && elapsed >= timer.duration_ms;
  const next: MonotonicTimerState = reachedEnd
    ? { status: "COMPLETE", duration_ms: timer.duration_ms, elapsed_offset_ms: timer.duration_ms }
    : timer;
  return {
    timer: next,
    elapsed_ms: elapsed,
    remaining_ms: Math.max(timer.duration_ms - elapsed, 0),
    completed: reachedEnd
  };
}

interface ArmedTimer {
  timer: MonotonicTimerState;
  cancel: () => void;
}

/**
 * Per-Instance timer slots. A wake never counts as a tick: each wake re-observes the monotonic clock, so a
 * delayed / throttled background wake cannot drift the elapsed truth, and completion fires exactly once.
 */
export class TimerWakeService {
  private readonly slots = new Map<string, ArmedTimer>();

  public constructor(
    private readonly clock: MonotonicClock,
    private readonly scheduler: WakeScheduler
  ) {}

  public arm(slot: string, timer: MonotonicTimerState, onComplete: () => void): void {
    this.disarm(slot);
    if (timer.status !== "RUNNING") {
      return;
    }
    const armed: ArmedTimer = { timer, cancel: () => undefined };
    this.slots.set(slot, armed);
    this.scheduleWake(slot, armed, onComplete);
  }

  public disarm(slot: string): void {
    this.slots.get(slot)?.cancel();
    this.slots.delete(slot);
  }

  public disarmAll(): void {
    for (const slot of [...this.slots.keys()]) {
      this.disarm(slot);
    }
  }

  public observe(slot: string): TimerObservation | undefined {
    const armed = this.slots.get(slot);
    return armed === undefined ? undefined : observeTimer(armed.timer, this.clock.now());
  }

  private scheduleWake(slot: string, armed: ArmedTimer, onComplete: () => void): void {
    const { remaining_ms: remaining } = observeTimer(armed.timer, this.clock.now());
    armed.cancel = this.scheduler.schedule(remaining, () => {
      if (this.slots.get(slot) !== armed) {
        return;
      }
      const observation = observeTimer(armed.timer, this.clock.now());
      if (observation.completed) {
        this.slots.delete(slot);
        onComplete();
        return;
      }
      this.scheduleWake(slot, armed, onComplete);
    });
  }
}
