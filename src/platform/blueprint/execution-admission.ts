import { randomUUID } from "node:crypto";

import { CapabilityAdmissionError, matchesCapabilityVersionRange } from "../capabilities/admission.js";
import type { ValidatorRegistry } from "../capabilities/schema/validator-contract.js";
import { lookupCapability } from "./capability-contract.js";
import { createCapabilityEligibilityEvaluator, type CapabilityIneligibility } from "./capability-eligibility.js";
import type { CapabilityRef } from "./validation-types.js";

export const EXECUTION_ADMISSION_VERSION = "1.0.0";
export const EXECUTION_ADMISSION_TTL_MS = 30_000;

const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface BlueprintTrustRecord {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: string;
}

export interface BlueprintTrustReader {
  getBlueprintTrust(contentHash: string): Promise<BlueprintTrustRecord | undefined>;
}

export interface TrustedRegistrySnapshot {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly validator_registry: ValidatorRegistry;
}

export interface ExecutionDeployment {
  readonly runtimeVersion: string;
  readonly supportedBlueprintSchemaRange: string;
  readonly registrySnapshots: ReadonlyMap<string, TrustedRegistrySnapshot>;
  readonly now: () => Date;
  readonly newAdmissionId?: () => string;
}

export interface ExecutionRuntimeContext {
  readonly runtime_version: string;
  readonly supported_blueprint_schema_range: string;
  readonly registry_snapshot: TrustedRegistrySnapshot | undefined;
  readonly now: Date;
}

export interface ExecutionAdmission {
  readonly admission_version: typeof EXECUTION_ADMISSION_VERSION;
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

export interface CapabilityExecutionDiagnostic {
  readonly capability_ref: CapabilityRef;
  readonly reason: CapabilityIneligibility | "UNKNOWN_CAPABILITY";
}

export type ExecutionDenial =
  | { readonly kind: "DENIED"; readonly step: "E02"; readonly executable: false; readonly error_code: "F02-ERR-016" }
  | { readonly kind: "DENIED"; readonly step: "E03" | "E05" | "E06"; readonly executable: false; readonly error_code: "F02-ERR-017" }
  | { readonly kind: "DENIED"; readonly step: "E04"; readonly executable: false }
  | {
      readonly kind: "DENIED";
      readonly step: "E07";
      readonly executable: false;
      readonly error_code: "F02-ERR-017";
      readonly diagnostic: CapabilityExecutionDiagnostic;
    };

export type ExecutionAdmissionDecision =
  | { readonly kind: "ALLOWED"; readonly admission: ExecutionAdmission }
  | { readonly kind: "NOT_FOUND"; readonly step: "E01"; readonly executable: false; readonly http_status: 404 }
  | ExecutionDenial
  | {
      readonly kind: "UNAVAILABLE";
      readonly step: "E08";
      readonly executable: false;
      readonly http_status: 503;
      readonly retryable: true;
    };

export interface ExecutionAdmissionService {
  issueExecutionAdmission(contentHash: string): Promise<ExecutionAdmissionDecision>;
}

export class UntrustedExecutionContextError extends Error {
  public constructor() {
    super("ExecutionRuntimeContext must be constructed from trusted server deployment truth.");
    this.name = "UntrustedExecutionContextError";
  }
}

class StoredBlueprintIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "StoredBlueprintIntegrityError";
  }
}

const TRUSTED_CONTEXTS = new WeakSet<object>();

export function createExecutionRuntimeContext(
  deployment: ExecutionDeployment,
  registryVersion: string
): ExecutionRuntimeContext {
  const context: ExecutionRuntimeContext = Object.freeze({
    runtime_version: deployment.runtimeVersion,
    supported_blueprint_schema_range: deployment.supportedBlueprintSchemaRange,
    registry_snapshot: deployment.registrySnapshots.get(registryVersion),
    now: new Date(deployment.now().getTime())
  });
  TRUSTED_CONTEXTS.add(context);
  return context;
}

const BLUEPRINT_REVOKED: ExecutionDenial = { kind: "DENIED", step: "E02", executable: false, error_code: "F02-ERR-016" };
const TRUST_NOT_VALIDATED: ExecutionDenial = { kind: "DENIED", step: "E04", executable: false };

function incompatible(step: "E03" | "E05" | "E06"): ExecutionDenial {
  return { kind: "DENIED", step, executable: false, error_code: "F02-ERR-017" };
}

function schemaSupported(schemaVersion: string, range: string): boolean {
  try {
    return matchesCapabilityVersionRange(schemaVersion, range);
  } catch (error: unknown) {
    if (error instanceof CapabilityAdmissionError) {
      return false;
    }
    throw error;
  }
}

function snapshotIntact(snapshot: TrustedRegistrySnapshot | undefined, registryVersion: string): snapshot is TrustedRegistrySnapshot {
  return (
    snapshot !== undefined &&
    snapshot.registry_version === registryVersion &&
    snapshot.validator_registry.registry_version === snapshot.registry_version &&
    snapshot.validator_registry.registry_digest === snapshot.registry_digest
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function referencedCapabilities(canonicalBlueprint: unknown): readonly CapabilityRef[] {
  const nodes = isRecord(canonicalBlueprint) ? canonicalBlueprint.nodes : undefined;
  if (!Array.isArray(nodes)) {
    throw new StoredBlueprintIntegrityError("Stored Blueprint body has no node list.");
  }
  const refs = new Map<string, CapabilityRef>();
  for (const node of nodes as readonly unknown[]) {
    const ref = isRecord(node) ? node.capability : undefined;
    if (!isRecord(ref) || typeof ref.id !== "string" || typeof ref.version !== "string") {
      throw new StoredBlueprintIntegrityError("Stored Blueprint node has no exact CapabilityRef.");
    }
    const key = `${ref.id}@${ref.version}`;
    if (!refs.has(key)) {
      refs.set(key, { id: ref.id, version: ref.version });
    }
  }
  return [...refs.values()];
}

function firstIneligibleCapability(
  content: BlueprintTrustRecord,
  context: ExecutionRuntimeContext,
  registry: ValidatorRegistry
): CapabilityExecutionDiagnostic | undefined {
  const ineligibility = createCapabilityEligibilityEvaluator(registry, {
    schemaVersion: content.schema_version,
    runtimeVersion: context.runtime_version
  });
  for (const ref of referencedCapabilities(content.canonical_blueprint)) {
    const capability = lookupCapability(registry, ref);
    const reason = capability === undefined ? "UNKNOWN_CAPABILITY" : ineligibility(capability);
    if (reason !== undefined) {
      return { capability_ref: ref, reason };
    }
  }
  return undefined;
}

export function assertExecutable(
  content: BlueprintTrustRecord,
  context: ExecutionRuntimeContext
): ExecutionDenial | undefined {
  if (!TRUSTED_CONTEXTS.has(context)) {
    throw new UntrustedExecutionContextError();
  }
  if (content.trust_status === "REVOKED") {
    return BLUEPRINT_REVOKED;
  }
  if (content.trust_status === "INCOMPATIBLE") {
    return incompatible("E03");
  }
  if (content.trust_status !== "VALIDATED") {
    return TRUST_NOT_VALIDATED;
  }
  if (!schemaSupported(content.schema_version, context.supported_blueprint_schema_range)) {
    return incompatible("E05");
  }
  if (!snapshotIntact(context.registry_snapshot, content.registry_version)) {
    return incompatible("E06");
  }
  const diagnostic = firstIneligibleCapability(content, context, context.registry_snapshot.validator_registry);
  return diagnostic === undefined
    ? undefined
    : { kind: "DENIED", step: "E07", executable: false, error_code: "F02-ERR-017", diagnostic };
}

function admissionFor(
  content: BlueprintTrustRecord,
  context: ExecutionRuntimeContext,
  admissionId: string
): ExecutionAdmission {
  const snapshot = context.registry_snapshot as TrustedRegistrySnapshot;
  return {
    admission_version: EXECUTION_ADMISSION_VERSION,
    admission_id: admissionId,
    content_hash: content.content_hash,
    executable: true,
    trust_status: "VALIDATED",
    schema_version: content.schema_version,
    registry_version: snapshot.registry_version,
    registry_digest: snapshot.registry_digest,
    runtime_version: context.runtime_version,
    issued_at: context.now.toISOString(),
    expires_at: new Date(context.now.getTime() + EXECUTION_ADMISSION_TTL_MS).toISOString()
  };
}

const UNAVAILABLE: ExecutionAdmissionDecision = {
  kind: "UNAVAILABLE",
  step: "E08",
  executable: false,
  http_status: 503,
  retryable: true
};

const NOT_FOUND: ExecutionAdmissionDecision = { kind: "NOT_FOUND", step: "E01", executable: false, http_status: 404 };

export function createExecutionAdmissionService(
  reader: BlueprintTrustReader,
  deployment: ExecutionDeployment
): ExecutionAdmissionService {
  return {
    async issueExecutionAdmission(contentHash: string): Promise<ExecutionAdmissionDecision> {
      if (!CONTENT_HASH_PATTERN.test(contentHash)) {
        return NOT_FOUND;
      }
      try {
        const content = await reader.getBlueprintTrust(contentHash);
        if (content === undefined) {
          return NOT_FOUND;
        }
        if (content.content_hash !== contentHash) {
          throw new StoredBlueprintIntegrityError("Blueprint trust reader returned a different content hash.");
        }
        const context = createExecutionRuntimeContext(deployment, content.registry_version);
        const denial = assertExecutable(content, context);
        if (denial !== undefined) {
          return denial;
        }
        return { kind: "ALLOWED", admission: admissionFor(content, context, (deployment.newAdmissionId ?? randomUUID)()) };
      } catch {
        return UNAVAILABLE;
      }
    }
  };
}
