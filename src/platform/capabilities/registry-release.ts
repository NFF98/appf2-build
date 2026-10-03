import { createHash } from "node:crypto";

import { canonicalizeJson } from "../blueprint/canonical-json.js";
import { compareCodePoints } from "../blueprint/type-descriptor.js";
import { compareSemVer, parseSemVer } from "./compatibility-grammar.js";
import {
  REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION,
  type CapabilityIdentity,
  type RegistryReleaseBundle,
  type RegistryReleaseIdentity,
  type RegistryReleaseLedger,
  type RuntimeRegistry,
  type TrustedRuntimeHandlerCatalog
} from "./schema/registry-release.js";
import {
  CAPABILITY_ID_PATTERN,
  type GeneratedCapabilityValidator,
  type ValidatorRegistry
} from "./schema/validator-contract.js";

export const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const REGISTRY_MACHINE_CONTRACT_MAJOR = 7;

const RELEASE_KEYS = ["registry_version", "registry_digest", "validator_registry_digest", "runtime_registry_digest"] as const;
const IDENTITY_KEYS = ["execution_contract_digest", "runtime_binding_digest"] as const;

export type RegistryLedgerErrorCode =
  | "RELEASE_LEDGER_INVALID"
  | "REGISTRY_VERSION_DIGEST_MISMATCH"
  | "CAPABILITY_VERSION_REUSE";

export class RegistryLedgerError extends Error {
  public constructor(
    public readonly code: RegistryLedgerErrorCode,
    message: string
  ) {
    super(message);
    this.name = "RegistryLedgerError";
  }
}

export type ExecutionContractInput = Omit<
  GeneratedCapabilityValidator,
  "execution_contract_digest" | "availability" | "execution_status"
>;

export interface CapabilityIdentityEntry extends CapabilityIdentity {
  readonly id: string;
  readonly version: string;
}

export function sha256CanonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex")}`;
}

function withoutField(record: object, field: string): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field));
}

export function computeExecutionContractDigest(entry: ExecutionContractInput): string {
  return sha256CanonicalDigest({
    id: entry.id,
    version: entry.version,
    validator: entry.validator,
    permission_class: entry.permission_class,
    resource_budget: entry.resource_budget,
    resource_usage: entry.resource_usage,
    execution_class: entry.execution_class,
    compatibility: entry.compatibility,
    degradation: entry.degradation
  });
}

export function computeRuntimeBindingDigest(id: string, version: string, registrationKey: string): string {
  return sha256CanonicalDigest({ id, version, registration_key: registrationKey });
}

export function computeValidatorRegistryDigest(registry: Omit<ValidatorRegistry, "validator_registry_digest">): string {
  return sha256CanonicalDigest(withoutField(registry, "validator_registry_digest"));
}

export function computeRuntimeRegistryDigest(registry: Omit<RuntimeRegistry, "runtime_registry_digest">): string {
  return sha256CanonicalDigest(withoutField(registry, "runtime_registry_digest"));
}

function invalidLedger(message: string): never {
  throw new RegistryLedgerError("RELEASE_LEDGER_INVALID", message);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return invalidLedger(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) {
    return invalidLedger(`${label} must contain exactly ${keys.join(", ")}.`);
  }
  return value;
}

function digestField(record: Readonly<Record<string, unknown>>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !SHA256_DIGEST_PATTERN.test(value)) {
    return invalidLedger(`${label}.${key} must be a canonical sha256 digest.`);
  }
  return value;
}

function parseRelease(value: unknown, label: string): RegistryReleaseIdentity {
  const record = exactRecord(value, RELEASE_KEYS, label);
  const version = record.registry_version;
  if (typeof version !== "string" || parseSemVer(version) === undefined) {
    return invalidLedger(`${label}.registry_version must be SemVer.`);
  }
  return {
    registry_version: version,
    registry_digest: digestField(record, "registry_digest", label),
    validator_registry_digest: digestField(record, "validator_registry_digest", label),
    runtime_registry_digest: digestField(record, "runtime_registry_digest", label)
  };
}

function parseIdentities(value: unknown): RegistryReleaseLedger["capability_identities"] {
  if (!isPlainRecord(value)) {
    return invalidLedger("capability_identities must be an object.");
  }
  const identities: Record<string, Record<string, CapabilityIdentity>> = {};
  for (const [id, versions] of Object.entries(value)) {
    if (!CAPABILITY_ID_PATTERN.test(id) || !isPlainRecord(versions)) {
      invalidLedger(`capability_identities.${id} must be a version map for a canonical capability id.`);
    }
    const byVersion: Record<string, CapabilityIdentity> = {};
    for (const [version, identity] of Object.entries(versions)) {
      const label = `capability_identities.${id}.${version}`;
      if (parseSemVer(version) === undefined) {
        invalidLedger(`${label} must be keyed by SemVer.`);
      }
      const record = exactRecord(identity, IDENTITY_KEYS, label);
      byVersion[version] = {
        execution_contract_digest: digestField(record, "execution_contract_digest", label),
        runtime_binding_digest: digestField(record, "runtime_binding_digest", label)
      };
    }
    identities[id] = byVersion;
  }
  return identities;
}

/** Strictly parses the trusted append-only release ledger; releases must be SemVer strictly ascending. */
export function parseRegistryReleaseLedger(value: unknown): RegistryReleaseLedger {
  const record = exactRecord(value, ["schema_version", "releases", "capability_identities"], "ledger");
  if (record.schema_version !== REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION) {
    invalidLedger("ledger.schema_version is not supported.");
  }
  if (!Array.isArray(record.releases)) {
    return invalidLedger("ledger.releases must be an array.");
  }
  const releases = record.releases.map((release: unknown, index) => parseRelease(release, `ledger.releases[${index}]`));
  for (let index = 1; index < releases.length; index += 1) {
    const previous = parseSemVer(releases[index - 1]!.registry_version)!;
    if (compareSemVer(previous, parseSemVer(releases[index]!.registry_version)!) >= 0) {
      invalidLedger("ledger.releases must be strictly ascending by SemVer with unique versions.");
    }
  }
  return {
    schema_version: REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION,
    releases,
    capability_identities: parseIdentities(record.capability_identities)
  };
}

export function emptyRegistryReleaseLedger(): RegistryReleaseLedger {
  return { schema_version: REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION, releases: [], capability_identities: {} };
}

export function sameReleaseIdentity(left: RegistryReleaseIdentity, right: RegistryReleaseIdentity): boolean {
  return RELEASE_KEYS.every((key) => left[key] === right[key]);
}

function sameCapabilityIdentity(left: CapabilityIdentity, right: CapabilityIdentity): boolean {
  return IDENTITY_KEYS.every((key) => left[key] === right[key]);
}

export function ledgerIdentityOf(ledger: RegistryReleaseLedger, id: string, version: string): CapabilityIdentity | undefined {
  const versions = Object.hasOwn(ledger.capability_identities, id) ? ledger.capability_identities[id] : undefined;
  return versions !== undefined && Object.hasOwn(versions, version) ? versions[version] : undefined;
}

export function ledgerReleaseOf(ledger: RegistryReleaseLedger, version: string): RegistryReleaseIdentity | undefined {
  return ledger.releases.find((release) => release.registry_version === version);
}

function assertHistoricalIdentities(ledger: RegistryReleaseLedger, identities: readonly CapabilityIdentityEntry[]): void {
  for (const identity of identities) {
    const historical = ledgerIdentityOf(ledger, identity.id, identity.version);
    if (historical !== undefined && !sameCapabilityIdentity(historical, identity)) {
      throw new RegistryLedgerError(
        "CAPABILITY_VERSION_REUSE",
        `${identity.id}@${identity.version} reuses a historical CapabilityRef with a different execution/runtime identity.`
      );
    }
  }
}

function unionIdentities(
  ledger: RegistryReleaseLedger,
  identities: readonly CapabilityIdentityEntry[]
): RegistryReleaseLedger["capability_identities"] {
  const union: Record<string, Record<string, CapabilityIdentity>> = {};
  for (const [id, versions] of Object.entries(ledger.capability_identities)) {
    union[id] = { ...versions };
  }
  for (const { id, version, execution_contract_digest, runtime_binding_digest } of identities) {
    union[id] = { ...union[id], [version]: { execution_contract_digest, runtime_binding_digest } };
  }
  return union;
}

/** Appends a release without rewriting history; an already-recorded version must carry the identical tuple. */
export function appendRegistryRelease(
  ledger: RegistryReleaseLedger,
  release: RegistryReleaseIdentity,
  identities: readonly CapabilityIdentityEntry[]
): RegistryReleaseLedger {
  assertHistoricalIdentities(ledger, identities);
  const recorded = ledgerReleaseOf(ledger, release.registry_version);
  if (recorded !== undefined && !sameReleaseIdentity(recorded, release)) {
    throw new RegistryLedgerError(
      "REGISTRY_VERSION_DIGEST_MISMATCH",
      `Registry version ${release.registry_version} is already bound to a different digest tuple.`
    );
  }
  const latest = ledger.releases.at(-1);
  const appendable =
    recorded === undefined &&
    (latest === undefined ||
      compareSemVer(parseSemVer(latest.registry_version)!, parseSemVer(release.registry_version)!) < 0);
  if (recorded === undefined && !appendable) {
    invalidLedger(`Registry version ${release.registry_version} must be appended in strictly ascending SemVer order.`);
  }
  return {
    schema_version: REGISTRY_RELEASE_LEDGER_SCHEMA_VERSION,
    releases: appendable ? [...ledger.releases, release] : ledger.releases,
    capability_identities: unionIdentities(ledger, identities)
  };
}

/** Rejects any rewrite or deletion of a previously published release or capability identity. */
export function assertLedgerAppendOnly(previous: RegistryReleaseLedger, next: RegistryReleaseLedger): void {
  previous.releases.forEach((release, index) => {
    const successor = next.releases[index];
    if (successor === undefined || !sameReleaseIdentity(release, successor)) {
      invalidLedger(`Release ${release.registry_version} was rewritten or deleted.`);
    }
  });
  for (const [id, versions] of Object.entries(previous.capability_identities)) {
    for (const [version, identity] of Object.entries(versions)) {
      const successor = ledgerIdentityOf(next, id, version);
      if (successor === undefined || !sameCapabilityIdentity(identity, successor)) {
        invalidLedger(`Capability identity ${id}@${version} was rewritten or deleted.`);
      }
    }
  }
}

export type ReleaseBundleFailure =
  | "ARTIFACT_UNVERIFIABLE"
  | "VALIDATOR_ARTIFACT_DIGEST_MISMATCH"
  | "RUNTIME_ARTIFACT_DIGEST_MISMATCH"
  | "ARTIFACT_IDENTITY_MISMATCH"
  | "CAPABILITY_ENTRY_DIGEST_MISMATCH"
  | "RELEASE_NOT_IN_LEDGER";

function artifactDigestFailure(bundle: RegistryReleaseBundle): ReleaseBundleFailure | undefined {
  const { identity, validator_registry: validator, runtime_registry: runtime } = bundle;
  const validatorDigest = computeValidatorRegistryDigest(validator);
  if (validatorDigest !== validator.validator_registry_digest || validatorDigest !== identity.validator_registry_digest) {
    return "VALIDATOR_ARTIFACT_DIGEST_MISMATCH";
  }
  const runtimeDigest = computeRuntimeRegistryDigest(runtime);
  if (runtimeDigest !== runtime.runtime_registry_digest || runtimeDigest !== identity.runtime_registry_digest) {
    return "RUNTIME_ARTIFACT_DIGEST_MISMATCH";
  }
  const bound = [validator, runtime].every(
    (artifact) =>
      artifact.registry_version === identity.registry_version && artifact.registry_digest === identity.registry_digest
  );
  return bound ? undefined : "ARTIFACT_IDENTITY_MISMATCH";
}

/** Artifact self-consistency: every per-ref digest must be recomputable from its own entry body / registration_key. */
function capabilityEntriesConsistent(bundle: RegistryReleaseBundle): boolean {
  const { validator_registry: validator, runtime_registry: runtime } = bundle;
  const validatorIds = Object.keys(validator.capabilities);
  if (validatorIds.length !== Object.keys(runtime.capabilities).length) {
    return false;
  }
  return validatorIds.every((id) => {
    const entries = validator.capabilities[id] ?? {};
    const bindings = Object.hasOwn(runtime.capabilities, id) ? runtime.capabilities[id] : undefined;
    if (bindings === undefined || Object.keys(entries).length !== Object.keys(bindings).length) {
      return false;
    }
    return Object.entries(entries).every(([version, entry]) => {
      const binding = Object.hasOwn(bindings, version) ? bindings[version] : undefined;
      return (
        binding !== undefined &&
        entry.id === id &&
        entry.version === version &&
        binding.execution_class === entry.execution_class &&
        computeExecutionContractDigest(entry) === entry.execution_contract_digest &&
        computeRuntimeBindingDigest(id, version, binding.registration_key) === binding.runtime_binding_digest
      );
    });
  });
}

/**
 * Recomputes both artifact digests and every per-ref digest first, then requires the full four-field tuple in
 * the trusted ledger. Cross-release same-ref drift is an execution-eligibility decision, not artifact integrity.
 */
export function verifyReleaseBundle(
  bundle: RegistryReleaseBundle,
  ledger: RegistryReleaseLedger
): ReleaseBundleFailure | undefined {
  try {
    const failure = artifactDigestFailure(bundle);
    if (failure !== undefined) {
      return failure;
    }
    if (!capabilityEntriesConsistent(bundle)) {
      return "CAPABILITY_ENTRY_DIGEST_MISMATCH";
    }
    const recorded = ledgerReleaseOf(ledger, bundle.identity.registry_version);
    return recorded !== undefined && sameReleaseIdentity(recorded, bundle.identity) ? undefined : "RELEASE_NOT_IN_LEDGER";
  } catch {
    return "ARTIFACT_UNVERIFIABLE";
  }
}

export function registryMachineMajor(registryVersion: string): number | undefined {
  return parseSemVer(registryVersion)?.[0];
}

/** Builds the deployment catalog from the actual bundled handler map, never from Registry source. */
export function createTrustedRuntimeHandlerCatalog(
  bundledHandlers: ReadonlyMap<string, unknown>
): TrustedRuntimeHandlerCatalog {
  const keys: string[] = [];
  for (const [key, handler] of bundledHandlers) {
    if (key.length === 0 || handler === undefined || handler === null) {
      throw new TypeError(`Bundled runtime handler ${key} is missing.`);
    }
    keys.push(key);
  }
  return { registration_keys: keys.sort(compareCodePoints) };
}

export function parseTrustedRuntimeHandlerCatalog(value: unknown): ReadonlySet<string> | undefined {
  if (!isPlainRecord(value) || Object.keys(value).length !== 1 || !Array.isArray(value.registration_keys)) {
    return undefined;
  }
  const keys: unknown[] = value.registration_keys;
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const previous = keys[index - 1];
    if (typeof key !== "string" || key.length === 0) {
      return undefined;
    }
    if (typeof previous === "string" && compareCodePoints(previous, key) >= 0) {
      return undefined;
    }
  }
  return new Set(keys as string[]);
}
