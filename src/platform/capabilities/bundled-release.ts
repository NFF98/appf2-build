import RELEASE_LEDGER from "../../../generated/capabilities/registry-release-ledger.json";
import { RUNTIME_REGISTRY } from "../../../generated/capabilities/runtime-registry.js";
import { VALIDATOR_REGISTRY } from "../../../generated/capabilities/validator-registry.js";
import { createTrustedRuntimeHandlerCatalog, sameReleaseIdentity } from "./registry-release.js";
import type { RegistryReleaseBundle, RegistryReleaseSource } from "./schema/registry-release.js";

export const CURRENT_BUNDLED_RELEASE: RegistryReleaseBundle = {
  identity: {
    registry_version: VALIDATOR_REGISTRY.registry_version,
    registry_digest: VALIDATOR_REGISTRY.registry_digest,
    validator_registry_digest: VALIDATOR_REGISTRY.validator_registry_digest,
    runtime_registry_digest: RUNTIME_REGISTRY.runtime_registry_digest
  },
  validator_registry: VALIDATOR_REGISTRY,
  runtime_registry: RUNTIME_REGISTRY
};

export interface BundledReleaseSourceOptions {
  /** Actual handler map bundled by the deployment; the catalog is derived from it, never from Registry source. */
  readonly bundledHandlers: ReadonlyMap<string, unknown>;
  /** Immutable historical release bundles shipped with the deployment for pinned interpretation. */
  readonly historicalReleases?: readonly RegistryReleaseBundle[];
}

/** Deployment release source: committed current v7 artifacts + committed append-only ledger + bundled handlers. */
export function createBundledReleaseSource(options: BundledReleaseSourceOptions): RegistryReleaseSource {
  const releases = [CURRENT_BUNDLED_RELEASE, ...(options.historicalReleases ?? [])];
  return {
    loadReleaseLedger: () => Promise.resolve(RELEASE_LEDGER),
    loadPinnedRelease: (identity) =>
      Promise.resolve(releases.find((release) => sameReleaseIdentity(release.identity, identity))),
    loadCurrentRelease: () => Promise.resolve(CURRENT_BUNDLED_RELEASE),
    loadRuntimeHandlerCatalog: () =>
      Promise.resolve(options.bundledHandlers).then((handlers) => createTrustedRuntimeHandlerCatalog(handlers))
  };
}
