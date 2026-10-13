import type { ChangeEntry } from "../app-surface/app-session.js";

/**
 * Where the S05 session currently is. A Preview view only exists once F06 has produced a child App; F06 is not part of
 * this build, so 「查看原版」 can only be pressed from the Composer.
 */
export type ChangeView = "COMPOSER" | "INSPECTING_ORIGINAL";

/** One S05A / S05B change session: its identity, explicit path, the User's draft and the view it is in. */
export interface ChangeSession {
  readonly id: string;
  readonly entry: ChangeEntry;
  readonly draft: string;
  readonly view: ChangeView;
}

/**
 * F00 owner of the APP surface's single S05 change session. Inspecting the original (S03 Inspection Mode) only moves
 * the same session between views: its id, path and draft are kept, and no second session can be opened while one is
 * alive.
 */
export class ChangeSessionOwner {
  private session: ChangeSession | null = null;
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): ChangeSession | null => this.session;

  /** S03 hand-off of an explicit S05A / S05B choice; refused while a session already exists. */
  public readonly open = (entry: ChangeEntry): boolean => {
    if (this.session !== null) return false;
    this.set({ id: this.newId(), entry, draft: "", view: "COMPOSER" });
    return true;
  };

  public readonly updateDraft = (draft: string): void => {
    if (this.session?.view === "COMPOSER") this.set({ ...this.session, draft });
  };

  /** 「查看原版」: the same session waits in Inspection Mode while the User looks at and uses the source App. */
  public readonly viewOriginal = (): void => {
    if (this.session?.view === "COMPOSER") this.set({ ...this.session, view: "INSPECTING_ORIGINAL" });
  };

  /** 「返回修改畫面」: back to the very same session and draft. */
  public readonly returnFromOriginal = (): void => {
    if (this.session?.view === "INSPECTING_ORIGINAL") this.set({ ...this.session, view: "COMPOSER" });
  };

  /** 「回原 App」 ends the session; the source App was never changed by it. */
  public readonly close = (): void => {
    if (this.session?.view === "COMPOSER") this.set(null);
  };

  private set(session: ChangeSession | null): void {
    this.session = session;
    for (const listener of [...this.listeners]) listener();
  }
}
