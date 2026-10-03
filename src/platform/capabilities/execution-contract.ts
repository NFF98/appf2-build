import { createHash } from "node:crypto";

import { canonicalizeJson } from "../blueprint/canonical-json.js";
import { AVAILABILITY_LEVELS, EXECUTION_CLASSES, EXECUTION_STATUSES } from "./schema/capability-definition.js";
import {
  SEMVER_PATTERN,
  type GeneratedCapabilityValidator,
  type ValidatorRegistry
} from "./schema/validator-contract.js";

export const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const SUPPORTED_REGISTRY_MAJOR = 6;

export type ExecutionContractFields = Pick<
  GeneratedCapabilityValidator,
  | "id"
  | "version"
  | "validator"
  | "permission_class"
  | "resource_budget"
  | "resource_usage"
  | "execution_class"
  | "compatibility"
  | "degradation"
>;

export interface TrustedRegistrySnapshot {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly validator_registry: ValidatorRegistry;
}

export function computeExecutionContractDigest(entry: ExecutionContractFields): string {
  const input: ExecutionContractFields = {
    id: entry.id,
    version: entry.version,
    validator: entry.validator,
    permission_class: entry.permission_class,
    resource_budget: entry.resource_budget,
    resource_usage: entry.resource_usage,
    execution_class: entry.execution_class,
    compatibility: entry.compatibility,
    degradation: entry.degradation
  };
  const bytes = new TextEncoder().encode(canonicalizeJson(input));
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function registryMajor(registryVersion: string): number | undefined {
  const match = SEMVER_PATTERN.exec(registryVersion);
  return match === null ? undefined : Number(match[1]);
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.some((candidate) => candidate === value);
}

function isIntactEntry(id: string, version: string, entry: GeneratedCapabilityValidator): boolean {
  return (
    entry.id === id &&
    entry.version === version &&
    isOneOf(entry.availability, AVAILABILITY_LEVELS) &&
    isOneOf(entry.execution_status, EXECUTION_STATUSES) &&
    isOneOf(entry.execution_class, EXECUTION_CLASSES) &&
    Number.isSafeInteger(entry.resource_usage.timerSlotsPerInstance) &&
    entry.resource_usage.timerSlotsPerInstance >= 0 &&
    SHA256_DIGEST_PATTERN.test(entry.execution_contract_digest) &&
    computeExecutionContractDigest(entry) === entry.execution_contract_digest
  );
}

export function isIntactRegistrySnapshot(snapshot: TrustedRegistrySnapshot): boolean {
  const registry = snapshot.validator_registry;
  if (
    snapshot.registry_version !== registry.registry_version ||
    snapshot.registry_digest !== registry.registry_digest ||
    registryMajor(registry.registry_version) !== SUPPORTED_REGISTRY_MAJOR ||
    !SHA256_DIGEST_PATTERN.test(registry.registry_digest) ||
    !SEMVER_PATTERN.test(registry.runtime_version)
  ) {
    return false;
  }
  try {
    return Object.entries(registry.capabilities).every(([id, versions]) =>
      Object.entries(versions).every(([version, entry]) => isIntactEntry(id, version, entry))
    );
  } catch {
    return false;
  }
}
