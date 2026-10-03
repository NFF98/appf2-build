import {
  compareSemVer,
  parseRuntimeBounds,
  parseSemVer,
  parseVersionRange,
  versionInInterval,
  versionInRange,
  type SemVer
} from "./compatibility-grammar.js";
import {
  EXECUTION_CLASSES,
  type CapabilityDependency,
  type CapabilityRef
} from "./schema/capability-definition.js";
import type { RuntimeRegistry } from "./schema/registry-release.js";
import type { GeneratedCapabilityValidator, ValidatorRegistry } from "./schema/validator-contract.js";

export type EligibilityFailureReason =
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_NOT_ENABLED"
  | "CAPABILITY_REVOKED"
  | "EXECUTION_CLASS_UNSUPPORTED"
  | "BLUEPRINT_SCHEMA_INCOMPATIBLE"
  | "RUNTIME_INCOMPATIBLE"
  | "EXECUTION_IDENTITY_DRIFT"
  | "CAPABILITY_DEPENDENCY_UNAVAILABLE";

export interface EligibilityFailure {
  readonly ref: CapabilityRef;
  readonly reason: EligibilityFailureReason;
  readonly cause?: EligibilityFailure;
}

export interface PinnedIdentitySnapshot {
  readonly validator_registry: ValidatorRegistry;
  readonly runtime_registry: RuntimeRegistry;
}

export interface EligibilityEnvironment {
  readonly registry: ValidatorRegistry;
  readonly blueprintSchemaVersion: string;
  readonly runtimeVersion: string;
  /** Fresh-execution only: same exact refs present in the pinned release must keep both identity digests. */
  readonly drift?: {
    readonly runtimeRegistry: RuntimeRegistry;
    readonly pinned: PinnedIdentitySnapshot;
  };
}

export type EligibilityEvaluator = (ref: CapabilityRef) => EligibilityFailure | undefined;

const SUPPORTED_EXECUTION_CLASSES: ReadonlySet<string> = new Set(EXECUTION_CLASSES);

export function lookupVersioned<T>(
  map: Readonly<Record<string, Readonly<Record<string, T>>>>,
  ref: CapabilityRef
): T | undefined {
  const versions = Object.hasOwn(map, ref.id) ? map[ref.id] : undefined;
  return versions !== undefined && Object.hasOwn(versions, ref.version) ? versions[ref.version] : undefined;
}

function refKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

function isCompatible(entry: GeneratedCapabilityValidator, schemaVersion: SemVer | undefined, runtimeVersion: SemVer | undefined): EligibilityFailureReason | undefined {
  const schemaRange = parseVersionRange(entry.compatibility.blueprintSchemaRange);
  if (schemaVersion === undefined || schemaRange === undefined || !versionInRange(schemaVersion, schemaRange)) {
    return "BLUEPRINT_SCHEMA_INCOMPATIBLE";
  }
  const runtimeBounds = parseRuntimeBounds(entry.compatibility.minRuntimeVersion, entry.compatibility.maxRuntimeVersion);
  if (runtimeVersion === undefined || runtimeBounds === undefined || !versionInInterval(runtimeVersion, runtimeBounds)) {
    return "RUNTIME_INCOMPATIBLE";
  }
  return undefined;
}

function policyFailure(entry: GeneratedCapabilityValidator): EligibilityFailureReason | undefined {
  if (entry.availability !== "ENABLED") {
    return "CAPABILITY_NOT_ENABLED";
  }
  if (entry.execution_status !== "ACTIVE") {
    return "CAPABILITY_REVOKED";
  }
  return SUPPORTED_EXECUTION_CLASSES.has(entry.execution_class) ? undefined : "EXECUTION_CLASS_UNSUPPORTED";
}

function identityDrifted(ref: CapabilityRef, entry: GeneratedCapabilityValidator, drift: NonNullable<EligibilityEnvironment["drift"]>): boolean {
  const pinnedEntry = lookupVersioned(drift.pinned.validator_registry.capabilities, ref);
  if (pinnedEntry === undefined) {
    return false;
  }
  const pinnedBinding = lookupVersioned(drift.pinned.runtime_registry.capabilities, ref);
  const currentBinding = lookupVersioned(drift.runtimeRegistry.capabilities, ref);
  return (
    pinnedEntry.execution_contract_digest !== entry.execution_contract_digest ||
    pinnedBinding === undefined ||
    currentBinding === undefined ||
    pinnedBinding.runtime_binding_digest !== currentBinding.runtime_binding_digest
  );
}

/**
 * Deterministic recursive eligibility over one Registry snapshot. Each exact ref is evaluated once;
 * a dependency cycle reached by a consumer fails closed.
 */
export function createEligibilityEvaluator(environment: EligibilityEnvironment): EligibilityEvaluator {
  const schemaVersion = parseSemVer(environment.blueprintSchemaVersion);
  const runtimeVersion = parseSemVer(environment.runtimeVersion);
  const memo = new Map<string, EligibilityFailure | null>();
  const visiting = new Set<string>();
  const versionsById = new Map<string, readonly string[]>();

  const versionsDescending = (id: string): readonly string[] => {
    const cached = versionsById.get(id);
    if (cached !== undefined) {
      return cached;
    }
    const map = environment.registry.capabilities;
    const versions = Object.hasOwn(map, id) ? Object.keys(map[id]!) : [];
    const sorted = versions
      .filter((version) => parseSemVer(version) !== undefined)
      .sort((left, right) => compareSemVer(parseSemVer(right)!, parseSemVer(left)!));
    versionsById.set(id, sorted);
    return sorted;
  };

  const resolveDependency = (parent: CapabilityRef, dependency: CapabilityDependency): EligibilityFailure | undefined => {
    const range = parseVersionRange(dependency.versionRange);
    if (range === undefined) {
      return { ref: parent, reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE" };
    }
    let cause: EligibilityFailure | undefined;
    for (const version of versionsDescending(dependency.id)) {
      if (!versionInRange(parseSemVer(version)!, range)) {
        continue;
      }
      cause = evaluate({ id: dependency.id, version });
      if (cause === undefined) {
        return undefined;
      }
    }
    return cause === undefined
      ? { ref: parent, reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE" }
      : { ref: parent, reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE", cause };
  };

  const evaluateUncached = (ref: CapabilityRef): EligibilityFailure | undefined => {
    const entry = lookupVersioned(environment.registry.capabilities, ref);
    if (entry === undefined) {
      return { ref, reason: "UNKNOWN_CAPABILITY" };
    }
    const reason = policyFailure(entry) ?? isCompatible(entry, schemaVersion, runtimeVersion);
    if (reason !== undefined) {
      return { ref, reason };
    }
    if (environment.drift !== undefined && identityDrifted(ref, entry, environment.drift)) {
      return { ref, reason: "EXECUTION_IDENTITY_DRIFT" };
    }
    for (const dependency of entry.compatibility.dependencies) {
      const failure = dependency.required ? resolveDependency(ref, dependency) : undefined;
      if (failure !== undefined) {
        return failure;
      }
    }
    return undefined;
  };

  const evaluate: EligibilityEvaluator = (ref) => {
    const key = refKey(ref);
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    if (visiting.has(key)) {
      return { ref, reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE" };
    }
    visiting.add(key);
    const failure = evaluateUncached(ref);
    visiting.delete(key);
    memo.set(key, failure ?? null);
    return failure;
  };

  return evaluate;
}
