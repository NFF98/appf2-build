import type { ValidatorContract } from "./validator-contract.js";

export const CAPABILITY_FAMILIES = [
  "LAYOUT",
  "CONTENT",
  "INPUT",
  "DATA",
  "LOGIC",
  "GAME",
  "MOTION",
  "MEDIA",
  "DEVICE",
  "SOCIAL",
  "SYSTEM",
  "EXTERNAL",
  "SPATIAL"
] as const;

export const CONTRACT_KINDS = ["VIEW", "INPUT", "LOGIC", "EFFECT", "SYSTEM"] as const;
export const EXECUTION_CLASSES = ["LOCAL_REACT", "LOCAL_RULE", "LOCAL_EFFECT"] as const;
export const REPLAY_CLASSES = ["DETERMINISTIC", "SEEDED", "TIME_DEPENDENT"] as const;
export const PERMISSION_CLASSES = [
  "NONE",
  "USER_GESTURE",
  "BROWSER_PERMISSION",
  "ACCOUNT_REQUIRED",
  "EXTERNAL_ENTITLEMENT"
] as const;
export const MATURITY_LEVELS = ["PROPOSED", "POC", "BUILT", "TESTED", "VALIDATED", "RELEASED"] as const;
export const AVAILABILITY_LEVELS = ["DISABLED", "EXPERIMENTAL", "ENABLED"] as const;
export const EXECUTION_STATUSES = ["ACTIVE", "REVOKED"] as const;

export type CapabilityFamily = (typeof CAPABILITY_FAMILIES)[number];
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export type ExecutionClass = (typeof EXECUTION_CLASSES)[number];
export type ReplayClass = (typeof REPLAY_CLASSES)[number];
export type PermissionClass = (typeof PERMISSION_CLASSES)[number];
export type Maturity = (typeof MATURITY_LEVELS)[number];
export type Availability = (typeof AVAILABILITY_LEVELS)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export interface CapabilityRef {
  readonly id: string;
  readonly version: string;
}

export interface CapabilityDependency {
  readonly id: string;
  readonly versionRange: string;
  readonly required: boolean;
}

export interface SchemaReference {
  readonly ref: string;
}

export interface PortDefinition {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
}

export interface ResourceBudget {
  readonly maxInstancesPerBlueprint: number;
  readonly maxSerializedPropsBytes: number;
  readonly maxLocalStateBytes: number;
  readonly maxEventBindings: number;
  readonly maxActionBindings: number;
  readonly maxConcurrentTimers: number;
  readonly mediaAutoplayAllowed: boolean;
  readonly networkAccessAllowed: boolean;
}

export interface ResourceUsageProfile {
  readonly timerSlotsPerInstance: number;
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly version: string;
  readonly family: CapabilityFamily;
  readonly displayName: string;
  readonly semantic: {
    readonly meaning: string;
    readonly intentClasses: readonly string[];
    readonly selectionHints: readonly string[];
    readonly rejectionHints: readonly string[];
  };
  readonly contract: {
    readonly kind: ContractKind;
    readonly propsSchema: SchemaReference;
    readonly stateSchema: SchemaReference;
    readonly inputs: readonly PortDefinition[];
    readonly outputs: readonly PortDefinition[];
    readonly actions: readonly string[];
    readonly events: readonly string[];
    readonly bindings: readonly string[];
    readonly operators: readonly string[];
    readonly validator: ValidatorContract;
  };
  readonly runtime: {
    readonly execution: ExecutionClass;
    readonly registrationKey: string;
    readonly deterministic: boolean;
    readonly replayClass: ReplayClass;
    readonly permissionClass: PermissionClass;
    readonly resourceBudget: ResourceBudget;
    readonly resourceUsage: ResourceUsageProfile;
  };
  readonly product: {
    readonly shareability: "FULL" | "REDACT_SENSITIVE" | "NONE";
    readonly remixability: "FULL" | "CONFIG_ONLY" | "NONE";
    readonly persistenceClass: "BLUEPRINT" | "RUNTIME_STATE" | "EPHEMERAL";
    readonly sensitiveFields: readonly string[];
    readonly socialPotential: "NONE" | "LOW" | "MEDIUM" | "HIGH";
    readonly costClass: "FREE_LOCAL" | "METERED" | "EXTERNAL";
  };
  readonly compatibility: {
    readonly minRuntimeVersion: string;
    readonly maxRuntimeVersion: string;
    readonly blueprintSchemaRange: string;
    readonly dependencies: readonly CapabilityDependency[];
  };
  readonly degradation: {
    readonly allowed: boolean;
    readonly alternatives: readonly CapabilityRef[];
    readonly preservesSemanticCore: boolean;
  };
  readonly lifecycle: {
    readonly targetHorizon: "CORE" | "OPTIONAL";
    readonly maturity: Maturity;
    readonly availability: Availability;
    readonly executionStatus: ExecutionStatus;
    readonly releaseRequirement: "RELEASE_BLOCKING" | "EVIDENCE_GATED";
  };
}

export interface RegistrySource {
  readonly registryVersion: string;
  readonly runtimeVersion: string;
  readonly blueprintSchemaRange: string;
  readonly capabilities: readonly CapabilityDefinition[];
}
