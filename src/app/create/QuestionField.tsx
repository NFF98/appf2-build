import { displayValue, emptyDraft, type AnswerDraft, type FieldRow } from "./answer-drafts.js";
import type { FieldProblem } from "./creation-session.js";
import type { ClarificationQuestionView } from "./f01-wire.js";

type QuestionFieldProps = {
  readonly question: ClarificationQuestionView;
  readonly number: number;
  readonly draft: AnswerDraft | undefined;
  readonly problem: FieldProblem | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: AnswerDraft) => void;
};

type ControlProps<D extends AnswerDraft> = {
  readonly question: ClarificationQuestionView;
  readonly baseId: string;
  readonly draft: D;
  readonly describedBy: string | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: AnswerDraft) => void;
};

export function problemText(problem: FieldProblem, question: ClarificationQuestionView): string {
  if (problem === "REQUIRED") return "請回答這一題";
  if (problem === "DUPLICATE_FIELD") return "欄位名稱不可重複";
  if (problem === "SERVER_REJECTED") return "這個回答無法使用，請修改後再試";
  return question.question_type === "NUMBER" ? "請輸入數字" : "這個回答的格式不正確";
}

function TextControl({ question, baseId, draft, describedBy, disabled, onChange }: ControlProps<Extract<AnswerDraft, { kind: "TEXT" }>>) {
  const shared = {
    id: `${baseId}-input`,
    className: "text-input",
    value: draft.text,
    disabled,
    "aria-describedby": describedBy,
    "aria-invalid": describedBy !== undefined,
    "aria-labelledby": `${baseId}-legend`
  };
  if (question.question_type === "NUMBER") {
    return <input {...shared} type="text" inputMode="decimal" onChange={(event) => onChange({ kind: "TEXT", text: event.target.value })} />;
  }
  return <textarea {...shared} rows={2} onChange={(event) => onChange({ kind: "TEXT", text: event.target.value })} />;
}

type ChoiceOption = { readonly key: string; readonly label: string; readonly checked: boolean; readonly select: () => void };

function ChoiceList({ name, multiple, options, disabled }: { readonly name: string; readonly multiple: boolean; readonly options: readonly ChoiceOption[]; readonly disabled: boolean }) {
  return (
    <div className="choice-list">
      {options.map((option) => (
        <label key={option.key} className={`choice${option.checked ? " is-selected" : ""}`}>
          <input type={multiple ? "checkbox" : "radio"} name={name} checked={option.checked} disabled={disabled} onChange={option.select} />
          <span className="choice-indicator" aria-hidden="true" />
          <span className="choice-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function choiceOptions(question: ClarificationQuestionView, draft: AnswerDraft, onChange: (draft: AnswerDraft) => void): readonly ChoiceOption[] {
  if (draft.kind === "BOOLEAN") {
    return [true, false].map((value) => ({ key: String(value), label: value ? "是" : "否", checked: draft.value === value, select: () => onChange({ kind: "BOOLEAN", value }) }));
  }
  const options = question.options ?? [];
  if (draft.kind === "CHOICE") {
    return options.map((option, index) => ({ key: String(index), label: displayValue(option), checked: draft.index === index, select: () => onChange({ kind: "CHOICE", index }) }));
  }
  if (draft.kind !== "MULTI") return [];
  return options.map((option, index) => {
    const checked = draft.indices.includes(index);
    const indices = checked ? draft.indices.filter((entry) => entry !== index) : [...draft.indices, index];
    return { key: String(index), label: displayValue(option), checked, select: () => onChange({ kind: "MULTI", indices }) };
  });
}

function FieldsControl({ baseId, draft, describedBy, disabled, onChange }: ControlProps<Extract<AnswerDraft, { kind: "FIELDS" }>>) {
  const update = (index: number, row: FieldRow): void => onChange({ kind: "FIELDS", rows: draft.rows.map((entry, at) => (at === index ? row : entry)) });
  const remove = (index: number): void => onChange({ kind: "FIELDS", rows: draft.rows.filter((_, at) => at !== index) });
  return (
    <div className="fields-control">
      {draft.rows.map((row, index) => (
        <div className="field-row" key={index}>
          <label className="field-row-part">
            <span className="field-label">欄位名稱</span>
            <input className="text-input" value={row.name} disabled={disabled} aria-describedby={describedBy} onChange={(event) => update(index, { ...row, name: event.target.value })} />
          </label>
          <label className="field-row-part">
            <span className="field-label">內容</span>
            <input className="text-input" value={row.value} disabled={disabled} onChange={(event) => update(index, { ...row, value: event.target.value })} />
          </label>
          {draft.rows.length > 1 ? (
            <button type="button" className="btn btn-ghost" disabled={disabled} aria-label={`移除第 ${index + 1} 個欄位`} onClick={() => remove(index)}>
              移除
            </button>
          ) : null}
        </div>
      ))}
      <button type="button" className="btn btn-ghost" id={`${baseId}-add`} disabled={disabled} onClick={() => onChange({ kind: "FIELDS", rows: [...draft.rows, { name: "", value: "" }] })}>
        ＋ 新增欄位
      </button>
    </div>
  );
}

/** One F01-selected question: label / required marker / error are programmatically tied to the control. */
export function QuestionField({ question, number, draft, problem, disabled, onChange }: QuestionFieldProps) {
  const baseId = `question-${number}`;
  const current = draft ?? emptyDraft(question);
  const errorId = problem === undefined ? undefined : `${baseId}-error`;
  const controlProps = { question, baseId, describedBy: errorId, disabled, onChange };
  return (
    <fieldset className={`question${problem === undefined ? "" : " is-invalid"}`} aria-describedby={errorId} data-question-id={question.question_id}>
      <legend id={`${baseId}-legend`} className="question-prompt">
        <span>
          {number}. {question.prompt}
        </span>
        <span className="required-tag">必填</span>
      </legend>
      {current.kind === "TEXT" ? <TextControl {...controlProps} draft={current} /> : null}
      {current.kind === "FIELDS" ? <FieldsControl {...controlProps} draft={current} /> : null}
      {current.kind === "BOOLEAN" || current.kind === "CHOICE" || current.kind === "MULTI" ? (
        <ChoiceList name={baseId} multiple={current.kind === "MULTI"} options={choiceOptions(question, current, onChange)} disabled={disabled} />
      ) : null}
      {errorId === undefined || problem === undefined ? null : (
        <p id={errorId} className="field-error" role="alert">
          {problemText(problem, question)}
        </p>
      )}
    </fieldset>
  );
}
