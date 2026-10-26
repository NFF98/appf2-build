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

/** Limited to this browser tab, this exact authorized intent and the immutable Blueprint hash.
 * No localStorage, cookies, network, or cross-tab data sharing. */
const MAX_TAB_STATE_BYTES = 128 * 1024;
function tabStorageKey(intentId: string | undefined, hash: string): string | null {
  return typeof intentId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intentId) &&
    /^sha256:[0-9a-f]{64}$/.test(hash)
    ? "appf2.tab-state.v1:" + intentId.toLowerCase() + ":" + hash : null;
}

function savedTabState(intentId: string | undefined, hash: string): unknown {
  const key = tabStorageKey(intentId, hash);
  if (key === null) return undefined;
  try {
    const raw = globalThis.sessionStorage.getItem(key);
    return raw !== null && raw.length <= MAX_TAB_STATE_BYTES ? JSON.parse(raw) as unknown : undefined;
  } catch {
    return undefined; // Private browsing and denied storage are safe non-persistent modes.
  }
}

export function persistBrowserTabState(runtime: RuntimeInstance, intentId: string | undefined, hash: string): void {
  const key = tabStorageKey(intentId, hash);
  if (key === null || runtime.status !== "READY") return;
  try {
    const json = JSON.stringify(runtime.snapshotMutableState());
    if (json.length <= MAX_TAB_STATE_BYTES) globalThis.sessionStorage.setItem(key, json);
  } catch {
    // Quota/security exceptions must never stop an already-committed Action.
  }
}

/** One F03 Instance in this tab: monotonic clock, real timers, Web Crypto seed, production handler catalog only. */
export function createBrowserRuntime(admitted: AdmittedBlueprint, intentId?: string): RuntimeInstance {
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
      seedSource: () => globalThis.crypto.getRandomValues(new Uint8Array(PRNG_SEED_BYTES)),
      restoreState: (verifiedHash) => savedTabState(intentId, verifiedHash)
    }
  });
}
