import { SOURCE_LABELS, type AssumptionDraft, type DecidableAssumption } from "./assumptions.js";
import type { FieldProblem } from "./creation-session.js";
import type { AssumptionView } from "./f01-wire.js";
import type { NodeProblems } from "./json-draft.js";
import { problemText } from "./QuestionField.js";
import { draftFrom } from "./value-draft.js";
import { ValueEditor } from "./ValueEditor.js";
import { ValueView } from "./ValueView.js";

type AssumptionListProps = {
  readonly assumptions: readonly AssumptionView[];
  /** Ids of the pending items the User may Accept / Edit / Reject in this round. */
  readonly decidableIds: ReadonlySet<string>;
  readonly drafts: Readonly<Record<string, AssumptionDraft>>;
  readonly problems: Readonly<Record<string, FieldProblem>>;
  readonly nodeProblems: NodeProblems;
  readonly disabled: boolean;
  readonly onChange: (assumptionId: string, draft: AssumptionDraft | null) => void;
};

type RowProps = {
  readonly baseId: string;
  readonly draft: AssumptionDraft | undefined;
  readonly problem: FieldProblem | undefined;
  readonly nodeProblems: NodeProblems;
  readonly disabled: boolean;
  readonly onChange: (draft: AssumptionDraft | null) => void;
};

const DECISION_TEXT = { ACCEPT: "已選擇接受", REJECT: "已選擇不使用", EDIT: "修改中" } as const;

function DecisionControls({ assumption, baseId, draft, problem, nodeProblems, disabled, onChange }: RowProps & { readonly assumption: DecidableAssumption }) {
  const toggle = (next: AssumptionDraft): void => onChange(draft?.decision === next.decision ? null : next);
  const errorId = problem === undefined ? undefined : `${baseId}-error`;
  return (
    <>
      <div className="assumption-actions" role="group" aria-label={`${assumption.description}的處理方式`}>
        <button type="button" className="decision-btn" aria-pressed={draft?.decision === "ACCEPT"} disabled={disabled} onClick={() => toggle({ decision: "ACCEPT" })}>
          接受
        </button>
        <button
          type="button"
          className="decision-btn"
          aria-pressed={draft?.decision === "EDIT"}
          aria-expanded={draft?.decision === "EDIT"}
          aria-controls={`${baseId}-editor`}
          disabled={disabled}
          onClick={() => toggle({ decision: "EDIT", value: draftFrom(assumption.shape, assumption.value ?? null) })}
        >
          修改
        </button>
        <button type="button" className="decision-btn" aria-pressed={draft?.decision === "REJECT"} disabled={disabled} onClick={() => toggle({ decision: "REJECT" })}>
          拒絕
        </button>
        {draft === undefined ? null : <span className="decision-status">{DECISION_TEXT[draft.decision]}</span>}
      </div>
      {draft?.decision === "EDIT" ? (
        <div id={`${baseId}-editor`} className="assumption-editor">
          <ValueEditor
            shape={assumption.shape}
            draft={draft.value}
            idBase={`${baseId}-edit`}
            label={`${assumption.description}的新值`}
            describedBy={errorId}
            multiline={false}
            nodeProblems={nodeProblems}
            disabled={disabled}
            onChange={(value) => onChange({ decision: "EDIT", value })}
          />
        </div>
      ) : null}
      {errorId === undefined || problem === undefined ? null : (
        <p id={errorId} className="field-error" role="alert">
          {problemText(problem, assumption.shape, "SETTING")}
        </p>
      )}
    </>
  );
}

function AssumptionRow({ assumption, decidable, ...rowProps }: RowProps & { readonly assumption: AssumptionView; readonly decidable: boolean }) {
  const asked = !decidable && assumption.shape !== null;
  return (
    <li className={`assumption${rowProps.draft?.decision === "REJECT" ? " is-rejected" : ""}`} data-assumption-id={assumption.assumptionId}>
      <div className="assumption-main">
        <span className="assumption-name">{assumption.description}</span>
        <div className="assumption-value">
          <span className="sr-only">目前值：</span>
          <ValueView value={assumption.value} />
        </div>
        <span className="source-tag">
          <span className="sr-only">來源：</span>
          {SOURCE_LABELS[assumption.classification]}
        </span>
      </div>
      {decidable && assumption.shape !== null ? <DecisionControls assumption={{ ...assumption, shape: assumption.shape }} {...rowProps} /> : null}
      {asked ? <p className="assumption-note">請在上方的問題中決定這一項</p> : null}
    </li>
  );
}

/**
 * Visible Assumptions as 設定名稱 | 目前值 | source label. The label always reflects F01's classification —
 * a local Accept / Edit is only a pending choice and never relabels a proposal or default as 已提供.
 */
export function AssumptionList({ assumptions, decidableIds, drafts, problems, nodeProblems, disabled, onChange }: AssumptionListProps) {
  return (
    <ul className="assumption-list" aria-label="目前的設定">
      {assumptions.map((assumption, index) => (
        <AssumptionRow
          key={assumption.assumptionId}
          assumption={assumption}
          decidable={decidableIds.has(assumption.assumptionId)}
          baseId={`assumption-${index + 1}`}
          draft={drafts[assumption.assumptionId]}
          problem={problems[assumption.assumptionId]}
          nodeProblems={nodeProblems}
          disabled={disabled}
          onChange={(draft) => onChange(assumption.assumptionId, draft)}
        />
      ))}
    </ul>
  );
}
