import type { PermissionClass } from "../capabilities/schema/capability-definition.js";
import type { GeneratedCapabilityValidator, ValidatorRegistry } from "../capabilities/schema/validator-contract.js";
import { lookupCapability } from "./capability-contract.js";
import { fail, type Blueprint, type CapabilityRef } from "./validation-types.js";

const PHASE1_PERMISSION_CLASSES: ReadonlySet<PermissionClass> = new Set(["NONE", "USER_GESTURE"]);

interface ReferencedCapability {
  readonly ref: CapabilityRef;
  readonly path: string;
  readonly capability: GeneratedCapabilityValidator;
}

function referencedCapabilities(
  blueprint: Blueprint,
  registry: ValidatorRegistry,
  nodeCapabilities: ReadonlyMap<string, GeneratedCapabilityValidator>
): readonly ReferencedCapability[] {
  const referenced: ReferencedCapability[] = blueprint.nodes.map((node, index) => ({
    ref: node.capability,
    path: `$.nodes[${index}].capability`,
    capability: nodeCapabilities.get(node.id) as GeneratedCapabilityValidator
  }));
  blueprint.support.degradations.forEach((degradation, index) =>
    degradation.capability_refs.forEach((ref, refIndex) => {
      const capability = lookupCapability(registry, ref);
      if (capability !== undefined) {
        referenced.push({ ref, path: `$.support.degradations[${index}].capability_refs[${refIndex}]`, capability });
      }
    })
  );
  return referenced;
}

/**
 * V10: Phase 1 permission policy over every referenced exact CapabilityRef. No-code safety is structural
 * (closed schema + generated validator allowlist + trusted runtime mapping); strings are never scanned as code.
 */
export function validatePermissions(
  blueprint: Blueprint,
  registry: ValidatorRegistry,
  nodeCapabilities: ReadonlyMap<string, GeneratedCapabilityValidator>
): void {
  for (const { ref, path, capability } of referencedCapabilities(blueprint, registry, nodeCapabilities)) {
    if (!PHASE1_PERMISSION_CLASSES.has(capability.permission_class)) {
      fail("F02-ERR-012", "V10", path, "Capability permission_class is outside NONE/USER_GESTURE.", ref);
    }
    if (capability.resource_budget.networkAccessAllowed) {
      fail("F02-ERR-012", "V10", path, "Capability networkAccessAllowed must be false.", ref);
    }
    if (capability.resource_budget.mediaAutoplayAllowed) {
      fail("F02-ERR-012", "V10", path, "Capability mediaAutoplayAllowed must be false.", ref);
    }
  }
}
