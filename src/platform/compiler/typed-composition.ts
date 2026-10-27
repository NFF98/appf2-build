import { CAPABILITY_REGISTRY_SOURCE } from "../capabilities/registry.js";
import { CapabilityAdmissionError, createCapabilityAdmissionResolver } from "../capabilities/admission.js";
import { computeRegistryDigest } from "../capabilities/generate-registry.js";
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
export type RecordListModule = Base & { readonly kind: "RECORD_LIST"; readonly heading: string; readonly record_title_key: string; readonly record_done_key: string; readonly input_label: string; readonly add_label: string; readonly toggle_label: string; readonly delete_label: string; readonly total_label: string; readonly completed_label: string; readonly max_items: number; readonly track_day?: boolean; readonly priority_filter?: boolean };
/** Interactive local budget: set budget, enter an expense, commit, recompute totals. */
export type BudgetModule = Base & { readonly kind: "BUDGET"; readonly heading: string;
  readonly budget_label: string; readonly expense_label: string; readonly add_expense_label: string;
  readonly spent_label: string; readonly remaining_label: string; readonly initial_budget: number };
export type HabitModule = Base & { readonly kind: "HABIT"; readonly heading: string;
  readonly habit_label: string; readonly complete_label: string; readonly completed_label: string };
export type TodaySummaryModule = Base & { readonly kind: "TODAY_SUMMARY";
  readonly heading: string; readonly source_key: string; readonly total_label: string; readonly completed_label: string };
export type ShoppingModule = Base & { readonly kind: "SHOPPING_LIST";
  readonly heading: string; readonly item_label: string; readonly quantity_label: string;
  readonly add_label: string; readonly bought_label: string; readonly update_quantity_label: string;
  readonly total_label: string; readonly outstanding_label: string; readonly max_items: number };
export type CompositionModule = DisplayModule | FormModule | ArithmeticModule | RecordListModule |
  BudgetModule | HabitModule | TodaySummaryModule | ShoppingModule;
export type CompositionPlan = { readonly plan_version: "1.0.0"; readonly title: string; readonly description?: string; readonly modules: readonly CompositionModule[] };
export type AssemblerContext = { readonly coverage: CoverageResult; readonly validRequirementIds: ReadonlySet<string> };

/** Server-only bounded F04 role closure for typed modules, never model-supplied refs.
 * Does not change a coverage status or user requirement. Every added primitive
 * must pass the canonical F04 admission resolver; independent F02 validation
 * still verifies the resulting exact refs and actual resource use. */
// eslint-disable-next-line complexity -- F04 admission must keep every module-kind guard and fail-closed role check.
export function certifyTypedModuleRoles(coverage: CoverageResult, plan: CompositionPlan): CoverageResult {
  if (coverage.status !== "FULLY_SUPPORTED" || coverage.gaps.length > 0 ||
      coverage.registryVersion !== CAPABILITY_REGISTRY_SOURCE.registryVersion ||
      coverage.registryDigest !== computeRegistryDigest(CAPABILITY_REGISTRY_SOURCE))
    throw new CompositionPlanError("COMPOSITION_UNSUPPORTED", "$.coverage");
  const definitions = CAPABILITY_REGISTRY_SOURCE.capabilities;
  const resolver = createCapabilityAdmissionResolver({
    source: CAPABILITY_REGISTRY_SOURCE,
    trustedRuntimeRegistrationKeys: new Set(definitions.map(x => x.runtime.registrationKey)),
    allowExperimental: false
  });
  const roleIds = new Set<string>(["layout.container", "content.text"]);
  for (const module of plan.modules) {
    if (module.kind === "RECORD_LIST") {
      for (const id of ["content.list", "input.text", "action.button", "data.stat"]) roleIds.add(id);
      if (module.priority_filter === true) roleIds.add("input.select");
    } else if (module.kind === "SHOPPING_LIST") {
      for (const id of ["content.list", "input.text", "input.number", "action.button", "data.stat"]) roleIds.add(id);
    } else if (module.kind === "BUDGET") {
      for (const id of ["input.number", "action.button", "data.stat"]) roleIds.add(id);
    } else if (module.kind === "HABIT") {
      for (const id of ["action.button", "data.stat"]) roleIds.add(id);
    } else if (module.kind === "TODAY_SUMMARY") {
      roleIds.add("data.stat");
    } else if (module.kind === "FORM") {
      if (module.reset_label !== undefined) roleIds.add("action.button");
      for (const field of module.fields)
        roleIds.add(field.kind === "TEXT" ? "input.text" :
          field.kind === "NUMBER" ? "input.number" : "input.toggle");
    } else if (module.kind === "ARITHMETIC") {
      roleIds.add("input.number");
      roleIds.add("data.stat");
    }
  }
  const refs = new Map(coverage.selected.map(ref => [ref.id + "@" + ref.version, ref]));
  for (const id of roleIds) {
    const definition = definitions.find(d => d.id === id && d.lifecycle.availability === "ENABLED" &&
      d.lifecycle.executionStatus === "ACTIVE");
    if (definition === undefined) throw new CompositionPlanError("COMPOSITION_UNSUPPORTED", "$.capability." + id);
    try {
      const approved = resolver.admit({ capability: {id,version:definition.version},
        resourceUsage: {
          maxInstancesPerBlueprint:0, maxSerializedPropsBytes:0,
          maxLocalStateBytes:0, maxEventBindings:0,
          maxActionBindings:0, maxConcurrentTimers:0
        } });
      for(const ref of [approved.capability,...approved.requiredDependencies])
        refs.set(ref.id + "@" + ref.version, ref);
    } catch (error) {
      if (error instanceof CapabilityAdmissionError)
        throw new CompositionPlanError("COMPOSITION_UNSUPPORTED", "$.capability." + id);
      throw error;
    }
  }
  return {...coverage,selected:[...refs.values()]};
}

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
    } else if (kind === "SHOPPING_LIST") {
      shape(m, [...common, "heading", "item_label", "quantity_label", "add_label", "bought_label",
        "update_quantity_label", "total_label", "outstanding_label", "max_items"], [], path);
      for (const keyName of ["heading", "item_label", "quantity_label", "add_label", "bought_label",
        "update_quantity_label", "total_label", "outstanding_label"]) label(m[keyName], path + "." + keyName);
      integer(m.max_items, path + ".max_items", 1, 100);
    } else if (kind === "HABIT") {
      shape(m, [...common, "heading", "habit_label", "complete_label", "completed_label"], [], path);
      for (const keyName of ["heading", "habit_label", "complete_label", "completed_label"])
        label(m[keyName], path + "." + keyName);
    } else if (kind === "TODAY_SUMMARY") {
      shape(m, [...common, "heading", "source_key", "total_label", "completed_label"], [], path);
      for (const keyName of ["heading", "total_label", "completed_label"])
        label(m[keyName], path + "." + keyName);
      ident(m.source_key, path + ".source_key");
      const source = p.modules.slice(0,i).find(x => obj(x,"$.modules").key === m.source_key);
      if (!source || obj(source,"$.modules").kind !== "RECORD_LIST" ||
          obj(source,"$.modules").track_day !== true) fail("PLAN_UNTRUSTED_REFERENCE",path+".source_key");
    } else if (kind === "BUDGET") {
      shape(m, [...common, "heading", "budget_label", "expense_label", "add_expense_label",
        "spent_label", "remaining_label", "initial_budget"], [], path);
      for (const keyName of ["heading", "budget_label", "expense_label", "add_expense_label",
        "spent_label", "remaining_label"]) label(m[keyName], path + "." + keyName);
      numeric(m.initial_budget, path + ".initial_budget");
      if ((m.initial_budget as number) < 0) fail("PLAN_SCHEMA_INVALID", path + ".initial_budget");
    } else if (kind === "RECORD_LIST") {
      shape(m, [...common, "heading", "record_title_key", "record_done_key", "input_label", "add_label", "toggle_label", "delete_label", "total_label", "completed_label", "max_items"], ["track_day", "priority_filter"], path);
      if (m.priority_filter !== undefined && typeof m.priority_filter !== "boolean") fail("PLAN_SCHEMA_INVALID", path + ".priority_filter");
      if (m.track_day !== undefined && typeof m.track_day !== "boolean") fail("PLAN_SCHEMA_INVALID", path + ".track_day");
      for (const keyName of ["heading", "input_label", "add_label", "toggle_label", "delete_label", "total_label", "completed_label"]) label(m[keyName], path + "." + keyName);
      const title = ident(m.record_title_key, path + ".record_title_key"), done = ident(m.record_done_key, path + ".record_done_key");
      if (title === done) fail("PLAN_SCHEMA_INVALID", path + ".record_done_key");
      integer(m.max_items, path + ".max_items", 1, 100);
    } else fail("PLAN_SCHEMA_INVALID", path + ".kind");
  }
  // F02 V09 enforces action.button instances <=100 across the entire
  // Blueprint, including worst-case repeated rows. Prevent a valid-looking
  // multi-module plan from producing an unusable resource-terminal candidate.
  const buttons = p.modules.reduce((sum, rawModule) => {
    const mod = rawModule as CompositionModule;
    if (mod.kind === "RECORD_LIST") return sum + 1 + 3 * mod.max_items;
    if (mod.kind === "SHOPPING_LIST") return sum + 1 + 2 * mod.max_items;
    if (mod.kind === "BUDGET" || mod.kind === "HABIT") return sum + 1;
    if (mod.kind === "FORM" && mod.reset_label !== undefined) return sum + 1;
    return sum;
  }, 0);
  if (buttons > 100) fail("PLAN_SCHEMA_INVALID", "$.modules.max_items");
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
const typeState = (type: "STRING" | "NUMBER" | "BOOLEAN" | "ENUM" | "LIST" | "RECORD", initial: JsonValue, constraints?: JsonValue): StateEntry =>
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
/** Priority filtering is a read-only filtered projection. Mutable row actions stay
 * on the original list, where repeat indices still match actual state indices. */
function priorityListControls(b:Builder,p:string,rows:string,maxItems:number): {
  readonly controls:string[]; readonly masterItems:ValueSource; readonly filteredList:string;
} {
  const options=(values:readonly string[])=>lit(values.map(value=>({label:value,value})));
  const draft="s_"+p+"_draft_priority",filter="s_"+p+"_filter_priority";
  const draftAction="action_"+p+"_priority",filterAction="action_"+p+"_filter";
  b.action(draftAction,[{type:"SET_STATE",target:draft,value:event("value")}]);
  b.action(filterAction,[{type:"SET_STATE",target:filter,value:event("value")}]);
  const select=(id:string,label:string,key:string,choices:readonly string[],actionId:string)=>
    b.node(id,"input.select",{props:{label:lit(label),options:options(choices)},
      bindings:{bind:state(key)},events:{change:actionId}});
  const controls=[
    select("node_"+p+"_priority","Task priority",draft,["High","Medium","Low"],draftAction),
    select("node_"+p+"_filter","Priority filter",filter,["All","High","Medium","Low"],filterAction)
  ];
  const none=op("LIST_FILTER_EQ",state(rows),lit("priority"),lit("All"));
  const all=op("EQ",state(filter),lit("All"));
  const masterItems=op("IF",all,state(rows),none);
  const filteredItems=op("IF",all,none,op("LIST_FILTER_EQ",state(rows),lit("priority"),state(filter)));
  const filteredRow="node_"+p+"_filtered_row";
  layout(b,filteredRow,[
    b.node("node_"+p+"_filtered_title","content.text",{props:{role:lit("BODY")},
      bindings:{text:scope("filtered_item","title")}}),
    b.node("node_"+p+"_filtered_priority","content.text",{props:{role:lit("CAPTION")},
      bindings:{text:scope("filtered_item","priority")}})
  ],true);
  const filteredList=b.node("node_"+p+"_filtered_list","content.list",{
    repeat:{items:filteredItems,item_alias:"filtered_item",index_alias:"filtered_index",max_items:maxItems},
    children:[filteredRow]
  });
  return {controls,masterItems,filteredList};
}

function recordList(b: Builder, p: string, mod: RecordListModule, daily = false): string {
  if (daily && (mod.record_title_key === "completed_day" || mod.record_done_key === "completed_day"))
    fail("PLAN_SCHEMA_INVALID", "$.record_title_key");
  const rows = "s_" + p + "_rows", draft = "s_" + p + "_draft", can = "s_" + p + "_can_add", template = "s_" + p + "_template";
  const recordType: JsonValue = { type: "RECORD", constraints: { fields: {
    [mod.record_title_key]: { type: "STRING", constraints: { max_length: 120 } },
    [mod.record_done_key]: { type: "BOOLEAN" },
    ...(daily ? { completed_day: { type: "STRING", constraints: { max_length: 10 } } } : {}),
    ...(mod.priority_filter === true ? { priority: { type: "STRING", constraints: { max_length: 8 } } } : {})
  } } };
  b.stateKey(rows, typeState("LIST", [], { item: recordType, max_length: mod.max_items }));
  const newRow = { [mod.record_title_key]: "", [mod.record_done_key]: false,
    ...(daily ? { completed_day: "" } : {}),
    ...(mod.priority_filter === true ? { priority: "Medium" } : {}) };
  b.stateKey(template, typeState("RECORD", newRow, (recordType as { constraints: JsonValue }).constraints));
  b.stateKey(draft, typeState("STRING", "", { max_length: 120 }));
  const editDraft = "s_" + p + "_edit_draft";
  b.stateKey(editDraft, typeState("STRING", "", { max_length: 120 }));
  b.stateKey(can, typeState("BOOLEAN", false));
  const priorities = ["High", "Medium", "Low"];
  const draftPriority = "s_" + p + "_draft_priority";
  const filterPriority = "s_" + p + "_filter_priority";
  if (mod.priority_filter === true) {
    b.stateKey(draftPriority,typeState("ENUM","Medium",{allowed:priorities}));
    b.stateKey(filterPriority,typeState("ENUM","All",{allowed:["All",...priorities]}));
  }
  const draftChange = "action_" + p + "_draft_change", add = "action_" + p + "_add",
    toggle = "action_" + p + "_toggle", remove = "action_" + p + "_remove",
    editChange = "action_" + p + "_edit_change", edit = "action_" + p + "_edit";
  b.action(draftChange, [{ type: "SET_STATE", target: draft, value: event("value") }]);
  b.action(editChange, [{ type: "SET_STATE", target: editDraft, value: event("value") }]);
  const allow = op("AND", op("NEQ", op("TRIM", state(draft)), lit("")), op("LT", op("COUNT", state(rows)), lit(mod.max_items)));
  const newTitleRow = op("RECORD_SET", state(template), lit(mod.record_title_key), state(draft));
  const newTaskRow = mod.priority_filter === true ? op("RECORD_SET",newTitleRow,lit("priority"),state(draftPriority)) : newTitleRow;
  b.action(add, [
    { type: "SET_STATE", target: can, value: allow },
    { type: "SET_STATE", target: rows, value: op("LIST_APPEND", state(rows),newTaskRow), when: state(can) },
    { type: "SET_STATE", target: draft, value: lit(""), when: state(can) },
    { type: "RESET_STATE", target: can }
  ]);
  const toggledDone = op("RECORD_SET", scope("item"), lit(mod.record_done_key),
    op("NOT", scope("item", mod.record_done_key)));
  const toggledRow = daily ? op("RECORD_SET", toggledDone, lit("completed_day"),
    op("IF", scope("item", mod.record_done_key), lit(""), op("LOCAL_DAY"))) : toggledDone;
  b.action(toggle, [{ type: "SET_STATE", target: rows, value: op("LIST_REPLACE_AT", state(rows), scope("index"), toggledRow) }]);
  b.action(remove, [{ type: "SET_STATE", target: rows, value: op("LIST_REMOVE_AT", state(rows), scope("index")) }]);
  const hasEdit = op("NEQ", op("TRIM", state(editDraft)), lit(""));
  b.action(edit, [{ type: "SET_STATE", target: rows,
    value: op("LIST_REPLACE_AT", state(rows), scope("index"),
      op("RECORD_SET", scope("item"), lit(mod.record_title_key), state(editDraft))), when: hasEdit }]);
  const total = op("COUNT", state(rows));
  const completed = op("COUNT", op("LIST_FILTER_EQ", state(rows),
    lit(daily ? "completed_day" : mod.record_done_key), daily ? op("LOCAL_DAY") : lit(true)));
  const metricLabel = daily ? "今日完成" : mod.completed_label;
  b.output("result_" + p + "_total", mod.total_label, total);
  b.output("result_" + p + "_completed", metricLabel, completed);
  const rowId = "node_" + p + "_row";
  const rowChildren = [
    b.node("node_" + p + "_item_title", "content.text", { props: { role: lit("BODY") }, bindings: { text: scope("item", mod.record_title_key) } }),
    ...(mod.priority_filter === true ? [b.node("node_" + p + "_item_priority", "content.text", {
      props: { role: lit("CAPTION") }, bindings: { text: scope("item", "priority") }
    })] : []),
    b.node("node_" + p + "_toggle", "action.button", { props: { label: lit(mod.toggle_label) }, events: { press: toggle } }),
    b.node("node_" + p + "_edit", "action.button", { props: { label: lit("Edit selected item") },
      bindings: { disabled: op("NOT", hasEdit) }, events: { press: edit } }),
    b.node("node_" + p + "_remove", "action.button", { props: { label: lit(mod.delete_label) }, events: { press: remove } })
  ];
  layout(b, rowId, rowChildren, true);
  const priorityControls = mod.priority_filter === true ? priorityListControls(b,p,rows,mod.max_items) : undefined;
  const children = [
    titleNode(b, "node_" + p + "_heading", mod.heading),
    b.node("node_" + p + "_input", "input.text", { props: { label: lit(mod.input_label), max_length: lit(120) }, bindings: { bind: state(draft) }, events: { change: draftChange } }),
    b.node("node_" + p + "_edit_input", "input.text", { props: { label: lit("New title for selected item"), max_length: lit(120) },
      bindings: { bind: state(editDraft) }, events: { change: editChange } }),
    b.node("node_" + p + "_add", "action.button", { props: { label: lit(mod.add_label) }, events: { press: add } }),
    b.node("node_" + p + "_total", "data.stat", { props: { label: lit(mod.total_label), format: lit("NUMBER") }, bindings: { value: total } }),
    b.node("node_" + p + "_completed", "data.stat", { props: { label: lit(metricLabel), format: lit("NUMBER") }, bindings: { value: completed } }),
    ...(priorityControls === undefined ? [] : priorityControls.controls),
    b.node("node_" + p + "_list", "content.list", { repeat: {
      items: priorityControls === undefined ? state(rows) : priorityControls.masterItems,
      item_alias: "item", index_alias: "index", max_items: mod.max_items }, children: [rowId] }),
    ...(priorityControls === undefined ? [] : [priorityControls.filteredList])
  ];
  return layout(b, "node_" + p + "_container", children);
}
/** Both number inputs are live; spending is committed only by pressing Add.
 * The balance and total share actual mutable state, not duplicate card text. */
function budgetModule(b: Builder, p: string, mod: BudgetModule): string {
  const budget = formField(b, p + "_budget", {
    kind: "NUMBER", key: "budget", label: mod.budget_label,
    min: 0, max: 1000000, initial: mod.initial_budget
  }, 0);
  const expense = formField(b, p + "_expense", {
    kind: "NUMBER", key: "expense", label: mod.expense_label,
    min: 0, max: 1000000, initial: 0
  }, 0);
  const spent = "s_" + p + "_spent";
  b.stateKey(spent, typeState("NUMBER", 0));
  const add = "action_" + p + "_add_expense";
  b.action(add, [
    { type: "SET_STATE", target: spent,
      value: op("ADD", state(spent), state(expense.state)), when: op("GT", state(expense.state), lit(0)) },
    { type: "SET_STATE", target: expense.state, value: lit(0), when: op("GT", state(expense.state), lit(0)) }
  ]);
  const remaining = op("SUB", state(budget.state), state(spent));
  b.output("result_" + p + "_spent", mod.spent_label, state(spent));
  b.output("result_" + p + "_remaining", mod.remaining_label, remaining);
  return layout(b, "node_" + p + "_container", [
    titleNode(b, "node_" + p + "_heading", mod.heading),
    budget.node, expense.node,
    b.node("node_" + p + "_add_expense", "action.button", {
      props: { label: lit(mod.add_expense_label) }, events: { press: add }
    }),
    b.node("node_" + p + "_spent", "data.stat", {
      props: { label: lit(mod.spent_label), format: lit("NUMBER") },
      bindings: { value: state(spent) }
    }),
    b.node("node_" + p + "_remaining", "data.stat", {
      props: { label: lit(mod.remaining_label), format: lit("NUMBER") },
      bindings: { value: remaining }
    })
  ]);
}

/** A real device-local-day completion flag and derived counter, not static text. */
function habitModule(b: Builder, p: string, mod: HabitModule): string {
  const completedDay = "s_" + p + "_completed_day";
  b.stateKey(completedDay, typeState("STRING", "", { max_length: 10 }));
  const today = op("LOCAL_DAY");
  const completed = op("IF", op("EQ", state(completedDay), today), lit(1), lit(0));
  const action = "action_" + p + "_complete";
  b.action(action, [{ type: "SET_STATE", target: completedDay,
    value: op("IF", op("EQ", state(completedDay), today), lit(""), today) }]);
  b.output("result_" + p + "_completed", mod.completed_label, completed);
  return layout(b, "node_" + p + "_container", [
    titleNode(b, "node_" + p + "_heading", mod.heading),
    b.node("node_" + p + "_habit", "content.text", {
      props: { role: lit("BODY") }, bindings: { text: lit(mod.habit_label) }
    }),
    b.node("node_" + p + "_complete", "action.button", {
      props: { label: lit(mod.complete_label) }, events: { press: action }
    }),
    b.node("node_" + p + "_completed", "data.stat", {
      props: { label: lit(mod.completed_label), format: lit("NUMBER") }, bindings: { value: completed }
    })
  ]);
}
/** A live total / daily progress view of an earlier explicitly linked task module. */
function todaySummaryModule(b: Builder, p: string, mod: TodaySummaryModule,
  modules: readonly CompositionModule[]): string {
  const index = modules.findIndex(module => module.kind === "RECORD_LIST" && module.key === mod.source_key);
  if (index < 0 || modules[index]?.kind !== "RECORD_LIST" || modules[index].track_day !== true)
    fail("PLAN_UNTRUSTED_REFERENCE", "$.modules.source_key");
  const linked = "s_m" + String(index).padStart(3,"0") + "_rows";
  const total = op("COUNT", state(linked));
  const completed = op("COUNT", op("LIST_FILTER_EQ", state(linked), lit("completed_day"), op("LOCAL_DAY")));
  b.output("result_" + p + "_total", mod.total_label, total);
  b.output("result_" + p + "_completed", mod.completed_label, completed);
  return layout(b, "node_" + p + "_container", [
    titleNode(b, "node_" + p + "_heading", mod.heading),
    b.node("node_" + p + "_total", "data.stat", {
      props: { label: lit(mod.total_label), format: lit("NUMBER") }, bindings: { value: total }
    }),
    b.node("node_" + p + "_completed", "data.stat", {
      props: { label: lit(mod.completed_label), format: lit("NUMBER") }, bindings: { value: completed }
    })
  ]);
}

/** Per-row safe shopping CRUD, with a bounded quantity editor that updates
 * ONLY the pressed row's original list index. No filtered-index writes. */
function shoppingModule(b: Builder, p: string, mod: ShoppingModule): string {
  const rows = "s_" + p + "_rows", title = "s_" + p + "_title",
    quantity = "s_" + p + "_quantity", allowed = "s_" + p + "_allowed";
  const itemType: JsonValue = { type: "RECORD", constraints: { fields: {
    title: { type: "STRING", constraints: { max_length: 120 } },
    quantity: { type: "NUMBER" },
    purchased: { type: "BOOLEAN" }
  } } };
  b.stateKey(rows,typeState("LIST",[],{item:itemType,max_length:mod.max_items}));
  b.stateKey(title,typeState("STRING","",{max_length:120}));
  b.stateKey(quantity,typeState("NUMBER",1));
  b.stateKey(allowed,typeState("BOOLEAN",false));
  const template = "s_" + p + "_template";
  b.stateKey(template,typeState("RECORD",{title:"",quantity:1,purchased:false},
    (itemType as {constraints:JsonValue}).constraints));
  const titleAction = "action_" + p + "_title", quantityAction = "action_" + p + "_quantity",
    add = "action_" + p + "_add", toggle = "action_" + p + "_toggle",
    update = "action_" + p + "_update_quantity";
  b.action(titleAction,[{type:"SET_STATE",target:title,value:event("value")}]);
  b.action(quantityAction,[{type:"SET_STATE",target:quantity,value:event("value"),
    when:op("AND",op("GTE",event("value"),lit(1)),op("LTE",event("value"),lit(1000)))}]);
  const canAdd = op("AND", op("NEQ",op("TRIM",state(title)),lit("")),
    op("LT",op("COUNT",state(rows)),lit(mod.max_items)));
  const newRow = op("RECORD_SET",op("RECORD_SET",state(template),lit("title"),state(title)),
    lit("quantity"),state(quantity));
  b.action(add,[
    {type:"SET_STATE",target:allowed,value:canAdd},
    {type:"SET_STATE",target:rows,value:op("LIST_APPEND",state(rows),newRow),when:state(allowed)},
    {type:"SET_STATE",target:title,value:lit(""),when:state(allowed)},
    {type:"RESET_STATE",target:allowed}
  ]);
  const toggleRow = op("RECORD_SET",scope("item"),lit("purchased"),op("NOT",scope("item","purchased")));
  b.action(toggle,[{type:"SET_STATE",target:rows,value:op("LIST_REPLACE_AT",state(rows),scope("index"),toggleRow)}]);
  const changed = op("RECORD_SET",scope("item"),lit("quantity"),state(quantity));
  b.action(update,[{type:"SET_STATE",target:rows,value:op("LIST_REPLACE_AT",state(rows),scope("index"),changed)}]);
  const total = op("COUNT",state(rows));
  const outstanding = op("COUNT",op("LIST_FILTER_EQ",state(rows),lit("purchased"),lit(false)));
  b.output("result_" + p + "_total",mod.total_label,total);
  b.output("result_" + p + "_outstanding",mod.outstanding_label,outstanding);
  const rowNode = "node_" + p + "_row";
  layout(b,rowNode,[
    b.node("node_" + p + "_item_title","content.text",{
      props:{role:lit("BODY")},bindings:{text:scope("item","title")}
    }),
    b.node("node_" + p + "_item_quantity","data.stat",{
      props:{label:lit(mod.quantity_label),format:lit("NUMBER")},bindings:{value:scope("item","quantity")}
    }),
    b.node("node_" + p + "_toggle","action.button",{
      props:{label:lit(mod.bought_label)},events:{press:toggle}
    }),
    b.node("node_" + p + "_update_quantity","action.button",{
      props:{label:lit(mod.update_quantity_label)},events:{press:update}
    })
  ],true);
  return layout(b,"node_" + p + "_container",[
    titleNode(b,"node_" + p + "_heading",mod.heading),
    b.node("node_" + p + "_input","input.text",{
      props:{label:lit(mod.item_label),max_length:lit(120)},
      bindings:{bind:state(title)},events:{change:titleAction}
    }),
    b.node("node_" + p + "_quantity","input.number",{
      props:{label:lit(mod.quantity_label),min:lit(1),max:lit(1000)},
      bindings:{bind:state(quantity)},events:{change:quantityAction}
    }),
    b.node("node_" + p + "_add","action.button",{props:{label:lit(mod.add_label)},events:{press:add}}),
    b.node("node_" + p + "_total","data.stat",{
      props:{label:lit(mod.total_label),format:lit("NUMBER")},bindings:{value:total}
    }),
    b.node("node_" + p + "_outstanding","data.stat",{
      props:{label:lit(mod.outstanding_label),format:lit("NUMBER")},bindings:{value:outstanding}
    }),
    b.node("node_" + p + "_list","content.list",{
      repeat:{items:state(rows),item_alias:"item",index_alias:"index",max_items:mod.max_items},children:[rowNode]
    })
  ]);
}
function moduleBlueprint(b: Builder, mod: CompositionModule, i: number): string {
  const p = "m" + String(i).padStart(3, "0");
  if (mod.kind === "RECORD_LIST") return recordList(b, p, mod);
  if (mod.kind === "BUDGET") return budgetModule(b, p, mod);
  if (mod.kind === "HABIT") return habitModule(b, p, mod);
  if (mod.kind === "SHOPPING_LIST") return shoppingModule(b, p, mod);
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
  if (mod.kind !== "ARITHMETIC") fail("PLAN_SCHEMA_INVALID", "$.modules.kind");
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
  const childIds = plan.modules.map((mod, i) => {
    const p = "m" + String(i).padStart(3,"0");
    if (mod.kind === "TODAY_SUMMARY") return todaySummaryModule(b, p, mod, plan.modules);
    if (mod.kind === "RECORD_LIST") return recordList(b, p, mod,
      context.coverage.certifiedProfile === "RECORD_LIST_TODAY" || mod.track_day === true);
    return moduleBlueprint(b, mod, i);
  });
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
