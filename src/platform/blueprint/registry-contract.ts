import { VALIDATOR_REGISTRY } from "../../../generated/capabilities/validator-registry.js";

export interface CapabilityContract {
  readonly id: string;
  readonly version: string;
  readonly bindings: ReadonlySet<string>;
  readonly events: ReadonlySet<string>;
  readonly actions: ReadonlySet<string>;
  readonly allowsChildren: boolean;
  readonly allowsRepeat: boolean;
}

const contracts = new Map<string, CapabilityContract>();
const capabilityIds = new Set<string>();

for (const capability of VALIDATOR_REGISTRY.capabilities) {
  const bindings = new Set<string>(capability.bindings);
  const contract: CapabilityContract = {
    id: capability.id,
    version: capability.version,
    bindings,
    events: new Set<string>(capability.events),
    actions: new Set<string>(capability.actions),
    allowsChildren: bindings.has("children"),
    allowsRepeat: bindings.has("items")
  };
  contracts.set(capabilityKey(capability.id, capability.version), contract);
  capabilityIds.add(capability.id);
}

export const VALIDATOR_REGISTRY_VERSION: string = VALIDATOR_REGISTRY.registryVersion;

export function capabilityKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function findCapabilityContract(
  id: string,
  version: string
): CapabilityContract | undefined {
  return contracts.get(capabilityKey(id, version));
}

export function capabilityIdExists(id: string): boolean {
  return capabilityIds.has(id);
}
