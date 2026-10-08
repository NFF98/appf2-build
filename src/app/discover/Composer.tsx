import { useLayoutEffect, useRef, useState, type Ref } from "react";

import { findCapsule, SUGGESTION_CAPSULE_IDS, type Capsule } from "./capsules.js";
import type { ComposerDraft } from "./DiscoverScreen.js";

type ComposerProps = {
  readonly ref: Ref<HTMLTextAreaElement>;
  readonly draft: ComposerDraft;
  readonly onDraftChange: (draft: ComposerDraft) => void;
  readonly onCreate: () => void;
  readonly onSuggestion: (capsule: Capsule) => void;
};

const SUGGESTIONS: readonly Capsule[] = SUGGESTION_CAPSULE_IDS.map(findCapsule).filter((capsule): capsule is Capsule => capsule !== undefined);

function assignRef<T>(ref: Ref<T>, value: T | null): void {
  if (typeof ref === "function") ref(value);
  else if (ref !== null) ref.current = value;
}

/**
 * S01 Creator Composer — the only Create entry. Ghost Text is the native placeholder (styled weaker than User
 * text, gone once typing starts); EMPTY never submits; the textarea auto-grows up to its CSS max-height.
 */
export function Composer({ ref, draft, onDraftChange, onCreate, onSuggestion }: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [invalid, setInvalid] = useState(false);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
  }, [draft.text]);

  const submit = (): void => {
    if (draft.text.trim().length === 0) {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    onCreate();
  };

  const change = (text: string): void => {
    if (invalid && text.trim().length > 0) setInvalid(false);
    onDraftChange({ text, capsuleId: text.length === 0 ? null : draft.capsuleId });
  };

  return (
    <section className="composer" aria-label="建立 App">
      <label htmlFor="composer-input" className="sr-only">
        說出你想做的 App
      </label>
      <textarea
        id="composer-input"
        ref={(element) => {
          inputRef.current = element;
          assignRef(ref, element);
        }}
        className="composer-input"
        placeholder="告訴我你想做什麼…"
        value={draft.text}
        aria-invalid={invalid}
        aria-describedby={invalid ? "composer-error" : undefined}
        onChange={(event) => change(event.target.value)}
      />
      {invalid ? (
        <p id="composer-error" className="field-error" role="alert">
          請先說說你想做什麼 App
        </p>
      ) : null}
      <div className="composer-footer">
        <div className="composer-suggestions" role="group" aria-label="範例想法">
          <span className="composer-suggestions-label" aria-hidden="true">
            例如：
          </span>
          {SUGGESTIONS.map((capsule) => (
            <button key={capsule.id} type="button" className="chip" onClick={() => onSuggestion(capsule)}>
              {capsule.title}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary composer-create" onClick={submit}>
          建立 App <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}
