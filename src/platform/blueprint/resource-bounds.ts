import type { GeneratedCapabilityValidator, TypeDescriptor } from "../capabilities/schema/validator-contract.js";
import { canonicalizeJson } from "./canonical-json.js";
import { codePointLength, compareCodePoints } from "./type-descriptor.js";
import {
  fail,
  type Blueprint,
  type BlueprintNode,
  type CapabilityRef,
  type JsonValue,
  type ValueSource
} from "./validation-types.js";

export const GLOBAL_BLUEPRINT_CEILINGS = {
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
  initialListItems: 500,
  initialStringChars: 8_192,
  initialStateBytes: 131_072,
  eventBindings: 200,
  concurrentTimers: 10,
  resultOutputs: 50,
  degradations: 50,
  refsPerDegradation: 20,
  childrenPerNode: 100
} as const;

export interface ResourceUsageReport {
  readonly blueprint_bytes: number;
  readonly node_count: number;
  readonly state_count: number;
  readonly rule_count: number;
  readonly action_count: number;
  readonly initial_state_bytes: number;
  readonly event_binding_count: number;
  readonly timer_count: number;
  readonly max_expression_ast_nodes: number;
  readonly max_expression_depth: number;
  readonly max_type_descriptor_depth: number;
  readonly max_composite_literal_depth: number;
  readonly max_ui_child_depth: number;
  readonly max_repeat_depth: number;
}

export interface ResourceBoundsInput {
  readonly blueprint: Blueprint;
  readonly canonicalByteLength: number;
  readonly mutableDescriptors: ReadonlyMap<string, TypeDescriptor>;
  readonly order: readonly BlueprintNode[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly parentById: ReadonlyMap<string, string>;
  readonly capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>;
}

interface Peak {
  value: number;
  path: string;
}

interface CapabilityTally {
  readonly ref: CapabilityRef;
  readonly validator: GeneratedCapabilityValidator;
  instances: number;
  propsBytes: number;
  eventBindings: number;
  actionBindings: number;
  timers: number;
}

const UTF8 = new TextEncoder();

function exceeds(value: number, ceiling: number): boolean {
  return !Number.isSafeInteger(value) || value > ceiling;
}

function resourceError(path: string, message: string, ref?: CapabilityRef): never {
  return fail("F02-ERR-011", "V09", path, message, ref);
}

function raise(peak: Peak, value: number, path: string): void {
  if (value > peak.value) {
    peak.value = value;
    peak.path = path;
  }
}

function literalContainerDepth(value: JsonValue, cutoff: number): number {
  let deepest = 0;
  const stack: { readonly value: JsonValue; readonly depth: number }[] = [{ value, depth: 0 }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    if (item.value === null || typeof item.value !== "object") {
      continue;
    }
    const depth = item.depth + 1;
    deepest = Math.max(deepest, depth);
    if (depth > cutoff) {
      return depth;
    }
    const children: readonly JsonValue[] = Array.isArray(item.value) ? item.value : Object.values(item.value);
    for (const child of children) {
      stack.push({ value: child, depth });
    }
  }
  return deepest;
}

function descriptorDepth(descriptor: TypeDescriptor): number {
  if (descriptor.type === "LIST") {
    return 1 + descriptorDepth(descriptor.constraints.item);
  }
  if (descriptor.type === "RECORD") {
    return 1 + Math.max(0, ...Object.values(descriptor.constraints.fields).map(descriptorDepth));
  }
  return 1;
}

class ExpressionMeter {
  public readonly astNodes: Peak = { value: 0, path: "$" };
  public readonly depth: Peak = { value: 0, path: "$" };
  public readonly literalDepth: Peak = { value: 0, path: "$" };

  public measure(root: ValueSource, path: string): void {
    let count = 0;
    const stack: { readonly source: ValueSource; readonly depth: number; readonly path: string }[] = [
      { source: root, depth: 1, path }
    ];
    for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
      count += 1;
      raise(this.depth, item.depth, item.path);
      if (item.source.kind === "LITERAL") {
        raise(this.literalDepth, literalContainerDepth(item.source.value, GLOBAL_BLUEPRINT_CEILINGS.compositeLiteralDepth), item.path);
      } else if (item.source.kind === "OP") {
        item.source.args.forEach((arg, index) => {
          stack.push({ source: arg, depth: item.depth + 1, path: `${item.path}.args[${index}]` });
        });
      }
    }
    raise(this.astNodes, count, path);
  }

  public measureMap(sources: Readonly<Record<string, ValueSource>>, path: string): void {
    for (const key of Object.keys(sources)) {
      this.measure(sources[key] as ValueSource, `${path}.${key}`);
    }
  }
}

function measureExpressions(blueprint: Blueprint, meter: ExpressionMeter): void {
  for (const key of Object.keys(blueprint.state)) {
    const entry = blueprint.state[key];
    if (entry?.mode === "DERIVED") {
      meter.measure(entry.expr, `$.state.${key}.expr`);
    }
  }
  blueprint.rules.forEach((rule, index) => meter.measure(rule.expr, `$.rules[${index}].expr`));
  blueprint.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    meter.measureMap(node.props, `${path}.props`);
    meter.measureMap(node.bindings, `${path}.bindings`);
    if (node.repeat !== undefined) {
      meter.measure(node.repeat.items, `${path}.repeat.items`);
    }
  });
  blueprint.actions.forEach((action, actionIndex) => {
    action.steps.forEach((step, stepIndex) => {
      const path = `$.actions[${actionIndex}].steps[${stepIndex}]`;
      if (step.type === "SET_STATE") {
        meter.measure(step.value, `${path}.value`);
      } else if (step.type === "INVOKE_CAPABILITY") {
        meter.measureMap(step.args, `${path}.args`);
      }
      if (step.type !== "RESET_STATE" && step.when !== undefined) {
        meter.measure(step.when, `${path}.when`);
      }
    });
  });
  blueprint.result.outputs.forEach((output, index) => meter.measure(output.value, `$.result.outputs[${index}].value`));
}

function checkInitialValue(initial: JsonValue, path: string): void {
  const stack: JsonValue[] = [initial];
  for (let value = stack.pop(); value !== undefined; value = stack.pop()) {
    if (typeof value === "string" && codePointLength(value) > GLOBAL_BLUEPRINT_CEILINGS.initialStringChars) {
      resourceError(path, "Initial STRING exceeds the Phase 1 character ceiling.");
    }
    if (Array.isArray(value)) {
      if (value.length > GLOBAL_BLUEPRINT_CEILINGS.initialListItems) {
        resourceError(path, "Initial LIST exceeds the Phase 1 item ceiling.");
      }
      stack.push(...value);
    } else if (value !== null && typeof value === "object") {
      stack.push(...Object.values(value));
    }
  }
}

function measureInitialState(blueprint: Blueprint, meter: ExpressionMeter): number {
  const initialState = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(blueprint.state)) {
    const entry = blueprint.state[key];
    if (entry?.mode === "MUTABLE") {
      const path = `$.state.${key}.initial`;
      raise(meter.literalDepth, literalContainerDepth(entry.initial, GLOBAL_BLUEPRINT_CEILINGS.compositeLiteralDepth), path);
      initialState[key] = entry.initial;
    }
  }
  return UTF8.encode(canonicalizeJson(initialState)).byteLength;
}

interface StructureMetrics {
  readonly uiDepth: Peak;
  readonly repeatDepth: Peak;
  readonly upperBounds: ReadonlyMap<string, number>;
}

function measureStructure(input: ResourceBoundsInput): StructureMetrics {
  const uiDepth: Peak = { value: 0, path: "$" };
  const repeatDepth: Peak = { value: 0, path: "$" };
  const depths = new Map<string, { readonly ui: number; readonly repeat: number }>();
  const upperBounds = new Map<string, number>();
  const nodesById = new Map(input.order.map((node) => [node.id, node] as const));
  for (const node of input.order) {
    const path = `$.nodes[${input.indexById.get(node.id) as number}]`;
    const parentId = input.parentById.get(node.id);
    const parent = parentId === undefined ? undefined : nodesById.get(parentId);
    const parentDepth = parentId === undefined ? undefined : depths.get(parentId);
    const ui = (parentDepth?.ui ?? 0) + 1;
    const repeat = (parentDepth?.repeat ?? 0) + (node.repeat === undefined ? 0 : 1);
    depths.set(node.id, { ui, repeat });
    raise(uiDepth, ui, path);
    raise(repeatDepth, repeat, path);
    const parentBound = parentId === undefined ? 1 : (upperBounds.get(parentId) as number);
    upperBounds.set(node.id, parentBound * (parent?.repeat?.max_items ?? 1));
  }
  return { uiDepth, repeatDepth, upperBounds };
}

function tallyCapabilities(input: ResourceBoundsInput, upperBounds: ReadonlyMap<string, number>): {
  readonly tallies: readonly CapabilityTally[];
  readonly timerCount: number;
  readonly eventBindings: number;
} {
  const byRef = new Map<string, CapabilityTally>();
  const nodeTally = new Map<string, CapabilityTally>();
  let timerCount = 0;
  let eventBindings = 0;
  for (const node of input.blueprint.nodes) {
    const validator = input.capabilities.get(node.id) as GeneratedCapabilityValidator;
    const key = `${node.capability.id}@${node.capability.version}`;
    const tally = byRef.get(key) ?? {
      ref: node.capability,
      validator,
      instances: 0,
      propsBytes: 0,
      eventBindings: 0,
      actionBindings: 0,
      timers: 0
    };
    const bound = upperBounds.get(node.id) as number;
    const events = Object.keys(node.events).length;
    const timers = bound * validator.resource_usage.timerSlotsPerInstance;
    tally.instances += bound;
    tally.propsBytes += UTF8.encode(canonicalizeJson(node.props)).byteLength;
    tally.eventBindings += events;
    tally.timers += timers;
    timerCount += timers;
    eventBindings += events;
    byRef.set(key, tally);
    nodeTally.set(node.id, tally);
  }
  for (const action of input.blueprint.actions) {
    for (const step of action.steps) {
      const target = step.type === "INVOKE_CAPABILITY" ? nodeTally.get(step.target_node_id) : undefined;
      if (target !== undefined) {
        target.actionBindings += 1;
      }
    }
  }
  const tallies = [...byRef.entries()].sort(([left], [right]) => compareCodePoints(left, right)).map(([, tally]) => tally);
  return { tallies, timerCount, eventBindings };
}

function checkCountCeilings(blueprint: Blueprint): void {
  const ceilings = GLOBAL_BLUEPRINT_CEILINGS;
  if (blueprint.nodes.length > ceilings.nodes) {
    resourceError("$.nodes", "Node count exceeds the Phase 1 ceiling.");
  }
  if (Object.keys(blueprint.state).length > ceilings.stateEntries) {
    resourceError("$.state", "State entry count exceeds the Phase 1 ceiling.");
  }
  if (blueprint.rules.length > ceilings.rules) {
    resourceError("$.rules", "Rule count exceeds the Phase 1 ceiling.");
  }
  if (blueprint.actions.length > ceilings.actions) {
    resourceError("$.actions", "Action count exceeds the Phase 1 ceiling.");
  }
  blueprint.actions.forEach((action, index) => {
    if (action.steps.length > ceilings.stepsPerAction) {
      resourceError(`$.actions[${index}].steps`, "Action step count exceeds the Phase 1 ceiling.");
    }
  });
}

function checkPeak(peak: Peak, ceiling: number, message: string): void {
  if (exceeds(peak.value, ceiling)) {
    resourceError(peak.path, message);
  }
}

function checkContainerCeilings(blueprint: Blueprint): void {
  const ceilings = GLOBAL_BLUEPRINT_CEILINGS;
  if (blueprint.result.outputs.length > ceilings.resultOutputs) {
    resourceError("$.result.outputs", "Result output count exceeds the Phase 1 ceiling.");
  }
  const { degradations } = blueprint.support;
  if (degradations.length > ceilings.degradations) {
    resourceError("$.support.degradations", "Degradation count exceeds the Phase 1 ceiling.");
  }
  degradations.forEach((degradation, index) => {
    if (degradation.capability_refs.length > ceilings.refsPerDegradation) {
      resourceError(`$.support.degradations[${index}].capability_refs`, "Degradation capability refs exceed the Phase 1 ceiling.");
    }
  });
  blueprint.nodes.forEach((node, index) => {
    if (node.children.length > ceilings.childrenPerNode) {
      resourceError(`$.nodes[${index}].children`, "Child reference count exceeds the Phase 1 ceiling.");
    }
  });
}

function checkCapabilityBudgets(tallies: readonly CapabilityTally[]): void {
  for (const tally of tallies) {
    const budget = tally.validator.resource_budget;
    const checks: readonly (readonly [number, number, string])[] = [
      [tally.instances, budget.maxInstancesPerBlueprint, "maxInstancesPerBlueprint"],
      [tally.propsBytes, budget.maxSerializedPropsBytes, "maxSerializedPropsBytes"],
      [tally.eventBindings, budget.maxEventBindings, "maxEventBindings"],
      [tally.actionBindings, budget.maxActionBindings, "maxActionBindings"],
      [tally.timers, budget.maxConcurrentTimers, "maxConcurrentTimers"]
    ];
    for (const [used, limit, label] of checks) {
      if (exceeds(used, limit)) {
        resourceError("$.nodes", `Capability budget ${label} exceeded.`, tally.ref);
      }
    }
  }
}

export function validateResourceBounds(input: ResourceBoundsInput): ResourceUsageReport {
  const { blueprint } = input;
  const ceilings = GLOBAL_BLUEPRINT_CEILINGS;
  if (exceeds(input.canonicalByteLength, ceilings.blueprintBytes)) {
    resourceError("$", "Canonical Blueprint bytes exceed the Phase 1 ceiling.");
  }
  checkCountCeilings(blueprint);

  const meter = new ExpressionMeter();
  measureExpressions(blueprint, meter);
  checkPeak(meter.astNodes, ceilings.expressionAstNodes, "Expression AST node count exceeds the Phase 1 ceiling.");
  checkPeak(meter.depth, ceilings.expressionDepth, "Expression nesting depth exceeds the Phase 1 ceiling.");

  const descriptorPeak: Peak = { value: 0, path: "$" };
  for (const [key, descriptor] of input.mutableDescriptors) {
    raise(descriptorPeak, descriptorDepth(descriptor), `$.state.${key}`);
  }
  checkPeak(descriptorPeak, ceilings.typeDescriptorDepth, "TypeDescriptor nesting depth exceeds the Phase 1 ceiling.");
  const initialStateBytes = measureInitialState(blueprint, meter);
  checkPeak(meter.literalDepth, ceilings.compositeLiteralDepth, "Composite literal nesting depth exceeds the Phase 1 ceiling.");

  const structure = measureStructure(input);
  checkPeak(structure.uiDepth, ceilings.uiChildDepth, "UI child nesting depth exceeds the Phase 1 ceiling.");
  checkPeak(structure.repeatDepth, ceilings.repeatDepth, "Repeat nesting depth exceeds the Phase 1 ceiling.");

  for (const key of Object.keys(blueprint.state)) {
    const entry = blueprint.state[key];
    if (entry?.mode === "MUTABLE") {
      checkInitialValue(entry.initial, `$.state.${key}.initial`);
    }
  }
  if (exceeds(initialStateBytes, ceilings.initialStateBytes)) {
    resourceError("$.state", "Total initial state bytes exceed the Phase 1 ceiling.");
  }

  const { tallies, timerCount, eventBindings } = tallyCapabilities(input, structure.upperBounds);
  if (exceeds(eventBindings, ceilings.eventBindings)) {
    resourceError("$.nodes", "Event binding count exceeds the Phase 1 ceiling.");
  }
  if (exceeds(timerCount, ceilings.concurrentTimers)) {
    resourceError("$.nodes", "Concurrent timer count exceeds the Phase 1 ceiling.");
  }
  checkContainerCeilings(blueprint);
  checkCapabilityBudgets(tallies);

  return {
    blueprint_bytes: input.canonicalByteLength,
    node_count: blueprint.nodes.length,
    state_count: Object.keys(blueprint.state).length,
    rule_count: blueprint.rules.length,
    action_count: blueprint.actions.length,
    initial_state_bytes: initialStateBytes,
    event_binding_count: eventBindings,
    timer_count: timerCount,
    max_expression_ast_nodes: meter.astNodes.value,
    max_expression_depth: meter.depth.value,
    max_type_descriptor_depth: descriptorPeak.value,
    max_composite_literal_depth: meter.literalDepth.value,
    max_ui_child_depth: structure.uiDepth.value,
    max_repeat_depth: structure.repeatDepth.value
  };
}
