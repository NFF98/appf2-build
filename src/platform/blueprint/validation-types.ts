import type { TypeDescriptor } from "../capabilities/schema/validator-contract.js";

export const BLUEPRINT_SCHEMA_VERSION = "1.0.0";
export const MAX_CANDIDATE_PAYLOAD_BYTES = 524_288;

export type ValidationStage =
  | "V01"
  | "V02"
  | "V03"
  | "V04"
  | "V05"
  | "V06"
  | "V07"
  | "V08"
  | "V09"
  | "V10"
  | "V11"
  | "V12";

export type F02ErrorCode =
  | "F02-ERR-001"
  | "F02-ERR-002"
  | "F02-ERR-003"
  | "F02-ERR-004"
  | "F02-ERR-005"
  | "F02-ERR-006"
  | "F02-ERR-007"
  | "F02-ERR-008"
  | "F02-ERR-009"
  | "F02-ERR-010"
  | "F02-ERR-011"
  | "F02-ERR-012"
  | "F02-ERR-013"
  | "F02-ERR-014"
  | "F02-ERR-015"
  | "F02-ERR-016"
  | "F02-ERR-017";

export type ValidationStatus = "PASSED" | "REJECTED" | "INCOMPATIBLE";

export interface CapabilityRef {
  readonly id: string;
  readonly version: string;
}

export interface ValidationIssue {
  readonly error_code: F02ErrorCode;
  readonly stage: ValidationStage;
  readonly json_path: string;
  readonly capability_ref?: CapabilityRef;
}

export class BlueprintValidationFailure extends Error {
  public constructor(
    public readonly issue: ValidationIssue,
    message: string
  ) {
    super(message);
    this.name = "BlueprintValidationFailure";
  }
}

export function fail(
  errorCode: F02ErrorCode,
  stage: ValidationStage,
  jsonPath: string,
  message: string,
  capabilityRef?: CapabilityRef
): never {
  const issue: ValidationIssue =
    capabilityRef === undefined
      ? { error_code: errorCode, stage, json_path: jsonPath }
      : { error_code: errorCode, stage, json_path: jsonPath, capability_ref: capabilityRef };
  throw new BlueprintValidationFailure(issue, message);
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type ValueSource =
  | { readonly kind: "LITERAL"; readonly value: JsonValue }
  | { readonly kind: "STATE"; readonly key: string }
  | { readonly kind: "RULE"; readonly rule_id: string }
  | { readonly kind: "EVENT"; readonly path: string }
  | { readonly kind: "SCOPE"; readonly name: string; readonly path: string }
  | { readonly kind: "OP"; readonly op: string; readonly args: readonly ValueSource[] };

export interface MutableStateEntry {
  readonly mode: "MUTABLE";
  readonly type: TypeDescriptor["type"];
  readonly initial: JsonValue;
  readonly constraints?: JsonValue;
}

export interface DerivedStateEntry {
  readonly mode: "DERIVED";
  readonly type: TypeDescriptor["type"];
  readonly expr: ValueSource;
}

export type StateEntry = MutableStateEntry | DerivedStateEntry;

export interface Degradation {
  readonly requirement_id: string;
  readonly description: string;
  readonly capability_refs: readonly CapabilityRef[];
  readonly preserves_semantic_core: boolean;
}

export interface Rule {
  readonly id: string;
  readonly result_type: TypeDescriptor["type"];
  readonly expr: ValueSource;
}

export interface Repeat {
  readonly items: ValueSource;
  readonly item_alias: string;
  readonly index_alias?: string;
  readonly max_items: number;
}

export interface BlueprintNode {
  readonly id: string;
  readonly capability: CapabilityRef;
  readonly props: Readonly<Record<string, ValueSource>>;
  readonly bindings: Readonly<Record<string, ValueSource>>;
  readonly events: Readonly<Record<string, string>>;
  readonly children: readonly string[];
  readonly repeat?: Repeat;
}

export type ActionStep =
  | {
      readonly type: "SET_STATE";
      readonly target: string;
      readonly value: ValueSource;
      readonly when?: ValueSource;
    }
  | {
      readonly type: "INVOKE_CAPABILITY";
      readonly target_node_id: string;
      readonly capability_action: string;
      readonly args: Readonly<Record<string, ValueSource>>;
      readonly when?: ValueSource;
    }
  | { readonly type: "RESET_STATE"; readonly target: string };

export interface BlueprintAction {
  readonly id: string;
  readonly steps: readonly ActionStep[];
}

export interface ResultOutput {
  readonly id: string;
  readonly label: string;
  readonly value: ValueSource;
  readonly sensitivity: "NORMAL" | "SENSITIVE" | "DO_NOT_PERSIST";
}

export interface Blueprint {
  readonly schema_version: string;
  readonly registry_version: string;
  readonly kind: "APP";
  readonly meta: { readonly title: string; readonly description?: string };
  readonly support: {
    readonly coverage_status: "FULLY_SUPPORTED" | "PARTIALLY_SUPPORTED";
    readonly degradations: readonly Degradation[];
  };
  readonly state: Readonly<Record<string, StateEntry>>;
  readonly rules: readonly Rule[];
  readonly actions: readonly BlueprintAction[];
  readonly nodes: readonly BlueprintNode[];
  readonly root_node_id: string;
  readonly result: { readonly outputs: readonly ResultOutput[] };
}

export interface ValidationReport {
  readonly validation_run_id: string;
  readonly candidate_digest: string;
  readonly status: ValidationStatus;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly content_hash?: string;
  readonly issues: readonly ValidationIssue[];
  readonly trace_id: string;
}

export interface AdmissibleBlueprint {
  readonly blueprint: Blueprint;
  readonly canonicalJson: string;
  readonly byteSize: number;
  readonly contentHash: string;
}

export type BlueprintValidationResult =
  | { readonly report: ValidationReport & { readonly status: "PASSED"; readonly content_hash: string }; readonly admissible: AdmissibleBlueprint }
  | { readonly report: ValidationReport & { readonly status: "REJECTED" | "INCOMPATIBLE" }; readonly admissible?: undefined };
