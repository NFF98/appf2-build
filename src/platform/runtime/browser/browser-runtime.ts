import { RUNTIME_REGISTRY } from "../../../../generated/capabilities/runtime-registry.js";
import { VALIDATOR_REGISTRY } from "../../../../generated/capabilities/validator-registry.js";
import { BLUEPRINT_SCHEMA_RANGE, RUNTIME_VERSION } from "../../capabilities/registry.js";
import type { RegistryReleaseBundle } from "../../capabilities/schema/registry-release.js";
import { CORE_CAPABILITY_HANDLERS } from "../core-handlers.js";
import type { AdmittedBlueprint, HydrationTrust } from "../hydration-gate.js";
import { PRNG_SEED_BYTES } from "../prng.js";
import { RuntimeInstance } from "../runtime-instance.js";

/** The build-time pinned Registry v7 release this bundle ships with (same artifacts the server admission pins). */
const PINNED_RELEASE: RegistryReleaseBundle = {
  identity: {
    registry_version: VALIDATOR_REGISTRY.registry_version,
    registry_digest: VALIDATOR_REGISTRY.registry_digest,
    validator_registry_digest: VALIDATOR_REGISTRY.validator_registry_digest,
    runtime_registry_digest: RUNTIME_REGISTRY.runtime_registry_digest
  },
  validator_registry: VALIDATOR_REGISTRY,
  runtime_registry: RUNTIME_REGISTRY
};

async function sha256ContentHash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export const BROWSER_HYDRATION_TRUST: HydrationTrust = {
  runtime_version: RUNTIME_VERSION,
  supported_blueprint_schema_range: BLUEPRINT_SCHEMA_RANGE,
  registry_snapshot: PINNED_RELEASE,
  handlers: CORE_CAPABILITY_HANDLERS,
  hashCanonicalBlueprint: sha256ContentHash,
  trustedNow: () => Date.now()
};

/** One F03 Instance in this tab: monotonic clock, real timers, Web Crypto seed, production handler catalog only. */
export function createBrowserRuntime(admitted: AdmittedBlueprint): RuntimeInstance {
  return new RuntimeInstance(admitted, {
    trust: BROWSER_HYDRATION_TRUST,
    services: {
      clock: { now: () => globalThis.performance.now() },
      scheduler: {
        schedule: (delayMs, wake) => {
          const handle = globalThis.setTimeout(wake, Math.max(0, delayMs));
          return () => globalThis.clearTimeout(handle);
        }
      },
      seedSource: () => globalThis.crypto.getRandomValues(new Uint8Array(PRNG_SEED_BYTES))
    }
  });
}
