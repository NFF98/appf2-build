import type {
  ActionContract,
  BindingContract,
  BindingReference,
  BooleanDescriptor,
  EnumDescriptor,
  EnumMember,
  EventContract,
  FieldContract,
  InvariantId,
  ListDescriptor,
  NumberDescriptor,
  RecordDescriptor,
  SourceKind,
  StringDescriptor,
  TargetMatcher,
  TypeDescriptor,
  ValidatorContract
} from "../schema/validator-contract.js";

export const VIEW_SOURCE_KINDS: readonly SourceKind[] = ["LITERAL", "STATE", "RULE", "OP", "SCOPE"];
export const ACTION_ARG_SOURCE_KINDS: readonly SourceKind[] = [
  "LITERAL",
  "STATE",
  "RULE",
  "OP",
  "EVENT",
  "SCOPE"
];

export const NUMBER: NumberDescriptor = { type: "NUMBER" };
export const BOOLEAN: BooleanDescriptor = { type: "BOOLEAN" };

export function string(maxLength: number): StringDescriptor {
  return { type: "STRING", constraints: { max_length: maxLength } };
}

export function enumOf(...allowed: readonly EnumMember[]): EnumDescriptor {
  return { type: "ENUM", constraints: { allowed } };
}

export function list(item: TypeDescriptor, maxLength: number): ListDescriptor {
  return { type: "LIST", constraints: { item, max_length: maxLength } };
}

export function record(
  fields: Readonly<Record<string, TypeDescriptor>>,
  optionalFields: readonly string[] = []
): RecordDescriptor {
  if (optionalFields.length === 0) {
    return { type: "RECORD", constraints: { fields } };
  }
  return {
    type: "RECORD",
    constraints: { fields, optional_fields: [...optionalFields].sort() }
  };
}

export function exact(descriptor: TypeDescriptor): TargetMatcher {
  return { kind: "EXACT", descriptor };
}

interface FieldOptions {
  readonly required?: boolean;
  readonly invariants?: readonly InvariantId[];
}

function toMatcher(target: TypeDescriptor | TargetMatcher): TargetMatcher {
  return "kind" in target ? target : exact(target);
}

export function prop(target: TypeDescriptor | TargetMatcher, options: FieldOptions = {}): FieldContract {
  return field(target, ["LITERAL"], options);
}

export function field(
  target: TypeDescriptor | TargetMatcher,
  sourceKinds: readonly SourceKind[],
  options: FieldOptions = {}
): FieldContract {
  return {
    required: options.required ?? true,
    matcher: toMatcher(target),
    source_kinds: sourceKinds,
    invariant_ids: options.invariants ?? []
  };
}

interface BindingOptions extends FieldOptions {
  readonly mutableStateRequired?: boolean;
  readonly reference?: BindingReference;
}

export function binding(
  target: TypeDescriptor | TargetMatcher,
  sourceKinds: readonly SourceKind[],
  options: BindingOptions = {}
): BindingContract {
  return {
    ...field(target, sourceKinds, options),
    mutable_state_required: options.mutableStateRequired ?? false,
    reference: options.reference ?? "NONE"
  };
}

export function stateBinding(target: TypeDescriptor | TargetMatcher): BindingContract {
  return binding(target, ["STATE"], { mutableStateRequired: true });
}

export function staticEvent(fields: Readonly<Record<string, TypeDescriptor>> = {}): EventContract {
  return { payload: { kind: "STATIC", descriptor: record(fields) }, invariant_ids: [] };
}

export function action(
  args: Readonly<Record<string, FieldContract>> = {},
  invariants: readonly InvariantId[] = []
): ActionContract {
  return { args, invariant_ids: invariants };
}

export const LEAF_COMPOSITION = { children: false, repeat: false } as const;

export function validator(contract: Partial<ValidatorContract>): ValidatorContract {
  return {
    props: contract.props ?? {},
    bindings: contract.bindings ?? {},
    events: contract.events ?? {},
    actions: contract.actions ?? {},
    composition: contract.composition ?? LEAF_COMPOSITION,
    capability_state: contract.capability_state ?? "NONE",
    invariant_ids: contract.invariant_ids ?? []
  };
}
