import { CapabilityAdmissionError, matchesCapabilityVersionRange } from "../capabilities/admission.js";
import {
  isIntactRegistrySnapshot,
  SHA256_DIGEST_PATTERN,
  type TrustedRegistrySnapshot
} from "../capabilities/execution-contract.js";
import { parseBlueprintSchema } from "./blueprint-schema.js";
import { parseCandidatePayload } from "./candidate-intake.js";
import { canonicalizeJson } from "./canonical-json.js";
import {
  createCapabilityEligibilityEvaluator,
  lookupCapability,
  type CapabilityIneligibilityReason
} from "./capability-eligibility.js";
import { hashCanonicalBlueprintBytes } from "./content-identity.js";
import { BlueprintValidationFailure, type Blueprint, type CapabilityRef } from "./validation-types.js";

export const EXECUTION_ADMISSION_VERSION = "1.0.0";
export const EXECUTION_ADMISSION_TTL_MS = 30_000;

export interface BlueprintExecutionRecord {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: string;
  readonly admitted_registry_digest: string | null;
}

export interface BlueprintExecutionRecordReader {
  loadExecutionRecord(contentHash: string): Promise<BlueprintExecutionRecord | undefined>;
}

export interface TrustedRegistrySnapshotStore {
  pinned(registryVersion: string): Promise<TrustedRegistrySnapshot | undefined>;
  current(): Promise<TrustedRegistrySnapshot>;
}

export interface ExecutionAdmissionDeployment {
  readonly runtimeVersion: string;
  readonly supportedBlueprintSchemaRange: string;
  readonly snapshots: TrustedRegistrySnapshotStore;
  readonly now: () => Date;
  readonly newAdmissionId: () => string;
}

export interface ExecutionAdmissionDependencies {
  readonly blueprints: BlueprintExecutionRecordReader;
  readonly deployment: ExecutionAdmissionDeployment;
}

export interface ExecutionRuntimeContext {
  readonly runtime_version: string;
  readonly supported_blueprint_schema_range: string;
  readonly registry_snapshot: TrustedRegistrySnapshot;
  readonly current_registry_snapshot: TrustedRegistrySnapshot;
  readonly now: Date;
}

export interface ExecutionAdmission {
  readonly admission_version: string;
  readonly admission_id: string;
  readonly content_hash: string;
  readonly executable: true;
  readonly trust_status: "VALIDATED";
  readonly schema_version: string;
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly runtime_version: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export type ExecutionDenialStage = "E02" | "E03" | "E04" | "E05" | "E06" | "E07";

export type ExecutionDenialReason =
  | "BLUEPRINT_REVOKED"
  | "BLUEPRINT_INCOMPATIBLE"
  | "TRUST_NOT_VALIDATED"
  | "CONTENT_INTEGRITY_FAILURE"
  | "BLUEPRINT_SCHEMA_UNSUPPORTED"
  | "PINNED_SNAPSHOT_UNAVAILABLE"
  | "PINNED_SNAPSHOT_INTEGRITY_MISMATCH"
  | "CURRENT_SNAPSHOT_MISSING_REF"
  | "EXECUTION_CONTRACT_DIGEST_DRIFT"
  | CapabilityIneligibilityReason;

export interface ExecutionDenial {
  readonly kind: "DENIED";
  readonly executable: false;
  readonly stage: ExecutionDenialStage;
  readonly error_code?: "F02-ERR-016" | "F02-ERR-017";
  readonly reason: ExecutionDenialReason;
  readonly capability_ref?: CapabilityRef;
}

export type ExecutionAdmissionDecision =
  | { readonly kind: "ALLOWED"; readonly admission: ExecutionAdmission }
  | { readonly kind: "NOT_FOUND"; readonly executable: false; readonly stage: "E01"; readonly http_status: 404 }
  | ExecutionDenial
  | {
      readonly kind: "UNAVAILABLE";
      readonly executable: false;
      readonly stage: "E08";
      readonly http_status: 503;
      readonly retryable: true;
    };

const NOT_FOUND: ExecutionAdmissionDecision = { kind: "NOT_FOUND", executable: false, stage: "E01", http_status: 404 };
const UNAVAILABLE: ExecutionAdmissionDecision = {
  kind: "UNAVAILABLE",
  executable: false,
  stage: "E08",
  http_status: 503,
  retryable: true
};

function deny(
  stage: ExecutionDenialStage,
  reason: ExecutionDenialReason,
  capabilityRef?: CapabilityRef
): ExecutionDenial {
  const errorCode = stage === "E02" ? "F02-ERR-016" : stage === "E04" ? undefined : "F02-ERR-017";
  return {
    kind: "DENIED",
    executable: false,
    stage,
    reason,
    ...(errorCode === undefined ? {} : { error_code: errorCode }),
    ...(capabilityRef === undefined ? {} : { capability_ref: capabilityRef })
  };
}

function readContentHash(request: unknown): string | undefined {
  if (request === null || typeof request !== "object" || !Object.hasOwn(request, "content_hash")) {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(request, "content_hash");
  const value: unknown = descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
  return typeof value === "string" && SHA256_DIGEST_PATTERN.test(value) ? value : undefined;
}

function trustDenial(trustStatus: string): ExecutionDenial | undefined {
  if (trustStatus === "REVOKED") {
    return deny("E02", "BLUEPRINT_REVOKED");
  }
  if (trustStatus === "INCOMPATIBLE") {
    return deny("E03", "BLUEPRINT_INCOMPATIBLE");
  }
  return trustStatus === "VALIDATED" ? undefined : deny("E04", "TRUST_NOT_VALIDATED");
}

function loadAdmittedBody(record: BlueprintExecutionRecord): Blueprint | undefined {
  try {
    const canonicalBytes = new TextEncoder().encode(canonicalizeJson(record.canonical_blueprint));
    if (hashCanonicalBlueprintBytes(canonicalBytes) !== record.content_hash) {
      return undefined;
    }
    const blueprint = parseBlueprintSchema(parseCandidatePayload(canonicalBytes));
    const matchesRecord =
      blueprint.schema_version === record.schema_version && blueprint.registry_version === record.registry_version;
    return matchesRecord ? blueprint : undefined;
  } catch (error: unknown) {
    if (error instanceof BlueprintValidationFailure || error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
}

function schemaSupported(schemaVersion: string, supportedRange: string): boolean {
  try {
    return matchesCapabilityVersionRange(schemaVersion, supportedRange);
  } catch (error: unknown) {
    if (error instanceof CapabilityAdmissionError) {
      return false;
    }
    throw error;
  }
}

function directRefs(blueprint: Blueprint): readonly CapabilityRef[] {
  const refs = new Map<string, CapabilityRef>();
  for (const node of blueprint.nodes) {
    refs.set(`${node.capability.id}@${node.capability.version}`, node.capability);
  }
  return [...refs.values()];
}

function pinnedDenial(
  blueprint: Blueprint,
  admittedRegistryDigest: string | null,
  pinned: TrustedRegistrySnapshot
): ExecutionDenial | undefined {
  const intact =
    pinned.registry_version === blueprint.registry_version &&
    admittedRegistryDigest !== null &&
    pinned.registry_digest === admittedRegistryDigest &&
    isIntactRegistrySnapshot(pinned) &&
    directRefs(blueprint).every((ref) => lookupCapability(pinned.validator_registry, ref) !== undefined);
  return intact ? undefined : deny("E06", "PINNED_SNAPSHOT_INTEGRITY_MISMATCH");
}

export function evaluateCurrentEligibility(
  blueprint: Blueprint,
  context: ExecutionRuntimeContext
): ExecutionDenial | undefined {
  const pinned = context.registry_snapshot.validator_registry;
  const current = context.current_registry_snapshot.validator_registry;
  const eligibility = createCapabilityEligibilityEvaluator(current, {
    blueprintSchemaVersion: blueprint.schema_version,
    runtimeVersion: context.runtime_version
  });
  for (const ref of directRefs(blueprint)) {
    const currentEntry = lookupCapability(current, ref);
    if (currentEntry === undefined) {
      return deny("E07", "CURRENT_SNAPSHOT_MISSING_REF", ref);
    }
    if (currentEntry.execution_contract_digest !== lookupCapability(pinned, ref)?.execution_contract_digest) {
      return deny("E07", "EXECUTION_CONTRACT_DIGEST_DRIFT", ref);
    }
    const ineligible = eligibility.evaluate(ref);
    if (ineligible !== undefined) {
      return deny("E07", ineligible.reason, ref);
    }
  }
  return undefined;
}

function allow(
  contentHash: string,
  blueprint: Blueprint,
  context: ExecutionRuntimeContext,
  admissionId: string
): ExecutionAdmissionDecision {
  const issuedAt = context.now;
  return {
    kind: "ALLOWED",
    admission: {
      admission_version: EXECUTION_ADMISSION_VERSION,
      admission_id: admissionId,
      content_hash: contentHash,
      executable: true,
      trust_status: "VALIDATED",
      schema_version: blueprint.schema_version,
      registry_version: context.registry_snapshot.registry_version,
      registry_digest: context.registry_snapshot.registry_digest,
      runtime_version: context.runtime_version,
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + EXECUTION_ADMISSION_TTL_MS).toISOString()
    }
  };
}

async function attempt<T>(load: () => Promise<T>): Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }> {
  try {
    return { ok: true, value: await load() };
  } catch {
    return { ok: false };
  }
}

export async function issueExecutionAdmission(
  request: unknown,
  dependencies: ExecutionAdmissionDependencies
): Promise<ExecutionAdmissionDecision> {
  const contentHash = readContentHash(request);
  if (contentHash === undefined) {
    return NOT_FOUND;
  }
  const { deployment } = dependencies;
  const loaded = await attempt(() => dependencies.blueprints.loadExecutionRecord(contentHash));
  if (!loaded.ok) {
    return UNAVAILABLE;
  }
  const record = loaded.value;
  if (record === undefined) {
    return NOT_FOUND;
  }
  const trust = trustDenial(record.trust_status);
  if (trust !== undefined) {
    return trust;
  }
  const blueprint = loadAdmittedBody(record);
  if (blueprint === undefined) {
    return deny("E04", "CONTENT_INTEGRITY_FAILURE");
  }
  if (!schemaSupported(blueprint.schema_version, deployment.supportedBlueprintSchemaRange)) {
    return deny("E05", "BLUEPRINT_SCHEMA_UNSUPPORTED");
  }
  const pinned = await attempt(() => deployment.snapshots.pinned(blueprint.registry_version));
  if (!pinned.ok) {
    return UNAVAILABLE;
  }
  if (pinned.value === undefined) {
    return deny("E06", "PINNED_SNAPSHOT_UNAVAILABLE");
  }
  const pinnedProblem = pinnedDenial(blueprint, record.admitted_registry_digest, pinned.value);
  if (pinnedProblem !== undefined) {
    return pinnedProblem;
  }
  const current = await attempt(() => deployment.snapshots.current());
  if (!current.ok || !isIntactRegistrySnapshot(current.value)) {
    return UNAVAILABLE;
  }
  const context: ExecutionRuntimeContext = {
    runtime_version: deployment.runtimeVersion,
    supported_blueprint_schema_range: deployment.supportedBlueprintSchemaRange,
    registry_snapshot: pinned.value,
    current_registry_snapshot: current.value,
    now: deployment.now()
  };
  return evaluateCurrentEligibility(blueprint, context) ?? allow(contentHash, blueprint, context, deployment.newAdmissionId());
}
