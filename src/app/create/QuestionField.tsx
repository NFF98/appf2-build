import type { FieldProblem } from "./creation-session.js";
import type { EditShape } from "./edit-shape.js";
import type { QuestionView } from "./f01-wire.js";
import type { NodeProblems } from "./json-draft.js";
import { emptyDraft, type ValueDraft } from "./value-draft.js";
import { ValueEditor } from "./ValueEditor.js";

type QuestionFieldProps = {
  readonly question: QuestionView;
  readonly number: number;
  readonly draft: ValueDraft | undefined;
  readonly problem: FieldProblem | undefined;
  readonly nodeProblems: NodeProblems;
  readonly disabled: boolean;
  readonly onChange: (draft: ValueDraft) => void;
};

export function problemText(problem: FieldProblem, shape: EditShape, subject: "ANSWER" | "SETTING"): string {
  switch (problem) {
    case "REQUIRED":
      return subject === "ANSWER" ? "請回答這一題" : "請先選擇或填入一個值";
    case "INVALID_FIELDS":
      return "請修正標示的欄位";
    case "SERVER_REJECTED":
      return subject === "ANSWER" ? "這個回答無法使用，請修改後再試" : "這個設定無法使用，請修改後再試";
    case "TYPE_MISMATCH":
      return shape.valueType === "NUMBER" ? "請輸入有效的數字" : "這個值的格式不正確";
  }
}

/** One F01-selected question: label / required marker / error are programmatically tied to the control. */
export function QuestionField({ question, number, draft, problem, nodeProblems, disabled, onChange }: QuestionFieldProps) {
  const baseId = `question-${number}`;
  const errorId = problem === undefined ? undefined : `${baseId}-error`;
  return (
    <fieldset className={`question${problem === undefined ? "" : " is-invalid"}`} aria-describedby={errorId} data-question-id={question.questionId}>
      <legend className="question-prompt">
        <span>
          {number}. {question.prompt}
        </span>
        <span className="required-tag">必填</span>
      </legend>
      <ValueEditor
        shape={question.shape}
        draft={draft ?? emptyDraft(question.shape)}
        idBase={baseId}
        label={question.prompt}
        describedBy={errorId}
        multiline
        nodeProblems={nodeProblems}
        disabled={disabled}
        onChange={onChange}
      />
      {errorId === undefined || problem === undefined ? null : (
        <p id={errorId} className="field-error" role="alert">
          {problemText(problem, question.shape, "ANSWER")}
        </p>
      )}
    </fieldset>
  );
}
