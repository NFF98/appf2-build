import { valueConforms } from "../blueprint/type-descriptor.js";
import type {
  ActionContract,
  FieldContract,
  InvariantId,
  TargetMatcher,
  TypeDescriptor
} from "../capabilities/schema/validator-contract.js";
import type { CapabilityEmittedEvent, CapabilityState, StagedEffect } from "./capability-protocol.js";
import type { ExecutionIndex, NodeExecution } from "./execution-index.js";
import { evaluateTyped, type EvaluationEnv } from "./expression-vm.js";
import type { NodeInstanceKey, RepeatCoordinate } from "./node-instance-key.js";
import { invariantBroken, runtimeFail } from "./runtime-errors.js";
import { isRuntimeRecord, type RuntimeRecord, type RuntimeValue } from "./runtime-value.js";

export type LexicalScope = ReadonlyMap<string, RuntimeValue>;

export interface ConcreteNodeInstance {
  readonly key: NodeInstanceKey;
  readonly scope: LexicalScope;
}

const EMPTY_SCOPE: LexicalScope = new Map();

function repeatItems(repeatNode: NodeExecution, env: EvaluationEnv, scope: LexicalScope): readonly RuntimeValue[] {
  const repeat = repeatNode.node.repeat ?? invariantBroken(`Node ${repeatNode.node.id} has no repeat.`);
  const items = evaluateTyped(repeat.items, { ...env, scope });
  return Array.isArray(items) ? items : invariantBroken(`repeat.items of ${repeatNode.node.id} is not a LIST.`);
}

function withRepeatAliases(scope: LexicalScope, repeatNode: NodeExecution, item: RuntimeValue, index: number): LexicalScope {
  const repeat = repeatNode.node.repeat ?? invariantBroken(`Node ${repeatNode.node.id} has no repeat.`);
  const next = new Map(scope);
  next.set(repeat.item_alias, item);
  if (repeat.index_alias !== undefined) {
    next.set(repeat.index_alias, index);
  }
  return next;
}

/**
 * BF-036 lexical scope for one concrete node instance, rebuilt only from admitted repeat ancestry and committed
 * state. Returns undefined when the key does not name a currently existing clone.
 */
export function lexicalScopeOf(index: ExecutionIndex, key: NodeInstanceKey, env: EvaluationEnv): LexicalScope | undefined {
  const target = index.nodeById.get(key.node_id);
  if (target === undefined || target.repeatAncestors.length !== key.repeat_coordinates.length) {
    return undefined;
  }
  let scope = EMPTY_SCOPE;
  for (const [position, coordinate] of key.repeat_coordinates.entries()) {
    const repeatNode = index.nodeById.get(coordinate.repeat_node_id);
    if (repeatNode === undefined || target.repeatAncestors[position] !== coordinate.repeat_node_id) {
      return undefined;
    }
    const items = repeatItems(repeatNode, env, scope);
    const limit = Math.min(items.length, repeatNode.node.repeat?.max_items ?? 0);
    if (!Number.isInteger(coordinate.item_index) || coordinate.item_index < 0 || coordinate.item_index >= limit) {
      return undefined;
    }
    scope = withRepeatAliases(scope, repeatNode, items[coordinate.item_index] as RuntimeValue, coordinate.item_index);
  }
  return scope;
}

interface ExpansionFrame {
  readonly nodeId: string;
  readonly coordinates: readonly RepeatCoordinate[];
  readonly scope: LexicalScope;
}

/** Every concrete NodeInstanceKey of the committed state, in structural pre-order (F03 §25 rules 1–2). */
export function expandNodeInstances(index: ExecutionIndex, env: EvaluationEnv): ConcreteNodeInstance[] {
  const instances: ConcreteNodeInstance[] = [];
  const pending: ExpansionFrame[] = [{ nodeId: index.blueprint.root_node_id, coordinates: [], scope: EMPTY_SCOPE }];
  for (let frame = pending.pop(); frame !== undefined; frame = pending.pop()) {
    const execution = index.nodeById.get(frame.nodeId) ?? invariantBroken(`Node ${frame.nodeId} is not indexed.`);
    instances.push({ key: { node_id: frame.nodeId, repeat_coordinates: frame.coordinates }, scope: frame.scope });
    const children = [...execution.node.children].reverse();
    if (execution.node.repeat === undefined) {
      pending.push(...children.map((nodeId) => ({ nodeId, coordinates: frame.coordinates, scope: frame.scope })));
      continue;
    }
    const items = repeatItems(execution, env, frame.scope);
    if (items.length > execution.node.repeat.max_items) {
      runtimeFail("F03-ERR-004", `repeat ${frame.nodeId} item count exceeds its admitted max_items.`);
    }
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const coordinates = [...frame.coordinates, { repeat_node_id: frame.nodeId, item_index: itemIndex }];
      const scope = withRepeatAliases(frame.scope, execution, items[itemIndex] as RuntimeValue, itemIndex);
      pending.push(...children.map((nodeId) => ({ nodeId, coordinates, scope })));
    }
  }
  return instances;
}

export function resolveProps(execution: NodeExecution, env: EvaluationEnv, scope: LexicalScope): RuntimeRecord {
  const props: Record<string, RuntimeValue> = Object.create(null) as Record<string, RuntimeValue>;
  for (const [key, source] of Object.entries(execution.node.props)) {
    props[key] = evaluateTyped(source, { ...env, scope });
  }
  return props;
}

function capabilityFailure(execution: NodeExecution, message: string): never {
  return runtimeFail("F03-ERR-011", message, execution.node.capability.id);
}

function matches(value: RuntimeValue, matcher: TargetMatcher): boolean {
  switch (matcher.kind) {
    case "EXACT":
      return valueConforms(value, matcher.descriptor);
    case "ONE_OF":
      return matcher.options.some((option) => matches(value, option));
    case "ANY_ENUM":
      return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    case "ANY_RECORD":
      return isRuntimeRecord(value);
    case "LIST_OF":
      return (
        Array.isArray(value) &&
        (matcher.max_length === undefined || value.length <= matcher.max_length) &&
        value.every((item) => matches(item, matcher.item))
      );
  }
}

const FIELD_INVARIANTS: Partial<Record<InvariantId, (value: number) => boolean>> = {
  NUM_INTEGER: (value) => Number.isInteger(value),
  NUM_GT_ZERO: (value) => value > 0,
  NUM_GTE_ZERO: (value) => value >= 0,
  NUM_INT_RANGE_0_8192: (value) => Number.isInteger(value) && value >= 0 && value <= 8192,
  NUM_INT_RANGE_0_500: (value) => Number.isInteger(value) && value >= 0 && value <= 500
};

function fieldValid(value: RuntimeValue, contract: FieldContract): boolean {
  return (
    matches(value, contract.matcher) &&
    contract.invariant_ids.every((invariant) => {
      const check = FIELD_INVARIANTS[invariant];
      return check === undefined || (typeof value === "number" && check(value));
    })
  );
}

/** BF-035: action name, arg keys, resolved arg types and RANDOM_MIN_MAX re-checked on exact resolved values. */
export function validateInvocationArgs(execution: NodeExecution, actionName: string, args: RuntimeRecord): ActionContract {
  const actions = execution.validator.actions;
  const contract = Object.hasOwn(actions, actionName) ? actions[actionName] : undefined;
  if (contract === undefined) {
    return capabilityFailure(execution, `Capability does not declare action ${actionName}.`);
  }
  for (const [key, value] of Object.entries(args)) {
    const field = Object.hasOwn(contract.args, key) ? contract.args[key] : undefined;
    if (field === undefined || !fieldValid(value, field)) {
      capabilityFailure(execution, `Resolved argument ${key} violates the Validator contract.`);
    }
  }
  for (const [key, field] of Object.entries(contract.args)) {
    if (field.required && !Object.hasOwn(args, key)) {
      capabilityFailure(execution, `Required argument ${key} is missing.`);
    }
  }
  const { min, max } = args;
  if (contract.invariant_ids.includes("RANDOM_MIN_MAX") && !(typeof min === "number" && typeof max === "number" && min <= max)) {
    capabilityFailure(execution, "RANDOM_MIN_MAX requires resolved min <= max.");
  }
  return contract;
}

function declaredStateDescriptor(execution: NodeExecution): TypeDescriptor | undefined {
  const descriptor = execution.validator.capability_state;
  return descriptor === "NONE" ? undefined : descriptor;
}

/** F03 §22: initialized state must exactly match the F04 descriptor; NONE capabilities hold no state. */
export function validateInitialState(execution: NodeExecution, state: CapabilityState | undefined): CapabilityState | undefined {
  const descriptor = declaredStateDescriptor(execution);
  const valid = descriptor === undefined ? state === undefined : state !== undefined && valueConforms(state, descriptor);
  return valid ? state : runtimeFail("F03-ERR-004", "Capability initializer produced state outside its descriptor.", execution.node.capability.id);
}

/** F03 §22 BF-036: patch keys must be declared, never null/undefined, and the merged state must conform. */
export function applyStatePatch(
  execution: NodeExecution,
  state: CapabilityState | undefined,
  patch: RuntimeRecord | undefined
): CapabilityState | undefined {
  if (patch === undefined) {
    return state;
  }
  const descriptor = declaredStateDescriptor(execution);
  if (descriptor?.type !== "RECORD" || !isRuntimeRecord(patch)) {
    return capabilityFailure(execution, "Capability state patch is not allowed for this capability.");
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(descriptor.constraints.fields, key) || value === null || value === undefined) {
      capabilityFailure(execution, `Capability state patch field ${key} is undeclared or absent-by-null.`);
    }
  }
  const next: CapabilityState = { ...(state ?? {}), ...patch };
  return valueConforms(next, descriptor) ? next : capabilityFailure(execution, "Patched capability state violates its descriptor.");
}

/** F04 SCORE_BOUNDS: the exact resulting score must stay within declared props bounds (BF-035 rule 3). */
export function checkStateInvariants(execution: NodeExecution, state: CapabilityState | undefined, props: RuntimeRecord): void {
  if (!execution.validator.invariant_ids.includes("SCORE_BOUNDS") || state === undefined) {
    return;
  }
  const { value } = state;
  const { min, max } = props;
  const withinMin = typeof min !== "number" || (typeof value === "number" && value >= min);
  const withinMax = typeof max !== "number" || (typeof value === "number" && value <= max);
  if (!withinMin || !withinMax) {
    capabilityFailure(execution, "SCORE_BOUNDS violated by the resulting score.");
  }
}

function valuePayload(descriptor: TypeDescriptor): TypeDescriptor {
  const fields: Record<string, TypeDescriptor> = Object.create(null) as Record<string, TypeDescriptor>;
  fields.value = descriptor;
  return { type: "RECORD", constraints: { fields } };
}

function boundMutableDescriptor(execution: NodeExecution, bindingKey: string, index: ExecutionIndex): TypeDescriptor | undefined {
  const binding = execution.node.bindings[bindingKey];
  return binding?.kind === "STATE" ? index.mutable.get(binding.key) : undefined;
}

/** F04 event payload resolver, mirroring the F02 admission resolver on concrete resolved props. */
export function eventPayloadDescriptor(
  execution: NodeExecution,
  eventName: string,
  props: RuntimeRecord,
  index: ExecutionIndex
): TypeDescriptor | undefined {
  const events = execution.validator.events;
  const payload = Object.hasOwn(events, eventName) ? events[eventName]?.payload : undefined;
  switch (payload?.kind) {
    case "STATIC":
      return payload.descriptor;
    case "BOUND_STATE_DESCRIPTOR": {
      const state = boundMutableDescriptor(execution, payload.binding_key, index);
      return state === undefined ? undefined : valuePayload(state);
    }
    case "BOUND_STRING_NARROWED_BY_PROP": {
      const state = boundMutableDescriptor(execution, payload.binding_key, index);
      const maxLength = props[payload.prop_key];
      const narrowed =
        state?.type === "STRING" &&
        typeof maxLength === "number" &&
        Number.isInteger(maxLength) &&
        maxLength >= 0 &&
        maxLength <= state.constraints.max_length;
      return narrowed ? valuePayload({ type: "STRING", constraints: { max_length: maxLength } }) : undefined;
    }
    default:
      return undefined;
  }
}

export function validateEmittedEvents(
  execution: NodeExecution,
  events: readonly CapabilityEmittedEvent[],
  props: RuntimeRecord,
  index: ExecutionIndex
): void {
  for (const event of events) {
    const descriptor = eventPayloadDescriptor(execution, event.event_name, props, index);
    if (descriptor === undefined || !valueConforms(event.payload, descriptor)) {
      capabilityFailure(execution, `Emitted event ${event.event_name} is undeclared or violates its payload schema.`);
    }
  }
}

const HOST_EFFECT_KINDS: ReadonlySet<string> = new Set(["VISUAL_EFFECT", "AUDIO_PLAYBACK_REQUEST", "FOCUS_REQUEST"]);

/** Only declared F03 §21 effect classes; timer completion must name an event this capability declares. */
export function validateStagedEffects(execution: NodeExecution, effects: readonly StagedEffect[]): void {
  for (const effect of effects) {
    const valid =
      effect.kind === "CANCEL_TIMER" ||
      (HOST_EFFECT_KINDS.has(effect.kind) && "request" in effect && isRuntimeRecord(effect.request)) ||
      (effect.kind === "SCHEDULE_TIMER" &&
        Object.hasOwn(execution.validator.events, effect.completion_event) &&
        Number.isFinite(effect.timer.duration_ms) &&
        effect.timer.duration_ms >= 0);
    if (!valid) {
      capabilityFailure(execution, `Staged effect ${effect.kind} is not a declared local effect.`);
    }
  }
}
