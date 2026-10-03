import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import {
  issueExecutionAdmission,
  type ExecutionAdmissionDecision,
  type TrustedRegistrySnapshotStore
} from "../../src/platform/blueprint/execution-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import type { TrustedRegistrySnapshot } from "../../src/platform/capabilities/execution-contract.js";
import { buildRegistrySnapshot } from "../../src/platform/capabilities/generate-registry.js";
import { BLUEPRINT_SCHEMA_RANGE, CAPABILITY_REGISTRY_SOURCE, RUNTIME_VERSION } from "../../src/platform/capabilities/registry.js";
import type { CapabilityDefinition, RegistrySource } from "../../src/platform/capabilities/schema/capability-definition.js";
import { FakeBlueprintPostgres } from "./blueprint-postgres-fake.js";
import { encode, node, source, validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";

export const NOW = new Date("2026-10-04T08:00:00.000Z");
export const ADMISSION_ID = "00000000-0000-4000-8000-0000000000ad";

export function coreDefinition(id: string): CapabilityDefinition {
  const found = CAPABILITY_REGISTRY_SOURCE.capabilities.find((definition) => definition.id === id);
  if (found === undefined) {
    throw new Error(`Missing core capability ${id}.`);
  }
  return found;
}

export function cloneCapability(
  baseId: string,
  id: string,
  version: string,
  change: (definition: CapabilityDefinition) => CapabilityDefinition = (definition) => definition
): CapabilityDefinition {
  const base = coreDefinition(baseId);
  return change({
    ...base,
    id,
    version,
    runtime: { ...base.runtime, registrationKey: `${id}/${version}` },
    contract: {
      ...base.contract,
      propsSchema: { ref: `capability://${id}/${version}/props` },
      stateSchema: { ref: `capability://${id}/${version}/state` }
    }
  });
}

export function withCompatibility(
  definition: CapabilityDefinition,
  compatibility: Partial<CapabilityDefinition["compatibility"]>
): CapabilityDefinition {
  return { ...definition, compatibility: { ...definition.compatibility, ...compatibility } };
}

export function withLifecycle(
  definition: CapabilityDefinition,
  lifecycle: Partial<CapabilityDefinition["lifecycle"]>
): CapabilityDefinition {
  return { ...definition, lifecycle: { ...definition.lifecycle, ...lifecycle } };
}

export function registrySource(
  registryVersion: string,
  capabilities: readonly CapabilityDefinition[] = CAPABILITY_REGISTRY_SOURCE.capabilities
): RegistrySource {
  return { ...CAPABILITY_REGISTRY_SOURCE, registryVersion, capabilities };
}

export function policyPatch(
  base: RegistrySource,
  registryVersion: string,
  id: string,
  lifecycle: Partial<CapabilityDefinition["lifecycle"]>
): RegistrySource {
  return registrySource(
    registryVersion,
    base.capabilities.map((definition) => (definition.id === id ? withLifecycle(definition, lifecycle) : definition))
  );
}

export function snapshotOf(source: RegistrySource): TrustedRegistrySnapshot {
  const validatorRegistry = buildRegistrySnapshot(source);
  return {
    registry_version: validatorRegistry.registry_version,
    registry_digest: validatorRegistry.registry_digest,
    validator_registry: validatorRegistry
  };
}

export function blueprintWithTextNode(registryVersion: string, capabilityId: string, version: string): JsonRecord {
  const candidate = validBlueprint();
  candidate.registry_version = registryVersion;
  const nodes = candidate.nodes as JsonRecord[];
  nodes.push(
    node("node_extra", capabilityId, version, {
      props: { role: source.lit("BODY") },
      bindings: { text: source.lit("extra") }
    })
  );
  const root = nodes[0] as { children: string[] };
  root.children.push("node_extra");
  return candidate;
}

export function validateAgainst(
  candidate: JsonRecord,
  snapshot: TrustedRegistrySnapshot,
  runtimeVersion?: string
): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate), {
    registry: snapshot.validator_registry,
    ...(runtimeVersion === undefined ? {} : { runtimeVersion })
  });
}

export interface SnapshotStoreOptions {
  readonly pinned: readonly TrustedRegistrySnapshot[];
  readonly current: () => Promise<TrustedRegistrySnapshot>;
}

export function snapshotStore(options: SnapshotStoreOptions): TrustedRegistrySnapshotStore {
  const byVersion = new Map(options.pinned.map((snapshot) => [snapshot.registry_version, snapshot] as const));
  return {
    pinned: async (registryVersion) => byVersion.get(registryVersion),
    current: options.current
  };
}

export interface AdmittedBlueprint {
  readonly database: FakeBlueprintPostgres;
  readonly repository: PostgresBlueprintAdmissionRepository;
  readonly contentHash: string;
}

export async function admitValidated(candidate: JsonRecord, snapshot: TrustedRegistrySnapshot): Promise<AdmittedBlueprint> {
  const database = new FakeBlueprintPostgres();
  const repository = new PostgresBlueprintAdmissionRepository(database);
  const result = validateAgainst(candidate, snapshot);
  const admitted = await admitBlueprint(result, repository, { now: () => NOW });
  if (admitted.status !== "ADMITTED") {
    throw new Error(`Fixture Blueprint was not admitted: ${JSON.stringify(admitted.report.issues)}`);
  }
  return { database, repository, contentHash: admitted.contentHash };
}

export function requestAdmission(
  admitted: AdmittedBlueprint,
  snapshots: TrustedRegistrySnapshotStore,
  request: unknown = { content_hash: admitted.contentHash }
): Promise<ExecutionAdmissionDecision> {
  return issueExecutionAdmission(request, {
    blueprints: admitted.repository,
    deployment: {
      runtimeVersion: RUNTIME_VERSION,
      supportedBlueprintSchemaRange: BLUEPRINT_SCHEMA_RANGE,
      snapshots,
      now: () => NOW,
      newAdmissionId: () => ADMISSION_ID
    }
  });
}
