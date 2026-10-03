import type { PermissionClass } from "../capabilities/schema/capability-definition.js";
import type { GeneratedCapabilityValidator, ValidatorRegistry } from "../capabilities/schema/validator-contract.js";
import { lookupCapability } from "./capability-eligibility.js";
import { fail, type Blueprint, type CapabilityRef } from "./validation-types.js";

const PHASE1_PERMISSION_CLASSES: ReadonlySet<PermissionClass> = new Set(["NONE", "USER_GESTURE"]);

function violation(capability: GeneratedCapabilityValidator): string | undefined {
  if (!PHASE1_PERMISSION_CLASSES.has(capability.permission_class)) {
    return "permission_class is outside the Phase 1 NONE / USER_GESTURE allowlist";
  }
  if (capability.resource_budget.networkAccessAllowed) {
    return "networkAccessAllowed must be false in Phase 1";
  }
  if (capability.resource_budget.mediaAutoplayAllowed) {
    return "mediaAutoplayAllowed must be false in Phase 1";
  }
  return undefined;
}

function assertPermitted(capability: GeneratedCapabilityValidator | undefined, path: string, ref: CapabilityRef): void {
  const message = capability === undefined ? undefined : violation(capability);
  if (message !== undefined) {
    fail("F02-ERR-012", "V10", path, `Capability ${message}.`, ref);
  }
}

export function validatePermissionPolicy(
  blueprint: Blueprint,
  capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>,
  registry: ValidatorRegistry
): void {
  blueprint.nodes.forEach((node, index) => {
    assertPermitted(capabilities.get(node.id), `$.nodes[${index}].capability`, node.capability);
  });
  blueprint.support.degradations.forEach((degradation, index) => {
    degradation.capability_refs.forEach((ref, refIndex) => {
      assertPermitted(lookupCapability(registry, ref), `$.support.degradations[${index}].capability_refs[${refIndex}]`, ref);
    });
  });
}
