import { useEffect, useState } from "react";

import {
  changeKind,
  emptyField,
  emptyNode,
  hasProblemWithin,
  NODE_KINDS,
  type FieldNode,
  type JsonNode,
  type NodeKind,
  type NodeProblem,
  type NodeProblems
} from "./json-draft.js";

const KIND_LABELS: Readonly<Record<NodeKind, string>> = {
  STRING: "文字",
  NUMBER: "數字",
  BOOLEAN: "是非",
  NULL: "空值",
  LIST: "清單",
  RECORD: "欄位組"
};

const NODE_PROBLEM_TEXT: Readonly<Record<NodeProblem, string>> = {
  FIELD_NAME_REQUIRED: "請輸入欄位名稱",
  FIELD_NAME_DUPLICATE: "欄位名稱不可重複",
  NUMBER_INVALID: "請輸入有效的數字",
  BOOLEAN_REQUIRED: "請選擇是或否"
};

type Shared = { readonly problems: NodeProblems; readonly disabled: boolean };

function ProblemText({ id, problem }: { readonly id: string; readonly problem: NodeProblem | undefined }) {
  if (problem === undefined) return null;
  return (
    <p id={id} className="field-error" role="alert">
      {NODE_PROBLEM_TEXT[problem]}
    </p>
  );
}

/** Explicit value-type choice (F01-DATA-004A RECORD rule 2): a type only changes when the User picks one. */
function KindSelect({ value, label, disabled, onChange }: { readonly value: NodeKind; readonly label: string; readonly disabled: boolean; readonly onChange: (kind: NodeKind) => void }) {
  return (
    <select className="kind-select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as NodeKind)}>
      {NODE_KINDS.map((kind) => (
        <option key={kind} value={kind}>
          {KIND_LABELS[kind]}
        </option>
      ))}
    </select>
  );
}

function BooleanNode({ node, label, problems, disabled, onChange }: Shared & { readonly node: Extract<JsonNode, { kind: "BOOLEAN" }>; readonly label: string; readonly onChange: (node: JsonNode) => void }) {
  const problem = problems[node.id];
  return (
    <>
      <div className="choice-list choice-list-inline" role="radiogroup" aria-label={label} aria-describedby={problem === undefined ? undefined : `${node.id}-error`}>
        {[true, false].map((flag) => (
          <label key={String(flag)} className={`choice${node.value === flag ? " is-selected" : ""}`}>
            <input type="radio" name={node.id} checked={node.value === flag} disabled={disabled} onChange={() => onChange({ ...node, value: flag })} />
            <span className="choice-indicator" aria-hidden="true" />
            <span className="choice-label">{flag ? "是" : "否"}</span>
          </label>
        ))}
      </div>
      <ProblemText id={`${node.id}-error`} problem={problem} />
    </>
  );
}

function TextNode({ node, label, problems, disabled, onChange }: Shared & { readonly node: Extract<JsonNode, { kind: "STRING" | "NUMBER" }>; readonly label: string; readonly onChange: (node: JsonNode) => void }) {
  const problem = problems[node.id];
  return (
    <>
      <input
        className="text-input node-input"
        type="text"
        inputMode={node.kind === "NUMBER" ? "decimal" : "text"}
        aria-label={label}
        value={node.text}
        disabled={disabled}
        aria-invalid={problem !== undefined}
        aria-describedby={problem === undefined ? undefined : `${node.id}-error`}
        onChange={(event) => onChange({ ...node, text: event.target.value })}
      />
      <ProblemText id={`${node.id}-error`} problem={problem} />
    </>
  );
}

function ListItems({ node, label, problems, disabled, onChange }: Shared & { readonly node: Extract<JsonNode, { kind: "LIST" }>; readonly label: string; readonly onChange: (node: JsonNode) => void }) {
  const update = (index: number, item: JsonNode): void => onChange({ ...node, items: node.items.map((entry, at) => (at === index ? item : entry)) });
  return (
    <div className="list-items" role="group" aria-label={label}>
      {node.items.length === 0 ? <p className="node-empty">目前沒有項目</p> : null}
      <ol className="list-item-list">
        {node.items.map((item, index) => {
          const itemLabel = `${label} 第 ${index + 1} 項`;
          return (
            <li key={item.id} className="list-item">
              <div className="node-head">
                <KindSelect value={item.kind} label={`${itemLabel}的型別`} disabled={disabled} onChange={(kind) => update(index, changeKind(item, kind))} />
                <button type="button" className="btn btn-ghost btn-compact" aria-label={`移除${itemLabel}`} disabled={disabled} onClick={() => onChange({ ...node, items: node.items.filter((_, at) => at !== index) })}>
                  移除
                </button>
              </div>
              <NodeEditor node={item} label={itemLabel} problems={problems} disabled={disabled} onChange={(next) => update(index, next)} />
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn-ghost btn-compact" aria-label={`在${label}新增項目`} disabled={disabled} onClick={() => onChange({ ...node, items: [...node.items, emptyNode("STRING")] })}>
        ＋ 新增項目
      </button>
    </div>
  );
}

/** Nested LIST / RECORD: progressive disclosure, collapsed until the User opens it or it holds a problem. */
function CompositeNode({ node, label, problems, disabled, onChange }: Shared & { readonly node: Extract<JsonNode, { kind: "LIST" | "RECORD" }>; readonly label: string; readonly onChange: (node: JsonNode) => void }) {
  const [open, setOpen] = useState(false);
  const flagged = hasProblemWithin(node, problems);
  useEffect(() => {
    if (flagged) setOpen(true);
  }, [flagged]);
  const summary = node.kind === "LIST" ? `清單，${node.items.length} 項` : `欄位組，${node.fields.length} 個欄位`;
  const bodyId = `${node.id}-body`;
  return (
    <div className="node-composite">
      <button type="button" className="node-toggle" aria-expanded={open} aria-controls={bodyId} aria-label={`${label}（${summary}）`} onClick={() => setOpen(!open)}>
        <span className="node-toggle-icon" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        <span>{summary}</span>
      </button>
      <div id={bodyId} className="node-body" hidden={!open}>
        {node.kind === "LIST" ? (
          <ListItems node={node} label={label} problems={problems} disabled={disabled} onChange={onChange} />
        ) : (
          <RecordFields fields={node.fields} label={label} problems={problems} disabled={disabled} onChange={(fields) => onChange({ ...node, fields })} />
        )}
      </div>
    </div>
  );
}

function NodeEditor({ node, label, problems, disabled, onChange }: Shared & { readonly node: JsonNode; readonly label: string; readonly onChange: (node: JsonNode) => void }) {
  const shared = { label, problems, disabled, onChange };
  switch (node.kind) {
    case "STRING":
    case "NUMBER":
      return <TextNode node={node} {...shared} />;
    case "BOOLEAN":
      return <BooleanNode node={node} {...shared} />;
    case "NULL":
      return <span className="node-null">空值</span>;
    case "LIST":
    case "RECORD":
      return <CompositeNode node={node} {...shared} />;
  }
}

function FieldRow({ field, position, context, problems, disabled, onChange, onRemove }: Shared & {
  readonly field: FieldNode;
  readonly position: number;
  readonly context: string;
  readonly onChange: (field: FieldNode) => void;
  readonly onRemove: () => void;
}) {
  const problem = problems[field.id];
  const errorId = `${field.id}-error`;
  const ordinal = `第 ${position} 個欄位`;
  const valueLabel = `${context} › ${field.name.trim().length > 0 ? field.name : ordinal}`;
  return (
    <li className="record-field">
      <div className="node-head">
        <input
          className="text-input field-name"
          type="text"
          aria-label={`${context}的${ordinal}名稱`}
          placeholder="欄位名稱"
          value={field.name}
          disabled={disabled}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : errorId}
          onChange={(event) => onChange({ ...field, name: event.target.value })}
        />
        <KindSelect value={field.value.kind} label={`${context}的${ordinal}型別`} disabled={disabled} onChange={(kind) => onChange({ ...field, value: changeKind(field.value, kind) })} />
        <button type="button" className="btn btn-ghost btn-compact" aria-label={`移除${context}的${ordinal}`} disabled={disabled} onClick={onRemove}>
          移除
        </button>
      </div>
      <ProblemText id={errorId} problem={problem} />
      <NodeEditor node={field.value} label={valueLabel} problems={problems} disabled={disabled} onChange={(value) => onChange({ ...field, value })} />
    </li>
  );
}

/**
 * OPEN_JSON_RECORD_V1 editor: User-defined field names (add / remove / rename) with an explicitly typed value
 * each. Starting fields are only initial content — never a key whitelist or a required-field schema.
 */
export function RecordFields({ fields, label, problems, disabled, onChange }: Shared & {
  readonly fields: readonly FieldNode[];
  readonly label: string;
  readonly onChange: (fields: readonly FieldNode[]) => void;
}) {
  const update = (index: number, field: FieldNode): void => onChange(fields.map((entry, at) => (at === index ? field : entry)));
  return (
    <div className="record-fields" role="group" aria-label={label}>
      {fields.length === 0 ? <p className="node-empty">目前沒有欄位</p> : null}
      <ul className="record-field-list">
        {fields.map((field, index) => (
          <FieldRow
            key={field.id}
            field={field}
            position={index + 1}
            context={label}
            problems={problems}
            disabled={disabled}
            onChange={(next) => update(index, next)}
            onRemove={() => onChange(fields.filter((_, at) => at !== index))}
          />
        ))}
      </ul>
      <button type="button" className="btn btn-ghost btn-compact" aria-label={`在${label}新增欄位`} disabled={disabled} onClick={() => onChange([...fields, emptyField()])}>
        ＋ 新增欄位
      </button>
    </div>
  );
}
