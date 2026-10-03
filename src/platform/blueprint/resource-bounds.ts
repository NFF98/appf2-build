import type { ResourceBudget } from "../capabilities/schema/capability-definition.js";
import type {
  GeneratedCapabilityValidator,
  TypeDescriptor
} from "../capabilities/schema/validator-contract.js";
import { canonicalizeJson } from "./canonical-json.js";
import type { NodeGraph } from "./node-graph.js";
import { compareCodePoints } from "./type-descriptor.js";
import {
  fail,
  type ActionStep,
  type Blueprint,
  type BlueprintNode,
  type BlueprintResourceUsage,
  type CapabilityRef,
  type JsonValue,
  type ValueSource
} from "./validation-types.js";

const F02_GLOBAL_CEILINGS = {
  blueprintBytes: 262_144,
  nodes: 100,
  stateEntries: 100,
  rules: 100,
  actions: 100,
  stepsPerAction: 16,
  expressionAstNodes: 64,
  expressionDepth: 12,
  descriptorDepth: 12,
  compositeLiteralDepth: 12,
  uiChildDepth: 12,
  repeatDepth: 2,
  initialStateBytes: 131_072,
  eventBindings: 200,
  concurrentTimers: 10,
  resultOutputs: 50,
  degradations: 50,
  refsPerDegradation: 20,
  childrenPerNode: 100
} as const;

type BudgetDimension = Exclude<keyof ResourceBudget, "mediaAutoplayAllowed" | "networkAccessAllowed" | "maxLocalStateBytes">;

interface CapabilityLoad {
  readonly ref: CapabilityRef;
  readonly capability: GeneratedCapabilityValidator;
  readonly path: string;
  readonly totals: Record<BudgetDimension, number>;
}

interface GlobalCheck {
  readonly value: number;
  readonly limit: number;
  readonly path: string;
}

export interface ResourceMeasurementInput {
  readonly blueprint: Blueprint;
  readonly blueprintBytes: number;
  readonly mutableDescriptors: ReadonlyMap<string, TypeDescriptor>;
  readonly graph: NodeGraph;
  readonly capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>;
}

export interface ResourceMeasurement {
  readonly usage: BlueprintResourceUsage;
  readonly globalChecks: readonly GlobalCheck[];
  readonly capabilityLoads: readonly CapabilityLoad[];
}

const BUDGET_DIMENSIONS: readonly BudgetDimension[] = [
  "maxInstancesPerBlueprint",
  "maxSerializedPropsBytes",
  "maxEventBindings",
  "maxActionBindings",
  "maxConcurrentTimers"
];

const UTF8 = new TextEncoder();

class Peak {
  public value = 0;
  public path = "$";

  public observe(value: number, path: string): void {
    if (value > this.value) {
      this.value = value;
      this.path = path;
    }
  }
}

function resourceError(path: string, message: string, ref?: CapabilityRef): never {
  return fail("F02-ERR-011", "V09", path, message, ref);
}

function safeAdd(left: number, right: number, path: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    resourceError(path, "Resource measurement exceeds the safe integer range.");
  }
  return sum;
}

function safeMultiply(left: number, right: number, path: string): number {
  const product = left * right;
  if (!Number.isSafeInteger(product)) {
    resourceError(path, "Resource measurement exceeds the safe integer range.");
  }
  return product;
}

function canonicalByteLength(value: unknown): number {
  return UTF8.encode(canonicalizeJson(value)).byteLength;
}

function compositeLiteralDepth(value: JsonValue): number {
  let deepest = 0;
  const pending: [JsonValue, number][] = [[value, 0]];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const [current, parentDepth] = item;
    if (current === null || typeof current !== "object") {
      continue;
    }
    const depth = parentDepth + 1;
    deepest = Math.max(deepest, depth);
    for (const child of Array.isArray(current) ? current : Object.values(current)) {
      pending.push([child, depth]);
    }
  }
  return deepest;
}

function descriptorDepth(descriptor: TypeDescriptor): number {
  let deepest = 0;
  const pending: [TypeDescriptor, number][] = [[descriptor, 1]];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const [current, depth] = item;
    deepest = Math.max(deepest, depth);
    if (current.type === "LIST") {
      pending.push([current.constraints.item, depth + 1]);
    } else if (current.type === "RECORD") {
      for (const field of Object.values(current.constraints.fields)) {
        pending.push([field, depth + 1]);
      }
    }
  }
  return deepest;
}

class ExpressionPeaks {
  public readonly astNodes = new Peak();
  public readonly depth = new Peak();
  public readonly literalDepth = new Peak();

  public observe(root: ValueSource, path: string): void {
    let count = 0;
    let deepest = 0;
    const pending: [ValueSource, number][] = [[root, 1]];
    for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
      const [source, depth] = item;
      count += 1;
      deepest = Math.max(deepest, depth);
      if (source.kind === "OP") {
        for (const arg of source.args) {
          pending.push([arg, depth + 1]);
        }
      } else if (source.kind === "LITERAL") {
        this.literalDepth.observe(compositeLiteralDepth(source.value), path);
      }
    }
    this.astNodes.observe(count, path);
    this.depth.observe(deepest, path);
  }

  public observeMap(sources: Readonly<Record<string, ValueSource>>, path: string): void {
    for (const [key, source] of Object.entries(sources)) {
      this.observe(source, `${path}.${key}`);
    }
  }
}

function observeStep(step: ActionStep, path: string, peaks: ExpressionPeaks): void {
  if (step.type === "RESET_STATE") {
    return;
  }
  if (step.type === "SET_STATE") {
    peaks.observe(step.value, `${path}.value`);
  } else {
    peaks.observeMap(step.args, `${path}.args`);
  }
  if (step.when !== undefined) {
    peaks.observe(step.when, `${path}.when`);
  }
}

function measureExpressions(blueprint: Blueprint): ExpressionPeaks {
  const peaks = new ExpressionPeaks();
  for (const [key, entry] of Object.entries(blueprint.state)) {
    if (entry.mode === "DERIVED") {
      peaks.observe(entry.expr, `$.state.${key}.expr`);
    }
  }
  blueprint.rules.forEach((rule, index) => peaks.observe(rule.expr, `$.rules[${index}].expr`));
  blueprint.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    peaks.observeMap(node.props, `${path}.props`);
    peaks.observeMap(node.bindings, `${path}.bindings`);
    if (node.repeat !== undefined) {
      peaks.observe(node.repeat.items, `${path}.repeat.items`);
    }
  });
  blueprint.actions.forEach((action, actionIndex) => {
    action.steps.forEach((step, stepIndex) =>
      observeStep(step, `$.actions[${actionIndex}].steps[${stepIndex}]`, peaks)
    );
  });
  blueprint.result.outputs.forEach((output, index) =>
    peaks.observe(output.value, `$.result.outputs[${index}].value`)
  );
  return peaks;
}

function refKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

function capabilityLoad(
  loads: Map<string, CapabilityLoad>,
  ref: CapabilityRef,
  capability: GeneratedCapabilityValidator,
  path: string
): CapabilityLoad {
  const key = refKey(ref);
  const existing = loads.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const load: CapabilityLoad = {
    ref,
    capability,
    path,
    totals: {
      maxInstancesPerBlueprint: 0,
      maxSerializedPropsBytes: 0,
      maxEventBindings: 0,
      maxActionBindings: 0,
      maxConcurrentTimers: 0
    }
  };
  loads.set(key, load);
  return load;
}

function addTo(load: CapabilityLoad, dimension: BudgetDimension, amount: number, path: string): void {
  load.totals[dimension] = safeAdd(load.totals[dimension], amount, path);
}

export function measureResources(input: ResourceMeasurementInput): ResourceMeasurement {
  const { blueprint, graph, capabilities } = input;
  const loads = new Map<string, CapabilityLoad>();
  const uiDepth = new Map<string, number>();
  const repeatDepth = new Map<string, number>();
  const instanceBound = new Map<string, number>();
  const maxUiDepth = new Peak();
  const maxRepeatDepth = new Peak();
  const maxChildren = new Peak();
  let eventBindings = 0;
  let timerCount = 0;

  for (const node of graph.order) {
    const index = graph.indexById.get(node.id) as number;
    const path = `$.nodes[${index}]`;
    const parentId = graph.parentById.get(node.id);
    const parent = parentId === undefined ? undefined : blueprint.nodes[graph.indexById.get(parentId) as number];
    const depth = parentId === undefined ? 1 : (uiDepth.get(parentId) as number) + 1;
    const repeats = (parentId === undefined ? 0 : (repeatDepth.get(parentId) as number)) + (node.repeat === undefined ? 0 : 1);
    const bound =
      parentId === undefined
        ? 1
        : safeMultiply(instanceBound.get(parentId) as number, parent?.repeat?.max_items ?? 1, path);
    uiDepth.set(node.id, depth);
    repeatDepth.set(node.id, repeats);
    instanceBound.set(node.id, bound);
    maxUiDepth.observe(depth, path);
    maxRepeatDepth.observe(repeats, `${path}.repeat`);
    maxChildren.observe(node.children.length, `${path}.children`);

    const capability = capabilities.get(node.id) as GeneratedCapabilityValidator;
    const events = Object.keys(node.events).length;
    const timers = safeMultiply(bound, capability.resource_usage.timerSlotsPerInstance, path);
    const load = capabilityLoad(loads, node.capability, capability, `${path}.capability`);
    addTo(load, "maxInstancesPerBlueprint", bound, path);
    addTo(load, "maxSerializedPropsBytes", canonicalByteLength(node.props), path);
    addTo(load, "maxEventBindings", events, path);
    addTo(load, "maxConcurrentTimers", timers, path);
    eventBindings += events;
    timerCount = safeAdd(timerCount, timers, path);
  }

  const maxSteps = new Peak();
  blueprint.actions.forEach((action, actionIndex) => {
    const path = `$.actions[${actionIndex}]`;
    maxSteps.observe(action.steps.length, `${path}.steps`);
    action.steps.forEach((step, stepIndex) => {
      if (step.type === "INVOKE_CAPABILITY") {
        const targetIndex = graph.indexById.get(step.target_node_id) as number;
        const target = blueprint.nodes[targetIndex] as BlueprintNode;
        const capability = capabilities.get(target.id) as GeneratedCapabilityValidator;
        const load = capabilityLoad(loads, target.capability, capability, `$.nodes[${targetIndex}].capability`);
        addTo(load, "maxActionBindings", 1, `${path}.steps[${stepIndex}]`);
      }
    });
  });

  const maxRefs = new Peak();
  blueprint.support.degradations.forEach((degradation, index) =>
    maxRefs.observe(degradation.capability_refs.length, `$.support.degradations[${index}].capability_refs`)
  );

  const maxDescriptorDepth = new Peak();
  const initialState: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const [key, entry] of Object.entries(blueprint.state)) {
    if (entry.mode === "MUTABLE") {
      initialState[key] = entry.initial;
      const descriptor = input.mutableDescriptors.get(key);
      if (descriptor !== undefined) {
        maxDescriptorDepth.observe(descriptorDepth(descriptor), `$.state.${key}`);
      }
    }
  }
  const initialStateBytes = canonicalByteLength(initialState);
  const expressions = measureExpressions(blueprint);
  const ceilings = F02_GLOBAL_CEILINGS;

  const usage: BlueprintResourceUsage = {
    blueprint_bytes: input.blueprintBytes,
    node_count: blueprint.nodes.length,
    state_count: Object.keys(blueprint.state).length,
    rule_count: blueprint.rules.length,
    action_count: blueprint.actions.length,
    initial_state_bytes: initialStateBytes,
    event_binding_count: eventBindings,
    timer_count: timerCount,
    max_expression_ast_nodes: expressions.astNodes.value,
    max_expression_depth: expressions.depth.value,
    max_type_descriptor_depth: maxDescriptorDepth.value,
    max_composite_literal_depth: expressions.literalDepth.value,
    max_ui_child_depth: maxUiDepth.value,
    max_repeat_depth: maxRepeatDepth.value
  };

  const globalChecks: GlobalCheck[] = [
    { value: usage.blueprint_bytes, limit: ceilings.blueprintBytes, path: "$" },
    { value: usage.node_count, limit: ceilings.nodes, path: "$.nodes" },
    { value: usage.state_count, limit: ceilings.stateEntries, path: "$.state" },
    { value: usage.rule_count, limit: ceilings.rules, path: "$.rules" },
    { value: usage.action_count, limit: ceilings.actions, path: "$.actions" },
    { value: maxSteps.value, limit: ceilings.stepsPerAction, path: maxSteps.path },
    { value: expressions.astNodes.value, limit: ceilings.expressionAstNodes, path: expressions.astNodes.path },
    { value: expressions.depth.value, limit: ceilings.expressionDepth, path: expressions.depth.path },
    { value: maxDescriptorDepth.value, limit: ceilings.descriptorDepth, path: maxDescriptorDepth.path },
    { value: expressions.literalDepth.value, limit: ceilings.compositeLiteralDepth, path: expressions.literalDepth.path },
    { value: maxUiDepth.value, limit: ceilings.uiChildDepth, path: maxUiDepth.path },
    { value: maxRepeatDepth.value, limit: ceilings.repeatDepth, path: maxRepeatDepth.path },
    { value: usage.initial_state_bytes, limit: ceilings.initialStateBytes, path: "$.state" },
    { value: usage.event_binding_count, limit: ceilings.eventBindings, path: "$.nodes" },
    { value: usage.timer_count, limit: ceilings.concurrentTimers, path: "$.nodes" },
    { value: blueprint.result.outputs.length, limit: ceilings.resultOutputs, path: "$.result.outputs" },
    { value: blueprint.support.degradations.length, limit: ceilings.degradations, path: "$.support.degradations" },
    { value: maxRefs.value, limit: ceilings.refsPerDegradation, path: maxRefs.path },
    { value: maxChildren.value, limit: ceilings.childrenPerNode, path: maxChildren.path }
  ];
  const capabilityLoads = [...loads.values()].sort((left, right) =>
    compareCodePoints(refKey(left.ref), refKey(right.ref))
  );
  return { usage, globalChecks, capabilityLoads };
}

export function enforceResourceBounds(measurement: ResourceMeasurement): void {
  for (const check of measurement.globalChecks) {
    if (check.value > check.limit) {
      resourceError(check.path, "Blueprint exceeds a Phase 1 global resource ceiling.");
    }
  }
  for (const load of measurement.capabilityLoads) {
    for (const dimension of BUDGET_DIMENSIONS) {
      if (load.totals[dimension] > load.capability.resource_budget[dimension]) {
        resourceError(load.path, `Capability ${dimension} budget exceeded.`, load.ref);
      }
    }
  }
}
