import type { EditShape } from "./edit-shape.js";
import type { NodeProblems } from "./json-draft.js";
import { RecordFields } from "./RecordEditor.js";
import { optionLabels } from "./value-display.js";
import type { ValueDraft } from "./value-draft.js";

export type ValueEditorProps = {
  readonly shape: EditShape;
  readonly draft: ValueDraft;
  /** Unique prefix for radio group names and element ids. */
  readonly idBase: string;
  /** Accessible name of the value (question prompt or setting name). */
  readonly label: string;
  readonly describedBy: string | undefined;
  readonly multiline: boolean;
  readonly nodeProblems: NodeProblems;
  readonly disabled: boolean;
  readonly onChange: (draft: ValueDraft) => void;
};

type ChoiceOption = { readonly key: string; readonly label: string; readonly checked: boolean; readonly select: () => void };

function ChoiceList({ name, multiple, label, describedBy, options, disabled }: {
  readonly name: string;
  readonly multiple: boolean;
  readonly label: string;
  readonly describedBy: string | undefined;
  readonly options: readonly ChoiceOption[];
  readonly disabled: boolean;
}) {
  return (
    <div className="choice-list" role={multiple ? "group" : "radiogroup"} aria-label={label} aria-describedby={describedBy}>
      {options.map((option) => (
        <label key={option.key} className={`choice${option.checked ? " is-selected" : ""}`}>
          <input type={multiple ? "checkbox" : "radio"} name={name} checked={option.checked} disabled={disabled} onChange={option.select} />
          <span className={`choice-indicator${multiple ? " is-box" : ""}`} aria-hidden="true" />
          <span className="choice-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

/** Choices come only from the F01 `options[]` (ENUM: exactly one, LIST: distinct many) or a boolean pair. */
function choiceOptions(shape: EditShape, draft: ValueDraft, onChange: (draft: ValueDraft) => void): readonly ChoiceOption[] {
  if (draft.kind === "BOOLEAN") {
    return [true, false].map((flag) => ({ key: String(flag), label: flag ? "是" : "否", checked: draft.value === flag, select: () => onChange({ kind: "BOOLEAN", value: flag }) }));
  }
  const labels = "options" in shape ? optionLabels(shape.options) : [];
  if (draft.kind === "CHOICE") {
    return labels.map((label, index) => ({ key: String(index), label, checked: draft.index === index, select: () => onChange({ kind: "CHOICE", index }) }));
  }
  if (draft.kind !== "MULTI") return [];
  return labels.map((label, index) => {
    const checked = draft.indices.includes(index);
    const indices = checked ? draft.indices.filter((entry) => entry !== index) : [...draft.indices, index];
    return { key: String(index), label, checked, select: () => onChange({ kind: "MULTI", indices }) };
  });
}

/** One F01-typed value control; the projected shape alone picks the control, never the current value. */
export function ValueEditor({ shape, draft, idBase, label, describedBy, multiline, nodeProblems, disabled, onChange }: ValueEditorProps) {
  if (draft.kind === "TEXT") {
    const shared = {
      id: `${idBase}-input`,
      className: "text-input",
      value: draft.text,
      disabled,
      "aria-label": label,
      "aria-describedby": describedBy,
      "aria-invalid": describedBy !== undefined
    };
    if (shape.valueType === "NUMBER") return <input {...shared} type="text" inputMode="decimal" onChange={(event) => onChange({ kind: "TEXT", text: event.target.value })} />;
    if (multiline) return <textarea {...shared} rows={2} onChange={(event) => onChange({ kind: "TEXT", text: event.target.value })} />;
    return <input {...shared} type="text" onChange={(event) => onChange({ kind: "TEXT", text: event.target.value })} />;
  }
  if (draft.kind === "RECORD") {
    return <RecordFields fields={draft.fields} label={label} problems={nodeProblems} disabled={disabled} onChange={(fields) => onChange({ kind: "RECORD", fields })} />;
  }
  return (
    <ChoiceList
      name={idBase}
      multiple={draft.kind === "MULTI"}
      label={label}
      describedBy={describedBy}
      options={choiceOptions(shape, draft, onChange)}
      disabled={disabled}
    />
  );
}
