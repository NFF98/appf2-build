import type { ComposerDraft } from "./DiscoverScreen.js";

/** F00 §26 versioned key: a different version is a different record and is never migrated. */
export const PROMPT_DRAFT_STORAGE_KEY = "appf2.f00.prompt_draft.v1";
export const PROMPT_DRAFT_SCHEMA = "appf2.f00.prompt_draft";
export const PROMPT_DRAFT_VERSION = 1;
/** F07-POL-009A browser draft retention: 7 days, after which the local record is deleted. */
export const PROMPT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Closed allowlist: a record carrying any other field is discarded rather than partially trusted. */
const RECORD_FIELDS = ["capsule_id", "saved_at", "schema", "text", "version"] as const;

export type DraftStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type PromptDraftStoreDependencies = {
  /** Browser storage; may throw when storage is disabled or blocked. */
  readonly storage: () => DraftStorage;
  readonly now: () => number;
  readonly isKnownCapsule: (capsuleId: string) => boolean;
};

type PromptDraftRecord = {
  readonly schema: typeof PROMPT_DRAFT_SCHEMA;
  readonly version: typeof PROMPT_DRAFT_VERSION;
  readonly text: string;
  readonly capsule_id: string | null;
  readonly saved_at: number;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

function hasExactFields(value: Readonly<Record<string, unknown>>): boolean {
  const fields = Object.keys(value).sort();
  return fields.length === RECORD_FIELDS.length && fields.every((field, index) => field === RECORD_FIELDS[index]);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * F00 §26 Browser draft persistence for the one item the Shell can classify on its own: the unsent S01 prompt
 * draft (text + local Capsule origin). Clarification answers, assumption edits and every F01 response are never
 * written here — the F01 wire carries no sensitivity, so a DO_NOT_PERSIST value would be indistinguishable.
 * Storage failures mean continuing without persistence (F00-ERR-002 LOCAL_DRAFT_PERSIST_FAILED).
 */
export class PromptDraftStore {
  public constructor(private readonly dependencies: PromptDraftStoreDependencies) {}

  /** Rehydrates only a well-formed, current-version, unexpired record; anything else is deleted, never repaired. */
  public load(): ComposerDraft | null {
    const raw = this.attempt((storage) => storage.getItem(PROMPT_DRAFT_STORAGE_KEY));
    if (raw === undefined || raw === null) return null;
    const draft = this.read(parseJson(raw));
    if (draft === null) this.clear();
    return draft;
  }

  /** A blank Composer is a discarded draft. */
  public save(draft: ComposerDraft): void {
    if (draft.text.trim().length === 0) return this.clear();
    const record: PromptDraftRecord = {
      schema: PROMPT_DRAFT_SCHEMA,
      version: PROMPT_DRAFT_VERSION,
      text: draft.text,
      capsule_id: draft.capsuleId !== null && this.dependencies.isKnownCapsule(draft.capsuleId) ? draft.capsuleId : null,
      saved_at: this.dependencies.now()
    };
    this.attempt((storage) => storage.setItem(PROMPT_DRAFT_STORAGE_KEY, JSON.stringify(record)));
  }

  public clear(): void {
    this.attempt((storage) => storage.removeItem(PROMPT_DRAFT_STORAGE_KEY));
  }

  /** Successful submit: the stored draft ends only if it is the prompt F01 accepted, never a newer unsent one. */
  public clearSubmitted(submittedText: string): void {
    if (this.load()?.text === submittedText) this.clear();
  }

  private read(value: unknown): ComposerDraft | null {
    if (!isRecord(value) || !hasExactFields(value)) return null;
    if (value.schema !== PROMPT_DRAFT_SCHEMA || value.version !== PROMPT_DRAFT_VERSION) return null;
    const { text, capsule_id: capsuleId, saved_at: savedAt } = value;
    if (typeof text !== "string" || text.trim().length === 0) return null;
    if (capsuleId !== null && (typeof capsuleId !== "string" || !this.dependencies.isKnownCapsule(capsuleId))) return null;
    if (typeof savedAt !== "number" || !Number.isSafeInteger(savedAt)) return null;
    const age = this.dependencies.now() - savedAt;
    if (age < 0 || age >= PROMPT_DRAFT_TTL_MS) return null;
    return { text, capsuleId };
  }

  private attempt<T>(operation: (storage: DraftStorage) => T): T | undefined {
    try {
      return operation(this.dependencies.storage());
    } catch {
      return undefined;
    }
  }
}
