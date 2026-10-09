import { useState } from "react";

export type DisclosureMode = "CLOSED" | "VIEW" | "EDIT";

type IntentDisclosureProps = {
  readonly rawIntent: string;
  /** Clarification / Assumption / Recovery: the disclosure becomes 「查看／修改需求」. */
  readonly editable: boolean;
  readonly mode: DisclosureMode;
  readonly onModeChange: (mode: DisclosureMode) => void;
  readonly onApply: (rawIntent: string) => void;
};

/** S02 Original Intent Access: a light disclosure; edits stay in S02 and re-enter F01 analysis on apply. */
export function IntentDisclosure({ rawIntent, editable, mode, onModeChange, onApply }: IntentDisclosureProps) {
  const [text, setText] = useState(rawIntent);
  const [invalid, setInvalid] = useState(false);
  const editing = editable && mode === "EDIT";

  const close = (): void => {
    setText(rawIntent);
    setInvalid(false);
    onModeChange("CLOSED");
  };

  const apply = (): void => {
    if (text.trim().length === 0) return setInvalid(true);
    onModeChange("CLOSED");
    if (text !== rawIntent) onApply(text);
  };

  return (
    <section className="intent-access">
      <button
        type="button"
        className="btn btn-link intent-toggle"
        aria-expanded={mode !== "CLOSED"}
        aria-controls="intent-panel"
        onClick={() => (mode === "CLOSED" ? onModeChange("VIEW") : close())}
      >
        {editable ? "查看／修改需求" : "查看需求"}
      </button>
      <div id="intent-panel" className="intent-panel" hidden={mode === "CLOSED"}>
        {editing ? (
          <>
            <label htmlFor="intent-edit" className="field-label">
              你的需求
            </label>
            <textarea
              id="intent-edit"
              className="text-input intent-edit"
              value={text}
              autoFocus
              aria-invalid={invalid}
              aria-describedby={invalid ? "intent-edit-error" : undefined}
              onChange={(event) => {
                setText(event.target.value);
                setInvalid(false);
              }}
            />
            {invalid ? (
              <p id="intent-edit-error" className="field-error" role="alert">
                請先說說你想做什麼 App
              </p>
            ) : null}
            <div className="intent-actions">
              <button type="button" className="btn btn-secondary" onClick={close}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={apply}>
                用新的需求重新整理
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="intent-text">{rawIntent}</p>
            {editable ? (
              <button type="button" className="btn btn-secondary" onClick={() => onModeChange("EDIT")}>
                修改需求
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
