import { parseBlueprintSchema } from "../blueprint/blueprint-schema.js";
import { canonicalBlueprintBytes } from "../blueprint/canonical-json.js";
import type { ExecutionAdmission } from "../blueprint/execution-admission.js";
import { isJsonObject } from "../blueprint/type-descriptor.js";
import type { Blueprint, BlueprintNode, JsonValue } from "../blueprint/validation-types.js";
import { parseSemVer, parseVersionRange, versionInRange } from "../capabilities/compatibility-grammar.js";
import type { RegistryReleaseBundle } from "../capabilities/schema/registry-release.js";
import type { TrustedCapabilityHandler } from "./capability-protocol.js";
import type { NodeBinding } from "./execution-index.js";
import { runtimeFail } from "./runtime-errors.js";
import { deepFreeze } from "./runtime-value.js";

/** H01 input: immutable Blueprint body by content_hash plus a fresh ExecutionAdmission for that hash. */
export interface AdmittedBlueprint {
  readonly admission: ExecutionAdmission;
  /** Canonical JSON text or the parsed JSON body as delivered for `admission.content_hash`. */
  readonly body: unknown;
}

/** Trusted deployment truth; public callers never choose versions, digests, bundles or handlers. */
export interface HydrationTrust {
  readonly runtime_version: string;
  readonly supported_blueprint_schema_range: string;
  /** Exact pinned Registry v7 release bundle the admission was issued against. */
  readonly registry_snapshot: RegistryReleaseBundle;
  /** Actual build-time bundled handler map keyed by RuntimeRegistry registration_key. */
  readonly handlers: ReadonlyMap<string, TrustedCapabilityHandler>;
  readonly hashCanonicalBlueprint: (canonicalBytes: Uint8Array) => Promise<string>;
  /** Trusted wall clock (epoch ms) used only for admission expiry. */
  readonly trustedNow: () => number;
}

export interface VerifiedBlueprint {
  readonly blueprint: Blueprint;
  readonly contentHash: string;
}

function trustFailure(message: string): never {
  return runtimeFail("F03-ERR-001", message);
}

function assertFresh(admission: ExecutionAdmission, trust: HydrationTrust): void {
  const expiresAt = Date.parse(admission.expires_at);
  if (!(trust.trustedNow() < expiresAt)) {
    trustFailure("ExecutionAdmission is expired or has no valid expiry.");
  }
}

function canonicalBytesOf(body: unknown): Uint8Array {
  try {
    return canonicalBlueprintBytes(typeof body === "string" ? JSON.parse(body) : body);
  } catch {
    return trustFailure("Blueprint body cannot be canonicalized.");
  }
}

function parseOwnedBlueprint(bytes: Uint8Array): Blueprint {
  const owned: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isJsonObject(owned)) {
    return trustFailure("Blueprint body is not a JSON object.");
  }
  try {
    return deepFreeze(parseBlueprintSchema(owned as Readonly<Record<string, JsonValue>>));
  } catch {
    return trustFailure("Admitted Blueprint body does not satisfy the Blueprint schema.");
  }
}

function assertCompatible(admission: ExecutionAdmission, blueprint: Blueprint, trust: HydrationTrust): void {
  const range = parseVersionRange(trust.supported_blueprint_schema_range);
  const schema = parseSemVer(blueprint.schema_version);
  if (
    admission.runtime_version !== trust.runtime_version ||
    admission.schema_version !== blueprint.schema_version ||
    range === undefined ||
    schema === undefined ||
    !versionInRange(schema, range)
  ) {
    runtimeFail("F03-ERR-002", "Runtime version or Blueprint schema is not compatible with this Runtime.");
  }
  const { identity, runtime_registry: runtimeRegistry, validator_registry: validatorRegistry } = trust.registry_snapshot;
  const sameRelease =
    admission.registry_version === identity.registry_version &&
    admission.registry_digest === identity.registry_digest &&
    admission.validator_registry_digest === identity.validator_registry_digest &&
    admission.runtime_registry_digest === identity.runtime_registry_digest &&
    blueprint.registry_version === identity.registry_version &&
    runtimeRegistry.runtime_registry_digest === identity.runtime_registry_digest &&
    validatorRegistry.validator_registry_digest === identity.validator_registry_digest;
  if (!sameRelease) {
    runtimeFail("F03-ERR-003", "Admission Registry identity does not equal the pinned Runtime release bundle.");
  }
}

/** H01–H02 (F03 §4, EXECUTION-ADMISSION §6): only a fresh, matching, compatible admission may hydrate. */
export async function verifyAdmittedBlueprint(admitted: AdmittedBlueprint, trust: HydrationTrust): Promise<VerifiedBlueprint> {
  const { admission } = admitted;
  if (admission.executable !== true || admission.trust_status !== "VALIDATED") {
    trustFailure("ExecutionAdmission is not an executable VALIDATED admission.");
  }
  assertFresh(admission, trust);
  const bytes = canonicalBytesOf(admitted.body);
  const contentHash = await trust.hashCanonicalBlueprint(bytes);
  if (contentHash !== admission.content_hash) {
    trustFailure("Blueprint content_hash does not equal the admission content_hash.");
  }
  assertFresh(admission, trust);
  const blueprint = parseOwnedBlueprint(bytes);
  assertCompatible(admission, blueprint, trust);
  return { blueprint, contentHash };
}

function lookup<T>(table: Readonly<Record<string, Readonly<Record<string, T>>>>, id: string, version: string): T | undefined {
  const versions = Object.hasOwn(table, id) ? table[id] : undefined;
  return versions !== undefined && Object.hasOwn(versions, version) ? versions[version] : undefined;
}

/** H03 BF-040: handler index built only from the pinned RuntimeRegistry; no current-registry fallback. */
export function pinnedNodeBinder(trust: HydrationTrust): (node: BlueprintNode) => NodeBinding {
  const { runtime_registry: runtimeRegistry, validator_registry: validatorRegistry } = trust.registry_snapshot;
  return (node) => {
    const { id, version } = node.capability;
    const entry = lookup(validatorRegistry.capabilities, id, version);
    const binding = lookup(runtimeRegistry.capabilities, id, version);
    const handler = binding === undefined ? undefined : trust.handlers.get(binding.registration_key);
    if (entry === undefined || handler === undefined) {
      return runtimeFail("F03-ERR-003", `No pinned trusted handler binding for ${id}@${version}.`, id);
    }
    return { validator: entry.validator, handler, resources: { budget: entry.resource_budget, usage: entry.resource_usage } };
  };
}
