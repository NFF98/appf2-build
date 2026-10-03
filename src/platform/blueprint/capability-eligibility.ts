import {
  CapabilityAdmissionError,
  compareCapabilityVersions,
  matchesCapabilityVersionRange,
  matchesRuntimeCompatibility
} from "../capabilities/admission.js";
import { EXECUTION_CLASSES } from "../capabilities/schema/capability-definition.js";
import {
  SEMVER_PATTERN,
  type GeneratedCapabilityValidator,
  type ValidatorRegistry
} from "../capabilities/schema/validator-contract.js";
import type { CapabilityRef } from "./validation-types.js";

export type CapabilityIneligibilityReason =
  | "UNKNOWN_CAPABILITY"
  | "CAPABILITY_UNAVAILABLE"
  | "CAPABILITY_REVOKED"
  | "EXECUTION_CLASS_UNSUPPORTED"
  | "BLUEPRINT_SCHEMA_INCOMPATIBLE"
  | "RUNTIME_INCOMPATIBLE"
  | "CAPABILITY_DEPENDENCY_UNAVAILABLE";

export interface CapabilityIneligibility {
  readonly reason: CapabilityIneligibilityReason;
  readonly ref: CapabilityRef;
}

export interface CapabilityEligibilityContext {
  readonly blueprintSchemaVersion: string;
  readonly runtimeVersion: string;
}

export interface CapabilityEligibilityEvaluator {
  evaluate(ref: CapabilityRef): CapabilityIneligibility | undefined;
}

const TRUSTED_EXECUTION_CLASSES: ReadonlySet<string> = new Set(EXECUTION_CLASSES);

export function lookupCapability(
  registry: ValidatorRegistry,
  ref: CapabilityRef
): GeneratedCapabilityValidator | undefined {
  const versions = Object.hasOwn(registry.capabilities, ref.id) ? registry.capabilities[ref.id] : undefined;
  return versions !== undefined && Object.hasOwn(versions, ref.version) ? versions[ref.version] : undefined;
}

function safeRangeMatch(version: string, range: string): boolean {
  try {
    return matchesCapabilityVersionRange(version, range);
  } catch (error: unknown) {
    if (error instanceof CapabilityAdmissionError) {
      return false;
    }
    throw error;
  }
}

function ownIneligibility(
  entry: GeneratedCapabilityValidator,
  context: CapabilityEligibilityContext
): CapabilityIneligibilityReason | undefined {
  if (entry.availability !== "ENABLED") {
    return "CAPABILITY_UNAVAILABLE";
  }
  if (entry.execution_status !== "ACTIVE") {
    return "CAPABILITY_REVOKED";
  }
  if (!TRUSTED_EXECUTION_CLASSES.has(entry.execution_class)) {
    return "EXECUTION_CLASS_UNSUPPORTED";
  }
  const { blueprintSchemaRange, minRuntimeVersion, maxRuntimeVersion } = entry.compatibility;
  if (!safeRangeMatch(context.blueprintSchemaVersion, blueprintSchemaRange)) {
    return "BLUEPRINT_SCHEMA_INCOMPATIBLE";
  }
  if (!matchesRuntimeCompatibility(context.runtimeVersion, minRuntimeVersion, maxRuntimeVersion)) {
    return "RUNTIME_INCOMPATIBLE";
  }
  return undefined;
}

function descendingVersionIndex(registry: ValidatorRegistry): ReadonlyMap<string, readonly GeneratedCapabilityValidator[]> {
  const index = new Map<string, readonly GeneratedCapabilityValidator[]>();
  for (const [id, versions] of Object.entries(registry.capabilities)) {
    const entries = Object.values(versions).filter((entry) => SEMVER_PATTERN.test(entry.version));
    index.set(id, entries.sort((left, right) => compareCapabilityVersions(right.version, left.version)));
  }
  return index;
}

function refKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

export function createCapabilityEligibilityEvaluator(
  registry: ValidatorRegistry,
  context: CapabilityEligibilityContext
): CapabilityEligibilityEvaluator {
  const versionIndex = descendingVersionIndex(registry);
  const decided = new Map<string, CapabilityIneligibilityReason | null>();
  const visiting = new Set<string>();

  const reasonFor = (entry: GeneratedCapabilityValidator): CapabilityIneligibilityReason | undefined => {
    const key = refKey(entry);
    const known = decided.get(key);
    if (known !== undefined) {
      return known ?? undefined;
    }
    if (visiting.has(key)) {
      return "CAPABILITY_DEPENDENCY_UNAVAILABLE";
    }
    visiting.add(key);
    const reason = ownIneligibility(entry, context) ?? dependencyIneligibility(entry);
    visiting.delete(key);
    decided.set(key, reason ?? null);
    return reason;
  };

  const dependencyIneligibility = (entry: GeneratedCapabilityValidator): CapabilityIneligibilityReason | undefined => {
    for (const dependency of entry.compatibility.dependencies) {
      if (!dependency.required) {
        continue;
      }
      const candidates = versionIndex.get(dependency.id) ?? [];
      const satisfied = candidates.some(
        (candidate) => safeRangeMatch(candidate.version, dependency.versionRange) && reasonFor(candidate) === undefined
      );
      if (!satisfied) {
        return "CAPABILITY_DEPENDENCY_UNAVAILABLE";
      }
    }
    return undefined;
  };

  return {
    evaluate(ref: CapabilityRef): CapabilityIneligibility | undefined {
      const entry = lookupCapability(registry, ref);
      if (entry === undefined) {
        return { reason: "UNKNOWN_CAPABILITY", ref };
      }
      const reason = reasonFor(entry);
      return reason === undefined ? undefined : { reason, ref };
    }
  };
}
