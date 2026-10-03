import {
  CapabilityAdmissionError,
  matchesCapabilityVersionRange,
  matchesRuntimeVersionBounds
} from "../capabilities/admission.js";
import type { ExecutionClass } from "../capabilities/schema/capability-definition.js";
import type {
  GeneratedCapabilityValidator,
  ValidatorRegistry
} from "../capabilities/schema/validator-contract.js";

export type CapabilityIneligibility =
  | "CAPABILITY_DISABLED"
  | "CAPABILITY_REVOKED"
  | "CAPABILITY_DEPENDENCY_UNAVAILABLE"
  | "EXECUTION_CLASS_UNSUPPORTED"
  | "CAPABILITY_INCOMPATIBLE";

export interface EligibilityTarget {
  readonly schemaVersion: string;
  readonly runtimeVersion: string;
}

export type CapabilityEligibilityEvaluator = (
  capability: GeneratedCapabilityValidator
) => CapabilityIneligibility | undefined;

const TRUSTED_EXECUTION_CLASSES: ReadonlySet<ExecutionClass> = new Set([
  "LOCAL_REACT",
  "LOCAL_RULE",
  "LOCAL_EFFECT"
]);

function refKey(capability: GeneratedCapabilityValidator): string {
  return `${capability.id}@${capability.version}`;
}

function withinRange(match: () => boolean): boolean {
  try {
    return match();
  } catch (error: unknown) {
    if (error instanceof CapabilityAdmissionError) {
      return false;
    }
    throw error;
  }
}

function isCompatible(capability: GeneratedCapabilityValidator, target: EligibilityTarget): boolean {
  const { compatibility } = capability;
  return (
    withinRange(() => matchesCapabilityVersionRange(target.schemaVersion, compatibility.blueprintSchemaRange)) &&
    withinRange(() =>
      matchesRuntimeVersionBounds(
        target.runtimeVersion,
        compatibility.minRuntimeVersion,
        compatibility.maxRuntimeVersion
      )
    )
  );
}

export function createCapabilityEligibilityEvaluator(
  registry: ValidatorRegistry,
  target: EligibilityTarget
): CapabilityEligibilityEvaluator {
  const dependencyAvailability = new Map<string, boolean>();

  const isActive = (capability: GeneratedCapabilityValidator): boolean =>
    capability.availability === "ENABLED" && capability.execution_status === "ACTIVE";

  const dependenciesAvailable = (capability: GeneratedCapabilityValidator, visiting: Set<string>): boolean =>
    capability.compatibility.dependencies.every((dependency) => {
      if (!dependency.required) {
        return true;
      }
      const versions = Object.hasOwn(registry.capabilities, dependency.id)
        ? registry.capabilities[dependency.id]
        : undefined;
      return Object.values(versions ?? {}).some(
        (candidate) =>
          withinRange(() => matchesCapabilityVersionRange(candidate.version, dependency.versionRange)) &&
          isAvailableDependency(candidate, visiting)
      );
    });

  const isAvailableDependency = (capability: GeneratedCapabilityValidator, visiting: Set<string>): boolean => {
    const key = refKey(capability);
    const cached = dependencyAvailability.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (visiting.has(key)) {
      return false;
    }
    visiting.add(key);
    const available = isActive(capability) && dependenciesAvailable(capability, visiting);
    visiting.delete(key);
    dependencyAvailability.set(key, available);
    return available;
  };

  return (capability) => {
    if (capability.availability !== "ENABLED") {
      return "CAPABILITY_DISABLED";
    }
    if (capability.execution_status !== "ACTIVE") {
      return "CAPABILITY_REVOKED";
    }
    if (!dependenciesAvailable(capability, new Set([refKey(capability)]))) {
      return "CAPABILITY_DEPENDENCY_UNAVAILABLE";
    }
    if (!TRUSTED_EXECUTION_CLASSES.has(capability.execution_class)) {
      return "EXECUTION_CLASS_UNSUPPORTED";
    }
    if (!isCompatible(capability, target)) {
      return "CAPABILITY_INCOMPATIBLE";
    }
    return undefined;
  };
}
