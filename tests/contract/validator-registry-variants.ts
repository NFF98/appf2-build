import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import type {
  GeneratedCapabilityValidator,
  ValidatorRegistry
} from "../../src/platform/capabilities/schema/validator-contract.js";

type CapabilityPatch = (capability: GeneratedCapabilityValidator) => GeneratedCapabilityValidator;

export function registryWith(
  patches: Readonly<Record<string, CapabilityPatch>>,
  base: ValidatorRegistry = VALIDATOR_REGISTRY
): ValidatorRegistry {
  const capabilities: Record<string, Record<string, GeneratedCapabilityValidator>> = Object.fromEntries(
    Object.entries(base.capabilities).map(([id, versions]) => [id, { ...versions }])
  );
  for (const [ref, patch] of Object.entries(patches)) {
    const [id, version] = ref.split("@") as [string, string];
    const current = capabilities[id]?.[version];
    if (current === undefined) {
      throw new Error(`Unknown capability ref in registry variant: ${ref}`);
    }
    capabilities[id]![version] = patch(current);
  }
  return { ...base, capabilities };
}

export function registryAdding(
  capability: GeneratedCapabilityValidator,
  base: ValidatorRegistry = VALIDATOR_REGISTRY
): ValidatorRegistry {
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      [capability.id]: { ...base.capabilities[capability.id], [capability.version]: capability }
    }
  };
}

export function withTimerSlots(timerSlotsPerInstance: number): CapabilityPatch {
  return (capability) => ({ ...capability, resource_usage: { timerSlotsPerInstance } });
}

export function withBudget(budget: Partial<GeneratedCapabilityValidator["resource_budget"]>): CapabilityPatch {
  return (capability) => ({ ...capability, resource_budget: { ...capability.resource_budget, ...budget } });
}
