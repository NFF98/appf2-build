import type {
  BindingContract,
  FieldContract,
  GeneratedCapabilityValidator,
  InvariantId,
  RecordDescriptor,
  TypeDescriptor,
  ValidatorRegistry
} from "../capabilities/schema/validator-contract.js";
import { createCapabilityEligibilityEvaluator } from "./capability-eligibility.js";
import { concreteMatcherDescriptor, isAssignable, isJsonObject, matchesTarget } from "./type-descriptor.js";
import { inferValueSource, type TypingContext } from "./value-source-typing.js";
import {
  fail,
  type Blueprint,
  type BlueprintNode,
  type CapabilityRef,
  type JsonValue,
  type ValueSource
} from "./validation-types.js";

export interface TypedField {
  readonly source: ValueSource;
  readonly descriptor: TypeDescriptor;
}

export interface TypedNodeFields {
  readonly node: BlueprintNode;
  readonly capability: GeneratedCapabilityValidator;
  readonly props: ReadonlyMap<string, TypedField>;
  readonly bindings: ReadonlyMap<string, TypedField>;
}

export function lookupCapability(
  registry: ValidatorRegistry,
  ref: CapabilityRef
): GeneratedCapabilityValidator | undefined {
  const versions = Object.hasOwn(registry.capabilities, ref.id) ? registry.capabilities[ref.id] : undefined;
  return versions !== undefined && Object.hasOwn(versions, ref.version) ? versions[ref.version] : undefined;
}

function capabilityError(path: string, message: string, ref: CapabilityRef): never {
  return fail("F02-ERR-005", "V04", path, message, ref);
}

function assertDeclaredKeys(
  values: Readonly<Record<string, unknown>>,
  contracts: Readonly<Record<string, unknown>>,
  path: string,
  ref: CapabilityRef
): void {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(contracts, key)) {
      capabilityError(`${path}.${key}`, `Capability does not declare ${key}.`, ref);
    }
  }
}

function assertRequiredKeys(
  values: Readonly<Record<string, unknown>>,
  contracts: Readonly<Record<string, FieldContract>>,
  path: string,
  ref: CapabilityRef
): void {
  for (const [key, contract] of Object.entries(contracts)) {
    if (contract.required && !Object.hasOwn(values, key)) {
      capabilityError(`${path}.${key}`, `Capability requires ${key}.`, ref);
    }
  }
}

export function admitNodeCapabilities(
  blueprint: Blueprint,
  registry: ValidatorRegistry,
  runtimeVersion: string
): ReadonlyMap<string, GeneratedCapabilityValidator> {
  const admitted = new Map<string, GeneratedCapabilityValidator>();
  const ineligibility = createCapabilityEligibilityEvaluator(registry, {
    schemaVersion: blueprint.schema_version,
    runtimeVersion
  });
  blueprint.nodes.forEach((node, index) => {
    const path = `$.nodes[${index}]`;
    const capability = lookupCapability(registry, node.capability);
    if (capability === undefined) {
      capabilityError(`${path}.capability`, "Unknown capability ID/version.", node.capability);
    }
    const reason = ineligibility(capability);
    if (reason === "CAPABILITY_INCOMPATIBLE") {
      fail("F02-ERR-004", "V04", `${path}.capability`, "Capability is incompatible with the Blueprint schema or trusted runtime.", node.capability);
    }
    if (reason !== undefined) {
      capabilityError(`${path}.capability`, `Capability is not execution-eligible: ${reason}.`, node.capability);
    }
    const { validator } = capability;
    assertDeclaredKeys(node.props, validator.props, `${path}.props`, node.capability);
    assertRequiredKeys(node.props, validator.props, `${path}.props`, node.capability);
    assertDeclaredKeys(node.bindings, validator.bindings, `${path}.bindings`, node.capability);
    assertRequiredKeys(node.bindings, validator.bindings, `${path}.bindings`, node.capability);
    assertDeclaredKeys(node.events, validator.events, `${path}.events`, node.capability);
    admitted.set(node.id, capability);
  });
  return admitted;
}

function satisfiesValueInvariant(invariant: InvariantId, value: unknown): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  switch (invariant) {
    case "NUM_INTEGER":
      return Number.isInteger(value);
    case "NUM_GT_ZERO":
      return value > 0;
    case "NUM_GTE_ZERO":
      return value >= 0;
    case "NUM_INT_RANGE_0_8192":
      return Number.isInteger(value) && value >= 0 && value <= 8192;
    case "NUM_INT_RANGE_0_500":
      return Number.isInteger(value) && value >= 0 && value <= 500;
    default:
      return false;
  }
}

export function typeContractField(
  source: ValueSource,
  contract: FieldContract,
  path: string,
  context: TypingContext
): TypedField {
  if (!contract.source_kinds.includes(source.kind)) {
    fail(context.errorCode, context.stage, `${path}.kind`, "Value Source kind is not allowed by the capability contract.");
  }
  const descriptor = inferValueSource(source, path, context, concreteMatcherDescriptor(contract.matcher));
  if (!matchesTarget(descriptor, contract.matcher)) {
    fail(context.errorCode, context.stage, path, "Value Source type does not match the capability target matcher.");
  }
  for (const invariant of contract.invariant_ids) {
    if (source.kind !== "LITERAL" || !satisfiesValueInvariant(invariant, source.value)) {
      fail(context.errorCode, context.stage, path, `Value violates canonical invariant ${invariant}.`);
    }
  }
  return { source, descriptor };
}

function typeBinding(
  source: ValueSource,
  contract: BindingContract,
  path: string,
  context: TypingContext,
  nodeIds: ReadonlySet<string>
): TypedField {
  const typed = typeContractField(source, contract, path, context);
  if (contract.mutable_state_required && (source.kind !== "STATE" || context.lookupState(source.key)?.mutable !== true)) {
    fail(context.errorCode, context.stage, path, "Binding requires a MUTABLE state reference.");
  }
  if (contract.reference === "NODE_ID" && referencedIds(source).some((id) => !nodeIds.has(id))) {
    fail(context.errorCode, context.stage, path, "Binding references a node that does not exist.");
  }
  return typed;
}

export function referencedIds(source: ValueSource): readonly string[] {
  if (source.kind !== "LITERAL") {
    return [];
  }
  const values: readonly JsonValue[] = Array.isArray(source.value) ? source.value : [source.value];
  return values.filter((value): value is string => typeof value === "string");
}

function literalOf(fields: ReadonlyMap<string, TypedField>, key: string): JsonValue | undefined {
  const field = fields.get(key);
  return field?.source.kind === "LITERAL" ? field.source.value : undefined;
}

function numberLiteral(fields: ReadonlyMap<string, TypedField>, key: string): number | undefined {
  const value = literalOf(fields, key);
  return typeof value === "number" ? value : undefined;
}

type InvariantCheck = (fields: TypedNodeFields) => boolean;

function numberBounds(descriptor: TypeDescriptor | undefined): { readonly min?: number; readonly max?: number } {
  return descriptor?.type === "NUMBER" ? (descriptor.constraints ?? {}) : {};
}

function ordered(lower: number | undefined, upper: number | undefined): boolean {
  return lower === undefined || upper === undefined || lower <= upper;
}

const inputNumberBounds: InvariantCheck = ({ props, bindings }) => {
  const min = numberLiteral(props, "min");
  const max = numberLiteral(props, "max");
  const step = numberLiteral(props, "step");
  const state = numberBounds(bindings.get("bind")?.descriptor);
  return (
    ordered(min, max) &&
    (step === undefined || step > 0) &&
    ordered(state.min, min) &&
    ordered(max, state.max) &&
    ordered(min ?? state.min, max ?? state.max)
  );
};

const inputTextBound: InvariantCheck = ({ props, bindings }) => {
  const maxLength = numberLiteral(props, "max_length");
  const state = bindings.get("bind")?.descriptor;
  return maxLength !== undefined && state?.type === "STRING" && maxLength <= state.constraints.max_length;
};

function recordList(value: JsonValue | undefined): readonly Readonly<Record<string, JsonValue>>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as readonly JsonValue[]).filter((item): item is Readonly<Record<string, JsonValue>> => isJsonObject(item));
}

const selectEnumDomain: InvariantCheck = ({ props, bindings }) => {
  const optionValues = recordList(literalOf(props, "options")).map((option) => option.value);
  const domain = new Set(optionValues);
  const state = bindings.get("bind")?.descriptor;
  if (domain.size !== optionValues.length || state?.type !== "ENUM") {
    return false;
  }
  const allowed = state.constraints.allowed;
  return (
    allowed.every((member) => typeof member === "string" && domain.has(member)) &&
    allowed.length === domain.size
  );
};

const NUMERIC_FORMATS: ReadonlySet<JsonValue> = new Set(["NUMBER", "PERCENT", "CURRENCY_DISPLAY"]);

const statFormat: InvariantCheck = ({ props, bindings }) => {
  const format = literalOf(props, "format");
  const valueType = bindings.get("value")?.descriptor.type;
  if (format === undefined) {
    return true;
  }
  if (NUMERIC_FORMATS.has(format)) {
    return valueType === "NUMBER";
  }
  return format === "TEXT" && valueType !== undefined && ["NUMBER", "STRING", "BOOLEAN", "ENUM"].includes(valueType);
};

function rowRecord(fields: TypedNodeFields): RecordDescriptor | undefined {
  const rows = fields.bindings.get("rows")?.descriptor;
  const item = rows?.type === "LIST" ? rows.constraints.item : undefined;
  return item?.type === "RECORD" ? item : undefined;
}

const tableColumns: InvariantCheck = (fields) => {
  const columns = recordList(literalOf(fields.props, "columns"));
  const record = rowRecord(fields);
  const keys = columns.map((column) => column.key);
  if (record === undefined || new Set(keys).size !== keys.length) {
    return false;
  }
  return columns.every((column) => {
    const key = column.key;
    const field = typeof key === "string" && Object.hasOwn(record.constraints.fields, key)
      ? record.constraints.fields[key]
      : undefined;
    return field !== undefined && (!NUMERIC_FORMATS.has(column.format ?? null) || field.type === "NUMBER");
  });
};

const tableRowsBound: InvariantCheck = ({ props, bindings }) => {
  const maxRows = numberLiteral(props, "max_rows");
  const rows = bindings.get("rows")?.descriptor;
  return maxRows !== undefined && rows?.type === "LIST" && rows.constraints.max_length <= maxRows;
};

export function scoreBounds(props: ReadonlyMap<string, TypedField>): { readonly min?: number; readonly max?: number } {
  const bounds: { min?: number; max?: number } = {};
  const min = numberLiteral(props, "min");
  const max = numberLiteral(props, "max");
  if (min !== undefined) {
    bounds.min = min;
  }
  if (max !== undefined) {
    bounds.max = max;
  }
  return bounds;
}

const scoreBoundsInvariant: InvariantCheck = ({ props }) => {
  const { min, max } = scoreBounds(props);
  const initial = numberLiteral(props, "initial") ?? 0;
  return (
    (min === undefined || max === undefined || min <= max) &&
    (min === undefined || initial >= min) &&
    (max === undefined || initial <= max)
  );
};

const CAPABILITY_INVARIANTS: Partial<Record<InvariantId, InvariantCheck>> = {
  INPUT_NUMBER_BOUNDS: inputNumberBounds,
  INPUT_TEXT_BOUND: inputTextBound,
  SELECT_ENUM_DOMAIN: selectEnumDomain,
  STAT_FORMAT: statFormat,
  TABLE_COLUMNS: tableColumns,
  TABLE_ROWS_BOUND: tableRowsBound,
  SCORE_BOUNDS: scoreBoundsInvariant
};

function typeFieldMap<C extends FieldContract>(
  values: Readonly<Record<string, ValueSource>>,
  contracts: Readonly<Record<string, C>>,
  path: string,
  typeOne: (source: ValueSource, contract: C, fieldPath: string) => TypedField
): ReadonlyMap<string, TypedField> {
  const typed = new Map<string, TypedField>();
  for (const key of Object.keys(values)) {
    const contract = contracts[key];
    const source = values[key];
    if (contract !== undefined && source !== undefined) {
      typed.set(key, typeOne(source, contract, `${path}.${key}`));
    }
  }
  return typed;
}

export function typeNodeFields(
  node: BlueprintNode,
  capability: GeneratedCapabilityValidator,
  path: string,
  context: TypingContext,
  nodeIds: ReadonlySet<string>
): TypedNodeFields {
  const { validator } = capability;
  const fields: TypedNodeFields = {
    node,
    capability,
    props: typeFieldMap(node.props, validator.props, `${path}.props`, (source, contract, fieldPath) =>
      typeContractField(source, contract, fieldPath, context)
    ),
    bindings: typeFieldMap(node.bindings, validator.bindings, `${path}.bindings`, (source, contract, fieldPath) =>
      typeBinding(source, contract, fieldPath, context, nodeIds)
    )
  };
  for (const invariant of validator.invariant_ids) {
    const check = CAPABILITY_INVARIANTS[invariant];
    if (check === undefined || !check(fields)) {
      fail(context.errorCode, context.stage, path, `Node violates canonical invariant ${invariant}.`, node.capability);
    }
  }
  return fields;
}

function boundMutableState(fields: TypedNodeFields, bindingKey: string, context: TypingContext): TypeDescriptor | undefined {
  const binding = fields.bindings.get(bindingKey);
  if (binding?.source.kind !== "STATE") {
    return undefined;
  }
  const state = context.lookupState(binding.source.key);
  return state?.mutable === true ? state.descriptor : undefined;
}

function valuePayload(descriptor: TypeDescriptor): TypeDescriptor {
  const fields: Record<string, TypeDescriptor> = Object.create(null) as Record<string, TypeDescriptor>;
  fields.value = descriptor;
  return { type: "RECORD", constraints: { fields } };
}

export function resolveEventPayload(
  fields: TypedNodeFields,
  eventName: string,
  path: string,
  context: TypingContext
): TypeDescriptor {
  const contract = fields.capability.validator.events[eventName];
  const payload = contract?.payload;
  if (payload?.kind === "STATIC") {
    return payload.descriptor;
  }
  if (payload?.kind === "BOUND_STATE_DESCRIPTOR") {
    const state = boundMutableState(fields, payload.binding_key, context);
    if (state !== undefined) {
      return valuePayload(state);
    }
  }
  if (payload?.kind === "BOUND_STRING_NARROWED_BY_PROP") {
    const state = boundMutableState(fields, payload.binding_key, context);
    const maxLength = numberLiteral(fields.props, payload.prop_key);
    if (
      state?.type === "STRING" &&
      maxLength !== undefined &&
      Number.isInteger(maxLength) &&
      maxLength >= 0 &&
      maxLength <= state.constraints.max_length
    ) {
      return valuePayload({ type: "STRING", constraints: { max_length: maxLength } });
    }
  }
  return fail(context.errorCode, context.stage, path, "Event payload resolver did not produce a concrete descriptor.", fields.node.capability);
}

function randomMinMaxProven(args: ReadonlyMap<string, TypedField>): boolean {
  const largestMin = numberBounds(args.get("min")?.descriptor).max;
  const smallestMax = numberBounds(args.get("max")?.descriptor).min;
  return largestMin !== undefined && smallestMax !== undefined && largestMin <= smallestMax;
}

function scoreSetWithinBounds(target: TypedNodeFields, args: ReadonlyMap<string, TypedField>): boolean {
  const bounds = scoreBounds(target.props);
  const value = args.get("value")?.descriptor;
  const scoreTarget: TypeDescriptor =
    Object.keys(bounds).length === 0 ? { type: "NUMBER" } : { type: "NUMBER", constraints: bounds };
  return value !== undefined && isAssignable(value, scoreTarget);
}

export function checkActionInvariants(
  target: TypedNodeFields,
  actionName: string,
  args: ReadonlyMap<string, TypedField>,
  path: string,
  context: TypingContext
): void {
  const action = target.capability.validator.actions[actionName];
  for (const invariant of action?.invariant_ids ?? []) {
    if (invariant !== "RANDOM_MIN_MAX" || !randomMinMaxProven(args)) {
      fail(context.errorCode, context.stage, path, `Action arguments violate canonical invariant ${invariant}.`, target.node.capability);
    }
  }
  const scoreSet = target.capability.validator.invariant_ids.includes("SCORE_BOUNDS") && actionName === "set";
  if (scoreSet && !scoreSetWithinBounds(target, args)) {
    fail(context.errorCode, context.stage, path, "SCORE_BOUNDS requires set value within declared bounds.", target.node.capability);
  }
}
