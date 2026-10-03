import type { GeneratedCapabilityValidator, TypeDescriptor } from "../capabilities/schema/validator-contract.js";
import { canonicalizeJson } from "./canonical-json.js";
import type { NodeGraph } from "./node-graph.js";
import {
  fail,
  type ActionStep,
  type Blueprint,
  type BlueprintNode,
  type CapabilityRef,
  type JsonValue,
  type ResourceUsageReport,
  type ValueSource
} from "./validation-types.js";

/** F02 §19 hard ceilings owned by V09; initial LIST items / STRING chars are V05-owned value domains. */
export const V09_RESOURCE_CEILINGS = {
  blueprintBytes: 262_144,
  nodes: 100,
  stateEntries: 100,
  rules: 100,
  actions: 100,
  stepsPerAction: 16,
  expressionAstNodes: 64,
  expressionDepth: 12,
  typeDescriptorDepth: 12,
  compositeLiteralDepth: 12,
  uiChildDepth: 12,
  repeatDepth: 2,
  initialStateBytes: 131_072,
  eventBindings: 200,
  timers: 10,
  resultOutputs: 50,
  degradations: 50,
  refsPerDegradation: 20,
  childrenPerNode: 100
} as const;

export interface ResourceValidation {
  readonly usage: ResourceUsageReport;
  readonly canonicalJson: string;
  readonly canonicalBytes: Uint8Array;
}

interface Measured {
  readonly value: number;
  readonly path: string;
}

interface CapabilityUsage {
  readonly ref: CapabilityRef;
  readonly budget: GeneratedCapabilityValidator["resource_budget"];
  instances: number;
  propsBytes: number;
  eventBindings: number;
  actionBindings: number;
  timers: number;
}

interface TreeMetrics {
  readonly uiDepth: Measured;
  readonly repeatDepth: Measured;
  readonly instanceBound: ReadonlyMap<string, number>;
}

const ENCODER = new TextEncoder();

function resourceError(path: string, message: string, ref?: CapabilityRef): never {
  return fail("F02-ERR-011", "V09", path, message, ref);
}

function limit(measured: Measured, ceiling: number, label: string, ref?: CapabilityRef): number {
  if (measured.value > ceiling) {
    resourceError(measured.path, `${label} ${measured.value} exceeds ${ceiling}.`, ref);
  }
  return measured.value;
}

function safeAdd(left: number, right: number, path: string): number {
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : resourceError(path, "Resource sum exceeds the safe integer range.");
}

function safeMultiply(left: number, right: number, path: string): number {
  const product = left * right;
  return Number.isSafeInteger(product) ? product : resourceError(path, "Resource product exceeds the safe integer range.");
}

function maxMeasured(current: Measured, candidate: Measured): Measured {
  return candidate.value > current.value ? candidate : current;
}

function firstOver(items: readonly Measured[], ceiling: number): Measured {
  return items.find((item) => item.value > ceiling) ?? items.reduce(maxMeasured, { value: 0, path: "$" });
}

function byteLength(value: unknown): number {
  return ENCODER.encode(canonicalizeJson(value)).byteLength;
}

function compositeLiteralDepth(value: JsonValue): number {
  let deepest = 0;
  const pending: { readonly value: JsonValue; readonly depth: number }[] = [{ value, depth: 1 }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    if (item.value === null || typeof item.value !== "object") {
      continue;
    }
    deepest = Math.max(deepest, item.depth);
    for (const child of Object.values(item.value)) {
      pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return deepest;
}

function descriptorDepth(descriptor: TypeDescriptor): number {
  let deepest = 0;
  const pending: { readonly descriptor: TypeDescriptor; readonly depth: number }[] = [{ descriptor, depth: 1 }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    deepest = Math.max(deepest, item.depth);
    if (item.descriptor.type === "LIST") {
      pending.push({ descriptor: item.descriptor.constraints.item, depth: item.depth + 1 });
    } else if (item.descriptor.type === "RECORD") {
      for (const field of Object.values(item.descriptor.constraints.fields)) {
        pending.push({ descriptor: field, depth: item.depth + 1 });
      }
    }
  }
  return deepest;
}

function stepSources(step: ActionStep, path: string): readonly [ValueSource, string][] {
  if (step.type === "RESET_STATE") {
    return [];
  }
  const when: [ValueSource, string][] = step.when === undefined ? [] : [[step.when, `${path}.when`]];
  if (step.type === "SET_STATE") {
    return [[step.value, `${path}.value`], ...when];
  }
  return [...Object.entries(step.args).map(([key, source]): [ValueSource, string] => [source, `${path}.args.${key}`]), ...when];
}

function nodeSources(node: BlueprintNode, path: string): readonly [ValueSource, string][] {
  const fields = (map: Readonly<Record<string, ValueSource>>, label: string): [ValueSource, string][] =>
    Object.entries(map).map(([key, source]) => [source, `${path}.${label}.${key}`]);
  const repeat: [ValueSource, string][] = node.repeat === undefined ? [] : [[node.repeat.items, `${path}.repeat.items`]];
  return [...fields(node.props, "props"), ...fields(node.bindings, "bindings"), ...repeat];
}

function expressionRoots(blueprint: Blueprint): readonly [ValueSource, string][] {
  const roots: [ValueSource, string][] = [];
  for (const [key, entry] of Object.entries(blueprint.state)) {
    if (entry.mode === "DERIVED") {
      roots.push([entry.expr, `$.state.${key}.expr`]);
    }
  }
  blueprint.rules.forEach((rule, index) => roots.push([rule.expr, `$.rules[${index}].expr`]));
  blueprint.actions.forEach((action, index) =>
    action.steps.forEach((step, stepIndex) => roots.push(...stepSources(step, `$.actions[${index}].steps[${stepIndex}]`)))
  );
  blueprint.nodes.forEach((node, index) => roots.push(...nodeSources(node, `$.nodes[${index}]`)));
  blueprint.result.outputs.forEach((output, index) => roots.push([output.value, `$.result.outputs[${index}].value`]));
  return roots;
}

interface ExpressionMetrics {
  readonly astNodes: Measured[];
  readonly depths: Measured[];
  readonly literalDepths: Measured[];
}

function measureExpressions(blueprint: Blueprint): ExpressionMetrics {
  const metrics: ExpressionMetrics = { astNodes: [], depths: [], literalDepths: [] };
  for (const [root, rootPath] of expressionRoots(blueprint)) {
    let count = 0;
    let deepest = 0;
    const pending: { readonly source: ValueSource; readonly path: string; readonly depth: number }[] = [
      { source: root, path: rootPath, depth: 1 }
    ];
    for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
      count += 1;
      deepest = Math.max(deepest, item.depth);
      const { source, path, depth } = item;
      if (source.kind === "LITERAL") {
        metrics.literalDepths.push({ value: compositeLiteralDepth(source.value), path: `${path}.value` });
      } else if (source.kind === "OP") {
        source.args.forEach((arg, index) => pending.push({ source: arg, path: `${path}.args[${index}]`, depth: depth + 1 }));
      }
    }
    metrics.astNodes.push({ value: count, path: rootPath });
    metrics.depths.push({ value: deepest, path: rootPath });
  }
  return metrics;
}

function measureTree(blueprint: Blueprint, graph: NodeGraph): TreeMetrics {
  const uiDepth = new Map<string, number>();
  const repeatDepth = new Map<string, number>();
  const instanceBound = new Map<string, number>();
  let deepestUi: Measured = { value: 0, path: "$" };
  let deepestRepeat: Measured = { value: 0, path: "$" };
  for (const node of graph.order) {
    const path = `$.nodes[${graph.indexById.get(node.id) as number}]`;
    const parentId = graph.parentById.get(node.id);
    const parent = parentId === undefined ? undefined : blueprint.nodes[graph.indexById.get(parentId) as number];
    const ui = parentId === undefined ? 1 : (uiDepth.get(parentId) as number) + 1;
    const repeats = (parentId === undefined ? 0 : (repeatDepth.get(parentId) as number)) + (node.repeat === undefined ? 0 : 1);
    const parentBound = parentId === undefined ? 1 : (instanceBound.get(parentId) as number);
    uiDepth.set(node.id, ui);
    repeatDepth.set(node.id, repeats);
    instanceBound.set(node.id, safeMultiply(parentBound, parent?.repeat?.max_items ?? 1, path));
    deepestUi = maxMeasured(deepestUi, { value: ui, path });
    deepestRepeat = maxMeasured(deepestRepeat, { value: repeats, path: `${path}.repeat` });
  }
  return { uiDepth: deepestUi, repeatDepth: deepestRepeat, instanceBound };
}

function initialStateBytes(blueprint: Blueprint): number {
  const initial: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, entry] of Object.entries(blueprint.state)) {
    if (entry.mode === "MUTABLE") {
      initial[key] = entry.initial;
    }
  }
  return byteLength(initial);
}

function checkDeclarationCounts(blueprint: Blueprint): void {
  const ceilings = V09_RESOURCE_CEILINGS;
  limit({ value: blueprint.nodes.length, path: "$.nodes" }, ceilings.nodes, "nodes");
  limit({ value: Object.keys(blueprint.state).length, path: "$.state" }, ceilings.stateEntries, "state entries");
  limit({ value: blueprint.rules.length, path: "$.rules" }, ceilings.rules, "rules");
  limit({ value: blueprint.actions.length, path: "$.actions" }, ceilings.actions, "actions");
  const steps = blueprint.actions.map((action, index) => ({ value: action.steps.length, path: `$.actions[${index}].steps` }));
  limit(firstOver(steps, ceilings.stepsPerAction), ceilings.stepsPerAction, "action steps");
}

function checkContainerLengths(blueprint: Blueprint): void {
  const ceilings = V09_RESOURCE_CEILINGS;
  const { degradations } = blueprint.support;
  limit({ value: blueprint.result.outputs.length, path: "$.result.outputs" }, ceilings.resultOutputs, "result outputs");
  limit({ value: degradations.length, path: "$.support.degradations" }, ceilings.degradations, "support degradations");
  const refs = degradations.map((degradation, index) => ({
    value: degradation.capability_refs.length,
    path: `$.support.degradations[${index}].capability_refs`
  }));
  limit(firstOver(refs, ceilings.refsPerDegradation), ceilings.refsPerDegradation, "capability refs per degradation");
  const children = blueprint.nodes.map((node, index) => ({ value: node.children.length, path: `$.nodes[${index}].children` }));
  limit(firstOver(children, ceilings.childrenPerNode), ceilings.childrenPerNode, "children per node");
}

function capabilityUsage(
  blueprint: Blueprint,
  capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>,
  instanceBound: ReadonlyMap<string, number>
): { readonly usages: readonly CapabilityUsage[]; readonly timerCount: number; readonly eventBindings: number } {
  const usages = new Map<string, CapabilityUsage>();
  let timerCount = 0;
  let eventBindings = 0;
  for (const node of blueprint.nodes) {
    const capability = capabilities.get(node.id) as GeneratedCapabilityValidator;
    const key = `${capability.id}@${capability.version}`;
    const usage = usages.get(key) ?? {
      ref: node.capability,
      budget: capability.resource_budget,
      instances: 0,
      propsBytes: 0,
      eventBindings: 0,
      actionBindings: 0,
      timers: 0
    };
    const bound = instanceBound.get(node.id) as number;
    const nodeTimers = safeMultiply(bound, capability.resource_usage.timerSlotsPerInstance, "$.nodes");
    const events = Object.keys(node.events).length;
    usage.instances = safeAdd(usage.instances, bound, "$.nodes");
    usage.propsBytes += byteLength(node.props);
    usage.eventBindings += events;
    usage.timers = safeAdd(usage.timers, nodeTimers, "$.nodes");
    timerCount = safeAdd(timerCount, nodeTimers, "$.nodes");
    eventBindings += events;
    usages.set(key, usage);
  }
  countActionBindings(blueprint, capabilities, usages);
  return { usages: [...usages.values()], timerCount, eventBindings };
}

function countActionBindings(
  blueprint: Blueprint,
  capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>,
  usages: ReadonlyMap<string, CapabilityUsage>
): void {
  for (const action of blueprint.actions) {
    for (const step of action.steps) {
      const target = step.type === "INVOKE_CAPABILITY" ? capabilities.get(step.target_node_id) : undefined;
      const usage = target === undefined ? undefined : usages.get(`${target.id}@${target.version}`);
      if (usage !== undefined) {
        usage.actionBindings += 1;
      }
    }
  }
}

function checkCapabilityBudgets(usages: readonly CapabilityUsage[]): void {
  for (const usage of usages) {
    const { budget, ref } = usage;
    limit({ value: usage.instances, path: "$.nodes" }, budget.maxInstancesPerBlueprint, "capability instances", ref);
    limit({ value: usage.propsBytes, path: "$.nodes" }, budget.maxSerializedPropsBytes, "capability serialized props bytes", ref);
    limit({ value: usage.eventBindings, path: "$.nodes" }, budget.maxEventBindings, "capability event bindings", ref);
    limit({ value: usage.actionBindings, path: "$.actions" }, budget.maxActionBindings, "capability action bindings", ref);
    limit({ value: usage.timers, path: "$.nodes" }, budget.maxConcurrentTimers, "capability concurrent timers", ref);
  }
}

function maxDescriptorDepth(mutable: ReadonlyMap<string, TypeDescriptor>): Measured {
  const depths = [...mutable].map(([key, descriptor]) => ({ value: descriptorDepth(descriptor), path: `$.state.${key}` }));
  return firstOver(depths, V09_RESOURCE_CEILINGS.typeDescriptorDepth);
}

export interface ResourceValidationInput {
  readonly root: Readonly<Record<string, JsonValue>>;
  readonly blueprint: Blueprint;
  readonly mutable: ReadonlyMap<string, TypeDescriptor>;
  readonly graph: NodeGraph;
  readonly capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>;
}

/** V09: every static §19 V09-owned ceiling and every §19.2 static per-Capability budget, in §19 table order. */
export function validateResources(input: ResourceValidationInput): ResourceValidation {
  const { blueprint } = input;
  const ceilings = V09_RESOURCE_CEILINGS;
  const canonicalJson = canonicalizeJson(input.root);
  const canonicalBytes = ENCODER.encode(canonicalJson);
  limit({ value: canonicalBytes.byteLength, path: "$" }, ceilings.blueprintBytes, "canonical Blueprint bytes");
  checkDeclarationCounts(blueprint);
  const expressions = measureExpressions(blueprint);
  const astNodes = limit(firstOver(expressions.astNodes, ceilings.expressionAstNodes), ceilings.expressionAstNodes, "expression AST nodes");
  const depth = limit(firstOver(expressions.depths, ceilings.expressionDepth), ceilings.expressionDepth, "expression depth");
  const literalDepth = limit(
    firstOver(expressions.literalDepths, ceilings.compositeLiteralDepth),
    ceilings.compositeLiteralDepth,
    "composite literal depth"
  );
  const typeDepth = limit(maxDescriptorDepth(input.mutable), ceilings.typeDescriptorDepth, "TypeDescriptor depth");
  const tree = measureTree(blueprint, input.graph);
  const uiDepth = limit(tree.uiDepth, ceilings.uiChildDepth, "UI child depth");
  const repeatDepth = limit(tree.repeatDepth, ceilings.repeatDepth, "repeat depth");
  const initialBytes = limit({ value: initialStateBytes(blueprint), path: "$.state" }, ceilings.initialStateBytes, "initial state bytes");
  const usage = capabilityUsage(blueprint, input.capabilities, tree.instanceBound);
  limit({ value: usage.eventBindings, path: "$.nodes" }, ceilings.eventBindings, "event bindings");
  limit({ value: usage.timerCount, path: "$.nodes" }, ceilings.timers, "concurrent timers");
  checkContainerLengths(blueprint);
  checkCapabilityBudgets(usage.usages);
  return {
    canonicalJson,
    canonicalBytes,
    usage: {
      blueprint_bytes: canonicalBytes.byteLength,
      node_count: blueprint.nodes.length,
      state_count: Object.keys(blueprint.state).length,
      rule_count: blueprint.rules.length,
      action_count: blueprint.actions.length,
      initial_state_bytes: initialBytes,
      event_binding_count: usage.eventBindings,
      timer_count: usage.timerCount,
      max_expression_ast_nodes: astNodes,
      max_expression_depth: depth,
      max_type_descriptor_depth: typeDepth,
      max_composite_literal_depth: literalDepth,
      max_ui_child_depth: uiDepth,
      max_repeat_depth: repeatDepth
    }
  };
}
