import { displayValue } from "./answer-drafts.js";
import { editorKindOf, isDecidable, presentedValue, SOURCE_LABELS, startEdit, type AssumptionDraft, type EditorKind } from "./assumptions.js";
import type { FieldProblem } from "./creation-session.js";
import type { VisibleAssumptionView } from "./f01-wire.js";

type AssumptionListProps = {
  readonly assumptions: readonly VisibleAssumptionView[];
  readonly drafts: Readonly<Record<string, AssumptionDraft>>;
  readonly problems: Readonly<Record<string, FieldProblem>>;
  readonly disabled: boolean;
  readonly onChange: (assumptionId: string, draft: AssumptionDraft | null) => void;
};

type RowProps = {
  readonly assumption: VisibleAssumptionView;
  readonly baseId: string;
  readonly draft: AssumptionDraft | undefined;
  readonly problem: FieldProblem | undefined;
  readonly disabled: boolean;
  readonly onChange: (draft: AssumptionDraft | null) => void;
};

type EditDraft = Extract<AssumptionDraft, { decision: "EDIT" }>;

function ValueEditor({ kind, baseId, draft, invalid, disabled, onChange }: { readonly kind: EditorKind; readonly baseId: string; readonly draft: EditDraft; readonly invalid: boolean; readonly disabled: boolean; readonly onChange: (draft: AssumptionDraft) => void }) {
  if (kind === "BOOLEAN") {
    return (
      <div className="choice-list choice-list-inline" role="radiogroup" aria-labelledby={`${baseId}-name`}>
        {[true, false].map((flag) => (
          <label key={String(flag)} className={`choice${draft.flag === flag ? " is-selected" : ""}`}>
            <input type="radio" name={`${baseId}-flag`} checked={draft.flag === flag} disabled={disabled} onChange={() => onChange({ ...draft, flag })} />
            <span className="choice-indicator" aria-hidden="true" />
            <span className="choice-label">{flag ? "是" : "否"}</span>
          </label>
        ))}
      </div>
    );
  }
  return (
    <input
      className="text-input"
      type="text"
      inputMode={kind === "NUMBER" ? "decimal" : "text"}
      value={draft.text}
      disabled={disabled}
      aria-labelledby={`${baseId}-name`}
      aria-invalid={invalid}
      aria-describedby={invalid ? `${baseId}-error` : undefined}
      onChange={(event) => onChange({ ...draft, text: event.target.value })}
    />
  );
}

const DECISION_TEXT = { ACCEPT: "已選擇接受", REJECT: "已選擇不使用", EDIT: "修改中" } as const;

function AssumptionRow({ assumption, baseId, draft, problem, disabled, onChange }: RowProps) {
  const kind = editorKindOf(assumption);
  const decidable = isDecidable(assumption);
  const value = displayValue(presentedValue(assumption));
  const toggle = (next: AssumptionDraft): void => onChange(draft?.decision === next.decision ? null : next);
  return (
    <li className={`assumption${draft?.decision === "REJECT" ? " is-rejected" : ""}`} data-assumption-id={assumption.assumption_id}>
      <div className="assumption-main">
        <span id={`${baseId}-name`} className="assumption-name">
          {assumption.description}
        </span>
        {draft?.decision === "EDIT" && kind !== null ? (
          <ValueEditor kind={kind} baseId={baseId} draft={draft} invalid={problem !== undefined} disabled={disabled} onChange={onChange} />
        ) : (
          <span className="assumption-value">{value.length > 0 ? value : "—"}</span>
        )}
        <span className="source-tag">{SOURCE_LABELS[assumption.classification]}</span>
      </div>
      {decidable ? (
        <div className="assumption-actions" role="group" aria-label={`${assumption.description}的處理方式`}>
          <button type="button" className="decision-btn" aria-pressed={draft?.decision === "ACCEPT"} disabled={disabled} onClick={() => toggle({ decision: "ACCEPT" })}>
            接受
          </button>
          <button type="button" className="decision-btn" aria-pressed={draft?.decision === "EDIT"} disabled={disabled || kind === null} onClick={() => toggle(startEdit(assumption))}>
            修改
          </button>
          <button type="button" className="decision-btn" aria-pressed={draft?.decision === "REJECT"} disabled={disabled} onClick={() => toggle({ decision: "REJECT" })}>
            拒絕
          </button>
          {draft === undefined ? null : <span className="decision-status">{DECISION_TEXT[draft.decision]}</span>}
        </div>
      ) : null}
      {problem === undefined ? null : (
        <p id={`${baseId}-error`} className="field-error" role="alert">
          {problem === "SERVER_REJECTED" ? "這個設定無法使用，請修改後再試" : "請輸入有效的值"}
        </p>
      )}
    </li>
  );
}

/**
 * Visible Assumptions as 設定名稱 | 目前值 | source label. The label always reflects F01's classification —
 * a local Accept / Edit is only a pending choice and never relabels an LLM / NFF proposal as 已提供.
 */
export function AssumptionList({ assumptions, drafts, problems, disabled, onChange }: AssumptionListProps) {
  return (
    <ul className="assumption-list">
      {assumptions.map((assumption, index) => (
        <AssumptionRow
          key={assumption.assumption_id}
          assumption={assumption}
          baseId={`assumption-${index + 1}`}
          draft={drafts[assumption.assumption_id]}
          problem={problems[assumption.assumption_id]}
          disabled={disabled}
          onChange={(draft) => onChange(assumption.assumption_id, draft)}
        />
      ))}
    </ul>
  );
}
