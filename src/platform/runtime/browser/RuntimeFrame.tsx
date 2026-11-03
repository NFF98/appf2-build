import { Children, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { nodeInstanceKeyId } from "../node-instance-key.js";
import type { NodeIsolationRecord, NodeRenderInput, RuntimeInstance, RuntimeNodeRenderer } from "../runtime-instance.js";
import { isRuntimeRecord, type RuntimeRecord, type RuntimeValue } from "../runtime-value.js";
import { displayValue } from "./display-value.js";
import { feedbackForOperation, feedbackForRejection } from "./runtime-action-feedback.js";

type Dispatch = (input: NodeRenderInput<ReactNode>, eventName: string, payload: RuntimeValue) => void;

const FALLBACK_COPY = "這個區塊暫時無法顯示，App 的其他部分仍可使用。";
const TEXT_TAGS = { HEADING: "h2", LABEL: "p", CAPTION: "p", BODY: "p" } as const;

const asString = (value: RuntimeValue | undefined): string | undefined => (typeof value === "string" ? value : undefined);
const asNumber = (value: RuntimeValue | undefined): number | undefined => (typeof value === "number" ? value : undefined);

function NumberField({ input, dispatch }: { readonly input: NodeRenderInput<ReactNode>; readonly dispatch: Dispatch }) {
  const committed = asNumber(input.bindings.bind);
  const [draft, setDraft] = useState(committed === undefined ? "" : String(committed));
  useEffect(() => setDraft(committed === undefined ? "" : String(committed)), [committed]);
  return (
    <label className="rt-field">
      <span className="rt-field-label">{asString(input.props.label)}</span>
      <input
        className="rt-input"
        type="number"
        inputMode="decimal"
        value={draft}
        min={asNumber(input.props.min)}
        max={asNumber(input.props.max)}
        step={asNumber(input.props.step) ?? "any"}
        required={input.props.required === true}
        onChange={(event) => {
          setDraft(event.target.value);
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) dispatch(input, "change", { value });
        }}
      />
    </label>
  );
}

function TextField({ input, dispatch }: { readonly input: NodeRenderInput<ReactNode>; readonly dispatch: Dispatch }) {
  return (
    <label className="rt-field">
      <span className="rt-field-label">{asString(input.props.label)}</span>
      <input
        className="rt-input"
        type="text"
        value={asString(input.bindings.bind) ?? ""}
        maxLength={asNumber(input.props.max_length)}
        placeholder={asString(input.props.placeholder)}
        required={input.props.required === true}
        onChange={(event) => dispatch(input, "change", { value: event.target.value })}
      />
    </label>
  );
}

function SelectField({ input, dispatch }: { readonly input: NodeRenderInput<ReactNode>; readonly dispatch: Dispatch }) {
  const options = Array.isArray(input.props.options) ? input.props.options.filter(isRuntimeRecord) : [];
  return (
    <label className="rt-field">
      <span className="rt-field-label">{asString(input.props.label)}</span>
      <select
        className="rt-input"
        value={String(input.bindings.bind ?? "")}
        required={input.props.required === true}
        onChange={(event) => dispatch(input, "change", { value: event.target.value })}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {asString(option.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

function DataTable({ input }: { readonly input: NodeRenderInput<ReactNode> }) {
  const columns = Array.isArray(input.props.columns) ? input.props.columns.filter(isRuntimeRecord) : [];
  const rows = Array.isArray(input.bindings.rows) ? input.bindings.rows.filter(isRuntimeRecord) : [];
  const shown = rows.slice(0, asNumber(input.props.max_rows) ?? rows.length);
  return (
    <div className="rt-table-wrap">
      <table className="rt-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={String(column.key)} scope="col">
                {asString(column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={String(column.key)}>{displayValue(row[String(column.key)])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Presentation of the Runtime-owned timer: re-reads the monotonic observation while running, never ticks state. */
function TimerView({ runtime, input }: { readonly runtime: RuntimeInstance; readonly input: NodeRenderInput<ReactNode> }) {
  const observation = runtime.timerObservation(input.node_instance_key);
  const armed = observation !== undefined;
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!armed) return undefined;
    const handle = globalThis.setInterval(() => setFrame((frame) => frame + 1), 250);
    return () => globalThis.clearInterval(handle);
  }, [armed]);
  const state: RuntimeRecord | undefined = runtime.readCapabilityState(input.node_instance_key);
  const remaining = observation?.remaining_ms ?? asNumber(state?.remaining_ms) ?? 0;
  return (
    <output className="rt-timer" aria-live="off">
      {Math.ceil(remaining / 1000)}
    </output>
  );
}

function capabilityOutput(runtime: RuntimeInstance, input: NodeRenderInput<ReactNode>): ReactNode {
  const state = runtime.readCapabilityState(input.node_instance_key);
  const value = input.capability.id === "logic.score" ? state?.value : (state?.last_item ?? state?.last_number);
  return value === undefined ? null : (
    <output className="rt-output" aria-live="polite">
      {displayValue(value)}
    </output>
  );
}

type NodeView = (runtime: RuntimeInstance, input: NodeRenderInput<ReactNode>, dispatch: Dispatch) => ReactNode;

const optionalText = (value: RuntimeValue | undefined, className: string, Tag: "h3" | "p" = "p"): ReactNode =>
  value === undefined ? null : <Tag className={className}>{asString(value)}</Tag>;

/** Trusted S03 renderers keyed by F04 capability id; an unknown id throws so F03 isolates that node. */
const NODE_VIEWS: Readonly<Record<string, NodeView>> = {
  "layout.container": (_runtime, { props, children }) => (
    <div className={`rt-container rt-dir-${String(props.direction)} rt-gap-${String(props.gap)} rt-align-${String(props.align)}`}>{children}</div>
  ),
  "content.text": (_runtime, { props, bindings }) => {
    const Tag = TEXT_TAGS[(asString(props.role) ?? "BODY") as keyof typeof TEXT_TAGS] ?? "p";
    return <Tag className={`rt-text rt-text-${String(props.role)}`}>{asString(bindings.text)}</Tag>;
  },
  "content.card": (_runtime, { bindings, children }) => (
    <section className="rt-card">
      {optionalText(bindings.title, "rt-card-title", "h3")}
      {optionalText(bindings.description, "rt-card-description")}
      {children}
    </section>
  ),
  "content.list": (_runtime, { children }) => (
    <ul className="rt-list">{Children.map(children, (child) => <li className="rt-list-item">{child}</li>)}</ul>
  ),
  "action.button": (_runtime, input, dispatch) => (
    <button type="button" className="rt-button" disabled={input.bindings.disabled === true} onClick={() => dispatch(input, "press", {})}>
      {asString(input.props.label)}
    </button>
  ),
  "input.number": (_runtime, input, dispatch) => <NumberField input={input} dispatch={dispatch} />,
  "input.text": (_runtime, input, dispatch) => <TextField input={input} dispatch={dispatch} />,
  "input.select": (_runtime, input, dispatch) => <SelectField input={input} dispatch={dispatch} />,
  "input.toggle": (_runtime, input, dispatch) => (
    <input
      className="rt-toggle"
      type="checkbox"
      role="switch"
      checked={input.bindings.bind === true}
      onChange={(event) => dispatch(input, "change", { value: event.target.checked })}
    />
  ),
  "data.stat": (_runtime, { props, bindings }) => (
    <div className="rt-stat">
      <span className="rt-stat-label">{asString(props.label)}</span>
      <strong className="rt-stat-value">{displayValue(bindings.value)}</strong>
    </div>
  ),
  "data.table_basic": (_runtime, input) => <DataTable input={input} />,
  "system.notice": (_runtime, { props, bindings }) => {
    const severity = asString(props.severity) ?? "INFO";
    return (
      <div className={`rt-notice rt-notice-${severity}`} role={severity === "ERROR" || severity === "WARNING" ? "alert" : "status"}>
        {optionalText(bindings.title, "rt-notice-title")}
        <p>{asString(bindings.message)}</p>
      </div>
    );
  },
  "logic.timer": (runtime, input) => <TimerView runtime={runtime} input={input} />,
  "logic.score": capabilityOutput,
  "logic.random": capabilityOutput
};

function renderNode(runtime: RuntimeInstance, input: NodeRenderInput<ReactNode>, dispatch: Dispatch): ReactNode {
  const view = Object.hasOwn(NODE_VIEWS, input.capability.id) ? NODE_VIEWS[input.capability.id] : undefined;
  if (view === undefined) throw new Error("No trusted renderer for this capability.");
  return view(runtime, input, dispatch);
}

function keyed(input: NodeRenderInput<ReactNode>, node: ReactNode): ReactNode {
  return (
    <div key={`${nodeInstanceKeyId(input.node_instance_key)}#${input.lifecycle_generation}`} className="rt-node">
      {node}
    </div>
  );
}

/**
 * S03 Generated App Runtime Frame. Every pass renders committed F03 state through `renderTree`; controls only
 * dispatch declared events with the Runtime-issued node instance key, so the Shell never writes App state.
 */
export function RuntimeFrame({ runtime }: { readonly runtime: RuntimeInstance }) {
  const [, refreshCalendar] = useState(0);
  const hasCalendar = useMemo(() => JSON.stringify(runtime.blueprint ?? {}).includes('"LOCAL_DAY"'), [runtime]);
  useEffect(() => {
    if (!hasCalendar) return undefined;
    const handle = globalThis.setInterval(() => refreshCalendar(value => value + 1), 60_000);
    return () => globalThis.clearInterval(handle);
  }, [hasCalendar]);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  // Only a committed F03 operation clears the error. Failed/rejected actions
  // never look like successful state changes in the generated App.
  useEffect(() => runtime.subscribeOperations((projection) => {
    const message = feedbackForOperation(projection.status);
    if (message !== undefined) setActionFeedback(message);
  }), [runtime]);
  const subscribe = useMemo(() => (onChange: () => void) => runtime.subscribe(() => onChange()), [runtime]);
  useSyncExternalStore(subscribe, () => runtime.actionSequence);
  const renderer = useMemo((): RuntimeNodeRenderer<ReactNode> => {
    const dispatch: Dispatch = (input, eventName, payload) => {
      const receipt = runtime.dispatch({
        source_node_instance_key: input.node_instance_key,
        event_name: eventName,
        payload,
        origin: "USER",
        lifecycle_generation: input.lifecycle_generation
      });
      if (!receipt.accepted) setActionFeedback(feedbackForRejection(receipt.reason));
    };
    return {
      render: (input) => keyed(input, renderNode(runtime, input, dispatch)),
      fallback: (isolation: NodeIsolationRecord) => (
        <div key={`${nodeInstanceKeyId(isolation.node_instance_key)}#fallback`} className="rt-fallback" role="status">
          {FALLBACK_COPY}
        </div>
      )
    };
  }, [runtime]);
  return <div className="runtime-frame">
    {actionFeedback !== null && <div className="rt-notice rt-notice-ERROR" role="alert">{actionFeedback}</div>}
    {runtime.renderTree(renderer)}
  </div>;
}
