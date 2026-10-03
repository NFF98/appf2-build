import type {
  Availability,
  CapabilityDefinition,
  ExecutionClass,
  ExecutionStatus,
  PermissionClass,
  ResourceBudget,
  ResourceUsageProfile
} from "./capability-definition.js";

export const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const SOURCE_KINDS = ["LITERAL", "STATE", "RULE", "OP", "EVENT", "SCOPE"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const INVARIANT_IDS = [
  "NUM_INTEGER",
  "NUM_GT_ZERO",
  "NUM_GTE_ZERO",
  "NUM_INT_RANGE_0_8192",
  "NUM_INT_RANGE_0_500",
  "INPUT_NUMBER_BOUNDS",
  "INPUT_TEXT_BOUND",
  "SELECT_ENUM_DOMAIN",
  "STAT_FORMAT",
  "TABLE_COLUMNS",
  "TABLE_ROWS_BOUND",
  "RANDOM_MIN_MAX",
  "SCORE_BOUNDS"
] as const;
export type InvariantId = (typeof INVARIANT_IDS)[number];

export const FIELD_VALUE_INVARIANT_IDS = [
  "NUM_INTEGER",
  "NUM_GT_ZERO",
  "NUM_GTE_ZERO",
  "NUM_INT_RANGE_0_8192",
  "NUM_INT_RANGE_0_500"
] as const satisfies readonly InvariantId[];
export const CAPABILITY_INVARIANT_IDS = [
  "INPUT_NUMBER_BOUNDS",
  "INPUT_TEXT_BOUND",
  "SELECT_ENUM_DOMAIN",
  "STAT_FORMAT",
  "TABLE_COLUMNS",
  "TABLE_ROWS_BOUND",
  "SCORE_BOUNDS"
] as const satisfies readonly InvariantId[];
export const ACTION_INVARIANT_IDS = ["RANDOM_MIN_MAX"] as const satisfies readonly InvariantId[];

export type EnumMember = string | number | boolean;

export interface NumberDescriptor {
  readonly type: "NUMBER";
  readonly constraints?: { readonly min?: number; readonly max?: number };
}

export interface StringDescriptor {
  readonly type: "STRING";
  readonly constraints: { readonly max_length: number };
}

export interface BooleanDescriptor {
  readonly type: "BOOLEAN";
}

export interface EnumDescriptor {
  readonly type: "ENUM";
  readonly constraints: { readonly allowed: readonly EnumMember[] };
}

export interface ListDescriptor {
  readonly type: "LIST";
  readonly constraints: { readonly item: TypeDescriptor; readonly max_length: number };
}

export interface RecordDescriptor {
  readonly type: "RECORD";
  readonly constraints: {
    readonly fields: Readonly<Record<string, TypeDescriptor>>;
    readonly optional_fields?: readonly string[];
  };
}

export type TypeDescriptor =
  | NumberDescriptor
  | StringDescriptor
  | BooleanDescriptor
  | EnumDescriptor
  | ListDescriptor
  | RecordDescriptor;

export type DescriptorType = TypeDescriptor["type"];
export const DESCRIPTOR_TYPES = ["NUMBER", "STRING", "BOOLEAN", "ENUM", "LIST", "RECORD"] as const satisfies readonly DescriptorType[];

export type TargetMatcher =
  | { readonly kind: "EXACT"; readonly descriptor: TypeDescriptor }
  | { readonly kind: "ONE_OF"; readonly options: readonly TargetMatcher[] }
  | { readonly kind: "ANY_ENUM" }
  | { readonly kind: "ANY_RECORD" }
  | { readonly kind: "LIST_OF"; readonly item: TargetMatcher; readonly max_length?: number };

export interface FieldContract {
  readonly required: boolean;
  readonly matcher: TargetMatcher;
  readonly source_kinds: readonly SourceKind[];
  readonly invariant_ids: readonly InvariantId[];
}

export type BindingReference = "ACTION_ID" | "NODE_ID" | "NONE";

export interface BindingContract extends FieldContract {
  readonly mutable_state_required: boolean;
  readonly reference: BindingReference;
}

export type EventPayloadDescriptorResolver =
  | { readonly kind: "STATIC"; readonly descriptor: TypeDescriptor }
  | { readonly kind: "BOUND_STATE_DESCRIPTOR"; readonly binding_key: string }
  | {
      readonly kind: "BOUND_STRING_NARROWED_BY_PROP";
      readonly binding_key: string;
      readonly prop_key: string;
    };

export interface EventContract {
  readonly payload: EventPayloadDescriptorResolver;
  readonly invariant_ids: readonly InvariantId[];
}

export interface ActionContract {
  readonly args: Readonly<Record<string, FieldContract>>;
  readonly invariant_ids: readonly InvariantId[];
}

export interface CompositionContract {
  readonly children: boolean;
  readonly repeat: boolean;
  readonly repeat_required?: boolean;
}

export interface ValidatorContract {
  readonly props: Readonly<Record<string, FieldContract>>;
  readonly bindings: Readonly<Record<string, BindingContract>>;
  readonly events: Readonly<Record<string, EventContract>>;
  readonly actions: Readonly<Record<string, ActionContract>>;
  readonly composition: CompositionContract;
  readonly capability_state: TypeDescriptor | "NONE";
  readonly invariant_ids: readonly InvariantId[];
}

export interface GeneratedCapabilityValidator {
  readonly id: string;
  readonly version: string;
  readonly validator: ValidatorContract;
  readonly permission_class: PermissionClass;
  readonly resource_budget: ResourceBudget;
  readonly resource_usage: ResourceUsageProfile;
  readonly availability: Availability;
  readonly execution_status: ExecutionStatus;
  readonly execution_class: ExecutionClass;
  readonly compatibility: CapabilityDefinition["compatibility"];
  readonly degradation: CapabilityDefinition["degradation"];
}

export interface ValidatorRegistry {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly runtime_version: string;
  readonly capabilities: Readonly<
    Record<string, Readonly<Record<string, GeneratedCapabilityValidator>>>
  >;
}
