import { CAPABILITY_REGISTRY_SOURCE } from "../capabilities/registry.js";
import type { CoverageResult } from "../capabilities/coverage.js";
import type { JsonValue } from "../intent/json-value.js";
import type { Blueprint, BlueprintNode, BlueprintAction, ValueSource, StateEntry } from "../blueprint/validation-types.js";
import { BLUEPRINT_SCHEMA_VERSION } from "../blueprint/validation-types.js";

/** BD-026 CompositionPlanV1: provider data never contains raw F02 graph, code or trusted capability refs. */
type Base = { readonly key: string; readonly requirement_ids: readonly string[] };
export type DisplayModule = Base & { readonly kind: "DISPLAY"; readonly heading: string; readonly body: string };
export type FormField =
  | { readonly kind: "TEXT"; readonly key: string; readonly label: string; readonly max_length: number; readonly initial: string; readonly placeholder?: string }
  | { readonly kind: "NUMBER"; readonly key: string; readonly label: string; readonly min: number; readonly max: number; readonly initial: number }
  | { readonly kind: "TOGGLE"; readonly key: string; readonly label: string; readonly initial: boolean };
export type FormModule = Base & { readonly kind: "FORM"; readonly heading: string; readonly fields: readonly FormField[]; readonly reset_label?: string };
export type ArithmeticModule = Base & { readonly kind: "ARITHMETIC"; readonly heading: string; readonly left_label: string; readonly right_label: string; readonly result_label: string; readonly operation: "ADD" | "SUB" | "MUL"; readonly initial_left: number; readonly initial_right: number };
export type RecordListModule = Base & { readonly kind: "RECORD_LIST"; readonly heading: string; readonly record_title_key: string; readonly record_done_key: string; readonly input_label: string; readonly add_label: string; readonly toggle_label: string; readonly delete_label: string; readonly total_label: string; readonly completed_label: string; readonly max_items: number };
export type CompositionModule = DisplayModule | FormModule | ArithmeticModule | RecordListModule;
export type CompositionPlan = { readonly plan_version: "1.0.0"; readonly title: string; readonly description?: string; readonly modules: readonly CompositionModule[] };
export type AssemblerContext = { readonly coverage: CoverageResult; readonly validRequirementIds: ReadonlySet<string> };

export class CompositionPlanError extends Error {
  public constructor(public readonly code: "PLAN_SCHEMA_INVALID" | "PLAN_UNTRUSTED_REFERENCE" | "COMPOSITION_UNSUPPORTED" | "LOWERING_GRAPH_INVALID", public readonly path: string) {
    super(code + " at " + path); this.name = "CompositionPlanError";
  }
}
function fail(code: CompositionPlanError["code"], path: string): never { throw new CompositionPlanError(code, path); }
function obj(v: unknown, path: string): Record<string, unknown> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return fail("PLAN_SCHEMA_INVALID", path);
  return v as Record<string, unknown>;
}
function shape(v: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
  for (const field of required) if (!Object.hasOwn(v, field)) fail("PLAN_SCHEMA_INVALID", path + "." + field);
  for (const field of Object.keys(v)) if (![...required, ...optional].includes(field)) fail("PLAN_SCHEMA_INVALID", path + "." + field);
}
function label(v: unknown, path: string, max = 120): string {
  if (typeof v !== "string" || v.length < 1 || v.length > max) return fail("PLAN_SCHEMA_INVALID", path);
  return v;
}
function ident(v: unknown, path: string): string {
  if (typeof v !== "string" || !/^[a-z][a-z0-9_]{0,39}$/.test(v) || /^(?:nff_|sys_|__)/.test(v)) return fail("PLAN_SCHEMA_INVALID", path);
  return v;
}
function integer(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) return fail("PLAN_SCHEMA_INVALID", path);
  return v;
}
function numeric(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1000000) return fail("PLAN_SCHEMA_INVALID", path);
  return v;
}
function validateField(raw: unknown, path: string): FormField {
  const f = obj(raw, path);
  ident(f.key, path + ".key"); label(f.label, path + ".label");
  if (f.kind === "TEXT") {
    shape(f, ["kind", "key", "label", "max_length", "initial"], ["placeholder"], path);
    const max = integer(f.max_length, path + ".max_length", 1, 120);
    if (typeof f.initial !== "string" || f.initial.length > max) fail("PLAN_SCHEMA_INVALID", path + ".initial");
    if (f.placeholder !== undefined) label(f.placeholder, path + ".placeholder");
  } else if (f.kind === "NUMBER") {
    shape(f, ["kind", "key", "label", "min", "max", "initial"], [], path);
    const min = numeric(f.min, path + ".min"), max = numeric(f.max, path + ".max");
    const initial = numeric(f.initial, path + ".initial");
    if (min > max || initial < min || initial > max) fail("PLAN_SCHEMA_INVALID", path + ".initial");
  } else if (f.kind === "TOGGLE") {
    shape(f, ["kind", "key", "label", "initial"], [], path);
    if (typeof f.initial !== "boolean") fail("PLAN_SCHEMA_INVALID", path + ".initial");
  } else fail("PLAN_SCHEMA_INVALID", path + ".kind");
  return f as FormField;
}
/** Parser is strict on every key/range; trusted requirement IDs never come from the provider. */
// eslint-disable-next-line complexity -- Closed BD-026 plan schema validation explicitly checks all four discriminated module contracts.
export function parseCompositionPlan(raw: JsonValue, trusted: ReadonlySet<string>, required: ReadonlySet<string> = new Set()): CompositionPlan {
  const p = obj(raw, "$");
  shape(p, ["plan_version", "title", "modules"], ["description"], "$");
  if (p.plan_version !== "1.0.0") fail("PLAN_SCHEMA_INVALID", "$.plan_version");
  label(p.title, "$.title");
  if (p.description !== undefined && (typeof p.description !== "string" || p.description.length > 500)) fail("PLAN_SCHEMA_INVALID", "$.description");
  if (!Array.isArray(p.modules) || p.modules.length < 1 || p.modules.length > 12) fail("PLAN_SCHEMA_INVALID", "$.modules");
  const keys = new Set<string>();
  for (const [i, rawModule] of p.modules.entries()) {
    const path = "$.modules[" + i + "]", m = obj(rawModule, path), kind = m.kind;
    const key = ident(m.key, path + ".key");
    if (keys.has(key)) fail("PLAN_SCHEMA_INVALID", path + ".key");
    keys.add(key);
    if (!Array.isArray(m.requirement_ids) || m.requirement_ids.length < 1 || m.requirement_ids.length > 12) fail("PLAN_SCHEMA_INVALID", path + ".requirement_ids");
    const rids = new Set<string>();
    for (const rid of m.requirement_ids) {
      if (typeof rid !== "string" || !/^sha256:[0-9a-f]{64}$/.test(rid) || rids.has(rid)) fail("PLAN_SCHEMA_INVALID", path + ".requirement_ids");
      if (!trusted.has(rid)) fail("PLAN_UNTRUSTED_REFERENCE", path + ".requirement_ids");
      rids.add(rid);
    }
    const common = ["kind", "key", "requirement_ids"];
    if (kind === "DISPLAY") {
      shape(m, [...common, "heading", "body"], [], path);
      label(m.heading, path + ".heading"); label(m.body, path + ".body", 8192);
    } else if (kind === "FORM") {
      shape(m, [...common, "heading", "fields"], ["reset_label"], path);
      label(m.heading, path + ".heading");
      if (!Array.isArray(m.fields) || m.fields.length < 1 || m.fields.length > 8) fail("PLAN_SCHEMA_INVALID", path + ".fields");
      const fieldKeys = new Set<string>();
      for (const [j, field] of m.fields.entries()) {
        const item = validateField(field, path + ".fields[" + j + "]");
        if (fieldKeys.has(item.key)) fail("PLAN_SCHEMA_INVALID", path + ".fields[" + j + "].key");
        fieldKeys.add(item.key);
      }
      if (m.reset_label !== undefined) label(m.reset_label, path + ".reset_label");
    } else if (kind === "ARITHMETIC") {
      shape(m, [...common, "heading", "left_label", "right_label", "result_label", "operation", "initial_left", "initial_right"], [], path);
      for (const keyName of ["heading", "left_label", "right_label", "result_label"]) label(m[keyName], path + "." + keyName);
      if (!["ADD", "SUB", "MUL"].includes(String(m.operation))) fail("PLAN_SCHEMA_INVALID", path + ".operation");
      numeric(m.initial_left, path + ".initial_left"); numeric(m.initial_right, path + ".initial_right");
    } else if (kind === "RECORD_LIST") {
      shape(m, [...common, "heading", "record_title_key", "record_done_key", "input_label", "add_label", "toggle_label", "delete_label", "total_label", "completed_label", "max_items"], [], path);
      for (const keyName of ["heading", "input_label", "add_label", "toggle_label", "delete_label", "total_label", "completed_label"]) label(m[keyName], path + "." + keyName);
      const title = ident(m.record_title_key, path + ".record_title_key"), done = ident(m.record_done_key, path + ".record_done_key");
      if (title === done) fail("PLAN_SCHEMA_INVALID", path + ".record_done_key");
      integer(m.max_items, path + ".max_items", 1, 100);
    } else fail("PLAN_SCHEMA_INVALID", path + ".kind");
  }
  const covered = new Set<string>();
  for (const module of p.modules) for (const id of (module as CompositionModule).requirement_ids) covered.add(id);
  for (const id of required) if (!covered.has(id)) fail("PLAN_UNTRUSTED_REFERENCE", "$.modules.requirement_ids");
  return p as CompositionPlan;
}
const lit = (value: JsonValue): ValueSource => ({ kind: "LITERAL", value });
const state = (key: string): ValueSource => ({ kind: "STATE", key });
const scope = (name: string, path = ""): ValueSource => ({ kind: "SCOPE", name, path });
const event = (path: string): ValueSource => ({ kind: "EVENT", path });
const op = (operator: string, ...args: ValueSource[]): ValueSource => ({ kind: "OP", op: operator, args });
const typeState = (type: "STRING" | "NUMBER" | "BOOLEAN" | "LIST" | "RECORD", initial: JsonValue, constraints?: JsonValue): StateEntry =>
  constraints === undefined ? { mode: "MUTABLE", type, initial } : { mode: "MUTABLE", type, initial, constraints };
const pageProps = () => ({ direction: lit("COLUMN"), gap: lit("MD"), align: lit("STRETCH") });
const rowProps = () => ({ direction: lit("ROW"), gap: lit("SM"), align: lit("CENTER") });

/** F04-selected exact refs only, never made up by model or lowerer. */
class Builder {
  public readonly nodes: BlueprintNode[] = [];
  public readonly actions: BlueprintAction[] = [];
  public readonly state: Record<string, StateEntry> = Object.create(null) as Record<string, StateEntry>;
  public readonly results: Blueprint["result"]["outputs"][number][] = [];
  private readonly roleRefs: ReadonlyMap<string, { id: string; version: string }>;
  public constructor(selected: CoverageResult["selected"]) {
    this.roleRefs = new Map(selected.map(ref => [ref.id, ref]));
  }
  // eslint-disable-next-line complexity -- Safety-critical F04 selected/ref/availability and structural contract checks remain atomic.
  public node(id: string, capability: string, fields: Partial<Pick<BlueprintNode, "props" | "bindings" | "events" | "children" | "repeat">> = {}): string {
    const ref = this.roleRefs.get(capability);
    const registered = CAPABILITY_REGISTRY_SOURCE.capabilities.find(x => x.id === capability && x.version === ref?.version);
    if (!ref || !registered || registered.lifecycle.availability !== "ENABLED" || registered.lifecycle.executionStatus !== "ACTIVE") fail("COMPOSITION_UNSUPPORTED", "$.capability." + capability);
    const contract = registered.contract.validator;
    if (fields.repeat && !contract.composition.repeat) fail("LOWERING_GRAPH_INVALID", id + ".repeat");
    if ((fields.children?.length ?? 0) > 0 && !contract.composition.children) fail("LOWERING_GRAPH_INVALID", id + ".children");
    this.nodes.push({ id, capability: { ...ref }, props: fields.props ?? {}, bindings: fields.bindings ?? {}, events: fields.events ?? {}, children: fields.children ?? [], ...(fields.repeat === undefined ? {} : { repeat: fields.repeat }) });
    return id;
  }
  public action(id: string, steps: BlueprintAction["steps"]): string { this.actions.push({ id, steps }); return id; }
  public stateKey(key: string, entry: StateEntry): string { if (Object.hasOwn(this.state, key)) fail("LOWERING_GRAPH_INVALID", key); this.state[key] = entry; return key; }
  public output(id: string, label: string, value: ValueSource): void { this.results.push({ id, label, value, sensitivity: "NORMAL" }); }
}
function titleNode(b: Builder, id: string, heading: string): string {
  return b.node(id, "content.text", { props: { role: lit("HEADING") }, bindings: { text: lit(heading) } });
}
function layout(b: Builder, id: string, children: string[], row = false): string {
  return b.node(id, "layout.container", { props: row ? rowProps() : pageProps(), children });
}
function formField(b: Builder, prefix: string, field: FormField, ordinal: number): { node: string; state: string } {
  const idx = String(ordinal).padStart(2, "0"), prefixKey = prefix + "_f" + idx;
  const dataKey = "s_" + prefixKey, actionId = "action_" + prefixKey + "_change", nodeId = "node_" + prefixKey;
  if (field.kind === "TEXT") b.stateKey(dataKey, typeState("STRING", field.initial, { max_length: field.max_length }));
  if (field.kind === "NUMBER") b.stateKey(dataKey, typeState("NUMBER", field.initial));
  if (field.kind === "TOGGLE") b.stateKey(dataKey, typeState("BOOLEAN", field.initial));
  const within = field.kind === "NUMBER" ? op("AND",
    op("GTE", event("value"), lit(field.min)), op("LTE", event("value"), lit(field.max))) : undefined;
  b.action(actionId, [{ type: "SET_STATE", target: dataKey, value: event("value"),
    ...(within === undefined ? {} : { when: within }) }]);
  const cap = field.kind === "TEXT" ? "input.text" : field.kind === "NUMBER" ? "input.number" : "input.toggle";
  const props: Record<string, ValueSource> = {};
  if (field.kind === "TEXT") {
    props.label = lit(field.label); props.max_length = lit(field.max_length);
    if (field.placeholder !== undefined) props.placeholder = lit(field.placeholder);
  }
  if (field.kind === "NUMBER") {
    props.label = lit(field.label); props.min = lit(field.min); props.max = lit(field.max);
  }
  b.node(nodeId, cap, { props, bindings: { bind: state(dataKey) }, events: { change: actionId } });
  return { node: nodeId, state: dataKey };
}
function recordList(b: Builder, p: string, mod: RecordListModule, daily = false): string {
  if (daily && (mod.record_title_key === "completed_day" || mod.record_done_key === "completed_day"))
    fail("PLAN_SCHEMA_INVALID", "$.record_title_key");
  const rows = "s_" + p + "_rows", draft = "s_" + p + "_draft", can = "s_" + p + "_can_add", template = "s_" + p + "_template";
  const recordType: JsonValue = { type: "RECORD", constraints: { fields: {
    [mod.record_title_key]: { type: "STRING", constraints: { max_length: 120 } },
    [mod.record_done_key]: { type: "BOOLEAN" },
    ...(daily ? { completed_day: { type: "STRING", constraints: { max_length: 10 } } } : {})
  } } };
  b.stateKey(rows, typeState("LIST", [], { item: recordType, max_length: mod.max_items }));
  const newRow = { [mod.record_title_key]: "", [mod.record_done_key]: false,
    ...(daily ? { completed_day: "" } : {}) };
  b.stateKey(template, typeState("RECORD", newRow, (recordType as { constraints: JsonValue }).constraints));
  b.stateKey(draft, typeState("STRING", "", { max_length: 120 }));
  b.stateKey(can, typeState("BOOLEAN", false));
  const draftChange = "action_" + p + "_draft_change", add = "action_" + p + "_add",
    toggle = "action_" + p + "_toggle", remove = "action_" + p + "_remove";
  b.action(draftChange, [{ type: "SET_STATE", target: draft, value: event("value") }]);
  const allow = op("AND", op("NEQ", op("TRIM", state(draft)), lit("")), op("LT", op("COUNT", state(rows)), lit(mod.max_items)));
  b.action(add, [
    { type: "SET_STATE", target: can, value: allow },
    { type: "SET_STATE", target: rows, value: op("LIST_APPEND", state(rows), op("RECORD_SET", state(template), lit(mod.record_title_key), state(draft))), when: state(can) },
    { type: "SET_STATE", target: draft, value: lit(""), when: state(can) },
    { type: "RESET_STATE", target: can }
  ]);
  const toggledDone = op("RECORD_SET", scope("item"), lit(mod.record_done_key),
    op("NOT", scope("item", mod.record_done_key)));
  const toggledRow = daily ? op("RECORD_SET", toggledDone, lit("completed_day"),
    op("IF", scope("item", mod.record_done_key), lit(""), op("LOCAL_DAY"))) : toggledDone;
  b.action(toggle, [{ type: "SET_STATE", target: rows, value: op("LIST_REPLACE_AT", state(rows), scope("index"), toggledRow) }]);
  b.action(remove, [{ type: "SET_STATE", target: rows, value: op("LIST_REMOVE_AT", state(rows), scope("index")) }]);
  const total = op("COUNT", state(rows));
  const completed = op("COUNT", op("LIST_FILTER_EQ", state(rows),
    lit(daily ? "completed_day" : mod.record_done_key), daily ? op("LOCAL_DAY") : lit(true)));
  const metricLabel = daily ? "今日完成" : mod.completed_label;
  b.output("result_" + p + "_total", mod.total_label, total);
  b.output("result_" + p + "_completed", metricLabel, completed);
  const rowId = "node_" + p + "_row";
  const rowChildren = [
    b.node("node_" + p + "_item_title", "content.text", { props: { role: lit("BODY") }, bindings: { text: scope("item", mod.record_title_key) } }),
    b.node("node_" + p + "_toggle", "action.button", { props: { label: lit(mod.toggle_label) }, events: { press: toggle } }),
    b.node("node_" + p + "_remove", "action.button", { props: { label: lit(mod.delete_label) }, events: { press: remove } })
  ];
  layout(b, rowId, rowChildren, true);
  const children = [
    titleNode(b, "node_" + p + "_heading", mod.heading),
    b.node("node_" + p + "_input", "input.text", { props: { label: lit(mod.input_label), max_length: lit(120) }, bindings: { bind: state(draft) }, events: { change: draftChange } }),
    b.node("node_" + p + "_add", "action.button", { props: { label: lit(mod.add_label) }, events: { press: add } }),
    b.node("node_" + p + "_total", "data.stat", { props: { label: lit(mod.total_label), format: lit("NUMBER") }, bindings: { value: total } }),
    b.node("node_" + p + "_completed", "data.stat", { props: { label: lit(metricLabel), format: lit("NUMBER") }, bindings: { value: completed } }),
    b.node("node_" + p + "_list", "content.list", { repeat: { items: state(rows), item_alias: "item", index_alias: "index", max_items: mod.max_items }, children: [rowId] })
  ];
  return layout(b, "node_" + p + "_container", children);
}
function moduleBlueprint(b: Builder, mod: CompositionModule, i: number): string {
  const p = "m" + String(i).padStart(3, "0");
  if (mod.kind === "RECORD_LIST") return recordList(b, p, mod);
  if (mod.kind === "DISPLAY") {
    return layout(b, "node_" + p + "_container", [titleNode(b, "node_" + p + "_heading", mod.heading),
      b.node("node_" + p + "_body", "content.text", { props: { role: lit("BODY") }, bindings: { text: lit(mod.body) } })]);
  }
  if (mod.kind === "FORM") {
    const children = [titleNode(b, "node_" + p + "_heading", mod.heading)];
    const fields = mod.fields.map((field, j) => formField(b, p, field, j));
    children.push(...fields.map(f => f.node));
    if (mod.reset_label !== undefined) {
      const reset = b.action("action_" + p + "_reset", fields.map(f => ({ type: "RESET_STATE", target: f.state })));
      children.push(b.node("node_" + p + "_reset", "action.button", { props: { label: lit(mod.reset_label) }, events: { press: reset } }));
    }
    return layout(b, "node_" + p + "_container", children);
  }
  const left = formField(b, p, { kind: "NUMBER", key: "left", label: mod.left_label, min: -1000000, max: 1000000, initial: mod.initial_left }, 0);
  const right = formField(b, p, { kind: "NUMBER", key: "right", label: mod.right_label, min: -1000000, max: 1000000, initial: mod.initial_right }, 1);
  const answer = op(mod.operation, state(left.state), state(right.state));
  b.output("result_" + p + "_answer", mod.result_label, answer);
  return layout(b, "node_" + p + "_container", [
    titleNode(b, "node_" + p + "_heading", mod.heading), left.node, right.node,
    b.node("node_" + p + "_answer", "data.stat", { props: { label: lit(mod.result_label), format: lit("NUMBER") }, bindings: { value: answer } })
  ]);
}
/** Always a single connected rooted graph, full eleven-key F02 Blueprint and exact F04-selected refs. */
export function lowerCompositionPlan(plan: CompositionPlan, context: AssemblerContext): Blueprint {
  // Call the same strict parser even for TypeScript callers (untrusted model output may be cast).
  parseCompositionPlan(plan as unknown as JsonValue, context.validRequirementIds);
  if (context.coverage.status !== "FULLY_SUPPORTED" && context.coverage.status !== "PARTIALLY_SUPPORTED")
    fail("COMPOSITION_UNSUPPORTED", "$.coverage");
  const b = new Builder(context.coverage.selected);
  const childIds = plan.modules.map((mod, i) =>
    mod.kind === "RECORD_LIST" ? recordList(b, "m" + String(i).padStart(3, "0"), mod,
      context.coverage.certifiedProfile === "RECORD_LIST_TODAY") : moduleBlueprint(b, mod, i));
  layout(b, "node_root", childIds);
  // Sorted DFS means same canonical inputs produce identical serialized Blueprint, not model-defined node IDs.
  const index = new Map(b.nodes.map(n => [n.id, n]));
  const visited = new Set<string>(), ordered: BlueprintNode[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) fail("LOWERING_GRAPH_INVALID", "$.nodes." + id);
    const node = index.get(id);
    if (!node) fail("LOWERING_GRAPH_INVALID", "$.nodes." + id);
    visited.add(id); ordered.push(node);
    for (const child of node.children) visit(child);
  };
  visit("node_root");
  if (visited.size !== b.nodes.length) fail("LOWERING_GRAPH_INVALID", "$.nodes");
  return {
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    registry_version: context.coverage.registryVersion,
    kind: "APP",
    meta: { title: plan.title, ...(plan.description === undefined ? {} : { description: plan.description }) },
    support: { coverage_status: context.coverage.status, degradations: [] },
    state: b.state,
    rules: [],
    actions: b.actions,
    nodes: ordered,
    root_node_id: "node_root",
    result: { outputs: b.results }
  };
}
