import type { ExecutionClass } from "./capability-definition.js";
import type { ValidatorRegistry } from "./validator-contract.js";

export const REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION = "1.0.0";

export interface RuntimeCapabilityBinding {
  readonly registration_key: string;
  readonly execution_class: ExecutionClass;
  readonly runtime_binding_digest: string;
}

export interface RuntimeRegistry {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly runtime_registry_digest: string;
  readonly capabilities: Readonly<Record<string, Readonly<Record<string, RuntimeCapabilityBinding>>>>;
}

export interface RegistryReleaseIdentity {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly validator_registry_digest: string;
  readonly runtime_registry_digest: string;
}

export interface RegistryReleaseBundle {
  readonly identity: RegistryReleaseIdentity;
  readonly validator_registry: ValidatorRegistry;
  readonly runtime_registry: RuntimeRegistry;
}

export interface CapabilityIdentity {
  readonly execution_contract_digest: string;
  readonly runtime_binding_digest: string;
}

export interface RegistryReleaseLedger {
  readonly schema_version: typeof REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION;
  readonly releases: readonly RegistryReleaseIdentity[];
  readonly capability_identities: Readonly<Record<string, Readonly<Record<string, CapabilityIdentity>>>>;
}

export interface TrustedRuntimeHandlerCatalog {
  readonly registration_keys: readonly string[];
}

/**
 * Server/deployment-owned release truth for fresh execution admission. Every value is untrusted until
 * verified by the consumer; a thrown/rejected load is a temporary infrastructure failure.
 */
export interface RegistryReleaseSource {
  loadReleaseLedger(): Promise<unknown>;
  loadPinnedRelease(identity: RegistryReleaseIdentity): Promise<RegistryReleaseBundle | undefined>;
  loadCurrentRelease(): Promise<RegistryReleaseBundle>;
  loadRuntimeHandlerCatalog(): Promise<unknown>;
}
