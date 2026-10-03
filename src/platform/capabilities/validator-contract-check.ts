import { parseTypeDescriptor, TypeDescriptorError } from "../blueprint/type-descriptor.js";
import type { CapabilityDefinition } from "./schema/capability-definition.js";
import {
  ACTION_INVARIANT_IDS,
  CAPABILITY_INVARIANT_IDS,
  FIELD_VALUE_INVARIANT_IDS,
  SOURCE_KINDS,
  type BindingContract,
  type EventContract,
  type FieldContract,
  type InvariantId,
  type TargetMatcher,
  type TypeDescriptor,
  type ValidatorContract
} from "./schema/validator-contract.js";

const CONTRACT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MATCHER_DEPTH_GUARD = 13;

export class ValidatorContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ValidatorContractError";
  }
}

function invalid(label: string, message: string): never {
  throw new ValidatorContractError(`${label}: ${message}`);
}

function assertDescriptor(raw: TypeDescriptor, label: string, allowOptionalFields: boolean): void {
  try {
    parseTypeDescriptor(raw, label, { allowOptionalFields });
  } catch (error: unknown) {
    if (error instanceof TypeDescriptorError) {
      invalid(error.path, error.message);
    }
    throw error;
  }
}

function assertMatcher(matcher: TargetMatcher, label: string, depth = 1): void {
  if (depth > MATCHER_DEPTH_GUARD) {
    invalid(label, "TargetMatcher nesting exceeds the depth guard.");
  }
  switch (matcher.kind) {
    case "EXACT":
      assertDescriptor(matcher.descriptor, `${label}.descriptor`, false);
      return;
    case "ONE_OF":
      if (matcher.options.length === 0) {
        invalid(label, "ONE_OF requires at least one option.");
      }
      matcher.options.forEach((option, index) => assertMatcher(option, `${label}.options[${index}]`, depth + 1));
      return;
    case "ANY_ENUM":
    case "ANY_RECORD":
      return;
    case "LIST_OF":
      if (matcher.max_length !== undefined && (!Number.isInteger(matcher.max_length) || matcher.max_length < 0 || matcher.max_length > 500)) {
        invalid(label, "LIST_OF max_length must be an integer 0..500.");
      }
      assertMatcher(matcher.item, `${label}.item`, depth + 1);
      return;
    default:
      invalid(label, "Unknown TargetMatcher kind.");
  }
}

function assertInvariants(ids: readonly InvariantId[], allowed: readonly InvariantId[], label: string): void {
  if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.includes(id))) {
    invalid(label, "invariant_ids must be unique canonical IDs valid at this location.");
  }
}

function assertField(field: FieldContract, label: string): void {
  if (typeof field.required !== "boolean") {
    invalid(label, "required must be boolean.");
  }
  assertMatcher(field.matcher, `${label}.matcher`);
  const kinds = field.source_kinds;
  if (kinds.length === 0 || new Set(kinds).size !== kinds.length || kinds.some((kind) => !SOURCE_KINDS.includes(kind))) {
    invalid(`${label}.source_kinds`, "source_kinds must be a non-empty unique subset of canonical source kinds.");
  }
  assertInvariants(field.invariant_ids, FIELD_VALUE_INVARIANT_IDS, `${label}.invariant_ids`);
  if (field.invariant_ids.length > 0 && (kinds.length !== 1 || kinds[0] !== "LITERAL")) {
    invalid(label, "Value invariants require a LITERAL-only field.");
  }
}

function assertBinding(binding: BindingContract, label: string): void {
  assertField(binding, label);
  if (binding.mutable_state_required && (binding.source_kinds.length !== 1 || binding.source_kinds[0] !== "STATE")) {
    invalid(label, "mutable_state_required bindings must accept STATE only.");
  }
  if (!["ACTION_ID", "NODE_ID", "NONE"].includes(binding.reference)) {
    invalid(`${label}.reference`, "reference must be ACTION_ID, NODE_ID or NONE.");
  }
  if (binding.reference !== "NONE" && (binding.source_kinds.length !== 1 || binding.source_kinds[0] !== "LITERAL")) {
    invalid(label, "Reference bindings must accept LITERAL only.");
  }
}

function assertMutableBinding(validator: ValidatorContract, bindingKey: string, label: string): void {
  const binding = Object.hasOwn(validator.bindings, bindingKey) ? validator.bindings[bindingKey] : undefined;
  if (binding === undefined || !binding.mutable_state_required) {
    invalid(label, "Event resolver binding_key must reference a mutable STATE binding.");
  }
}

function assertEvent(event: EventContract, validator: ValidatorContract, label: string): void {
  const { payload } = event;
  switch (payload.kind) {
    case "STATIC":
      assertDescriptor(payload.descriptor, `${label}.payload.descriptor`, false);
      if (payload.descriptor.type !== "RECORD") {
        invalid(label, "STATIC payload root must be a RECORD descriptor.");
      }
      break;
    case "BOUND_STATE_DESCRIPTOR":
      assertMutableBinding(validator, payload.binding_key, label);
      break;
    case "BOUND_STRING_NARROWED_BY_PROP": {
      assertMutableBinding(validator, payload.binding_key, label);
      const prop = Object.hasOwn(validator.props, payload.prop_key) ? validator.props[payload.prop_key] : undefined;
      if (prop === undefined || !prop.invariant_ids.includes("NUM_INT_RANGE_0_8192")) {
        invalid(label, "BOUND_STRING_NARROWED_BY_PROP prop_key must reference a validated max_length prop.");
      }
      break;
    }
    default:
      invalid(label, "Unknown event payload resolver kind.");
  }
  assertInvariants(event.invariant_ids, [], `${label}.invariant_ids`);
}

function assertKeys(map: Readonly<Record<string, unknown>>, label: string): void {
  for (const key of Object.keys(map)) {
    if (!CONTRACT_KEY_PATTERN.test(key)) {
      invalid(`${label}.${key}`, "Contract key does not match the canonical key grammar.");
    }
  }
}

function sameNames(left: readonly string[], right: Readonly<Record<string, unknown>>): boolean {
  const names = Object.keys(right);
  return left.length === names.length && left.every((name) => Object.hasOwn(right, name));
}

function assertComposition(validator: ValidatorContract, label: string): void {
  const { composition } = validator;
  if (typeof composition.children !== "boolean" || typeof composition.repeat !== "boolean") {
    invalid(`${label}.composition`, "composition.children and composition.repeat must be booleans.");
  }
  if (composition.repeat_required !== undefined && (!composition.repeat || typeof composition.repeat_required !== "boolean")) {
    invalid(`${label}.composition`, "repeat_required exists only when repeat is true.");
  }
}

export function assertValidatorContract(definition: CapabilityDefinition): void {
  const label = `${definition.id}@${definition.version}.validator`;
  const validator = definition.contract.validator as ValidatorContract | undefined;
  if (validator === undefined) {
    return invalid(label, "Capability is missing contract.validator.");
  }
  for (const [name, map] of [["props", validator.props], ["bindings", validator.bindings], ["events", validator.events], ["actions", validator.actions]] as const) {
    assertKeys(map, `${label}.${name}`);
  }
  Object.entries(validator.props).forEach(([key, field]) => assertField(field, `${label}.props.${key}`));
  Object.entries(validator.bindings).forEach(([key, binding]) => assertBinding(binding, `${label}.bindings.${key}`));
  Object.entries(validator.events).forEach(([key, event]) => assertEvent(event, validator, `${label}.events.${key}`));
  Object.entries(validator.actions).forEach(([key, action]) => {
    assertKeys(action.args, `${label}.actions.${key}.args`);
    Object.entries(action.args).forEach(([arg, field]) => assertField(field, `${label}.actions.${key}.args.${arg}`));
    assertInvariants(action.invariant_ids, ACTION_INVARIANT_IDS, `${label}.actions.${key}.invariant_ids`);
  });
  assertComposition(validator, label);
  if (validator.capability_state !== "NONE") {
    assertDescriptor(validator.capability_state, `${label}.capability_state`, true);
  }
  assertInvariants(validator.invariant_ids, CAPABILITY_INVARIANT_IDS, `${label}.invariant_ids`);
  const { contract } = definition;
  if (!sameNames(contract.actions, validator.actions) || !sameNames(contract.events, validator.events) || !sameNames(contract.bindings, validator.bindings)) {
    invalid(label, "contract action/event/binding name lists must match contract.validator.");
  }
}
