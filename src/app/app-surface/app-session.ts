import type { RuntimeAppHandle } from "../../platform/runtime/runtime-operation.js";

/** The active App on the APP surface: one admitted immutable Blueprint and the handle of its own F03 Instance. */
export interface AppVersion {
  readonly contentHash: string;
  readonly app: RuntimeAppHandle;
}

export type ChangeChoice = "MODIFY_THIS_APP" | "MAKE_MY_VERSION";

/** S03 §10: the only two change destinations; the User picks one explicitly, nothing is inferred from metadata. */
export type ChangeEntry =
  | { readonly choice: "MODIFY_THIS_APP"; readonly destination: "S05A"; readonly intent: "REFINE"; readonly baseContentHash: string }
  | { readonly choice: "MAKE_MY_VERSION"; readonly destination: "S05B"; readonly intent: "REMIX"; readonly baseContentHash: string };

export function changeEntryFor(choice: ChangeChoice, baseContentHash: string): ChangeEntry {
  return choice === "MODIFY_THIS_APP"
    ? { choice, destination: "S05A", intent: "REFINE", baseContentHash }
    : { choice, destination: "S05B", intent: "REMIX", baseContentHash };
}

/** F00 §18–§19 correction lifecycle as seen by the Shell; F16 owns the correction itself. */
export type CorrectionPhase =
  | { readonly kind: "NONE" }
  | { readonly kind: "COMPOSING"; readonly draft: string }
  | { readonly kind: "CORRECTING"; readonly draft: string }
  | { readonly kind: "FAILED"; readonly draft: string }
  | { readonly kind: "COMPARE"; readonly draft: string; readonly candidate: AppVersion };

export type CompareDecision = "ACCEPT_NEW" | "KEEP_PREVIOUS" | "ADJUST_AGAIN";

export interface AppSessionState {
  readonly current: AppVersion;
  readonly correction: CorrectionPhase;
}

const NONE: CorrectionPhase = Object.freeze({ kind: "NONE" });

/**
 * F00-STATE-003 APP surface session. Until the User accepts a new version, the current App (its Blueprint, its F03
 * Instance and committed state) is never replaced or touched: a correction failure keeps it, Keep Previous returns
 * to it unchanged, and only Accept New swaps in the candidate.
 */
export class AppSession {
  private state: AppSessionState;
  private readonly listeners = new Set<() => void>();

  public constructor(current: AppVersion) {
    this.state = { current, correction: NONE };
  }

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): AppSessionState => this.state;

  /** O02 entry 「調整結果」; a previous failure keeps its draft so the User can try again. */
  public openCorrection(): void {
    const { correction } = this.state;
    if (correction.kind === "NONE") this.setCorrection({ kind: "COMPOSING", draft: "" });
    else if (correction.kind === "FAILED") this.setCorrection({ kind: "COMPOSING", draft: correction.draft });
  }

  public updateDraft(draft: string): void {
    if (this.state.correction.kind === "COMPOSING") this.setCorrection({ kind: "COMPOSING", draft });
  }

  public closeCorrection(): void {
    const { correction } = this.state;
    if (correction.kind === "COMPOSING" || correction.kind === "FAILED") this.setCorrection(NONE);
  }

  /** Hand-off to F16; returns the draft submitted, or null when nothing may be submitted now. */
  public submitCorrection(): string | null {
    const { correction } = this.state;
    if (correction.kind !== "COMPOSING" || correction.draft.trim().length === 0) return null;
    this.setCorrection({ kind: "CORRECTING", draft: correction.draft });
    return correction.draft;
  }

  /** F00-AC-010: the failure is recorded beside the untouched current App. */
  public correctionFailed(): void {
    const { correction } = this.state;
    if (correction.kind === "CORRECTING") this.setCorrection({ kind: "FAILED", draft: correction.draft });
  }

  public correctionReady(candidate: AppVersion): void {
    const { correction } = this.state;
    if (correction.kind !== "CORRECTING") {
      candidate.app.release();
      return;
    }
    this.setCorrection({ kind: "COMPARE", draft: correction.draft, candidate });
  }

  /** F00-AC-011 / F00-AC-012: the three Compare decisions; only ACCEPT_NEW changes the current App. */
  public decide(decision: CompareDecision): void {
    const { current, correction } = this.state;
    if (correction.kind !== "COMPARE") return;
    if (decision === "ACCEPT_NEW") {
      current.app.release();
      this.state = { current: correction.candidate, correction: NONE };
      this.notify();
      return;
    }
    correction.candidate.app.release();
    this.setCorrection(decision === "KEEP_PREVIOUS" ? NONE : { kind: "COMPOSING", draft: correction.draft });
  }

  /** Leaving the APP surface releases every Instance this session owns. */
  public dispose(): void {
    const { current, correction } = this.state;
    if (correction.kind === "COMPARE") correction.candidate.app.release();
    current.app.release();
    this.listeners.clear();
  }

  private setCorrection(correction: CorrectionPhase): void {
    this.state = { current: this.state.current, correction };
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
