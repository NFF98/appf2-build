import type { MonotonicClock } from "./monotonic-timer.js";
import { RuntimeFailure } from "./runtime-errors.js";

/** F03-RQ-016 Integrity Evidence. Only PROVEN may enter the normal recoverable timeout path. */
export type IntegrityStatus = "PROVEN" | "UNKNOWN" | "ASSURANCE_DEGRADED" | "CORRUPTED";
export type UnprovenIntegrity = Exclude<IntegrityStatus, "PROVEN">;

/** Integrity that cannot be proven always fails closed as F03-ERR-018; it is never a discard reason. */
export class IntegrityFailure extends RuntimeFailure {
  public constructor(
    public readonly integrity: UnprovenIntegrity,
    message: string
  ) {
    super("F03-ERR-018", message);
    this.name = "IntegrityFailure";
  }
}

/** A plain invariant breach is CORRUPTED; any other Runtime failure carries no integrity verdict. */
export function integrityOf(failure: RuntimeFailure): UnprovenIntegrity | undefined {
  if (failure instanceof IntegrityFailure) {
    return failure.integrity;
  }
  return failure.code === "F03-ERR-018" ? "CORRUPTED" : undefined;
}

/**
 * Committed-store integrity at the end of an uncommitted operation: the single writer never commits outside a
 * current token, so an unchanged store revision proves the last committed state was not partially written.
 */
export function assessCommittedIntegrity(
  baselineRevision: number | undefined,
  currentRevision: number | undefined,
  ready: boolean
): IntegrityStatus {
  if (baselineRevision === undefined || currentRevision === undefined || !ready) {
    return "UNKNOWN";
  }
  return baselineRevision === currentRevision ? "PROVEN" : "CORRUPTED";
}

/** Deadline reads. An unusable monotonic reading can prove neither "within deadline" nor "timed out". */
export class MonotonicReader {
  private last = Number.NEGATIVE_INFINITY;

  public constructor(private readonly clock: MonotonicClock) {}

  public read(): number {
    let now: number;
    try {
      now = this.clock.now();
    } catch {
      throw new IntegrityFailure("UNKNOWN", "Monotonic clock read failed.");
    }
    if (!Number.isFinite(now)) {
      throw new IntegrityFailure("UNKNOWN", "Monotonic clock returned a non-finite reading.");
    }
    if (now < this.last) {
      throw new IntegrityFailure("ASSURANCE_DEGRADED", "Monotonic clock regressed.");
    }
    this.last = now;
    return now;
  }
}
