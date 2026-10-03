import { CORE_CAPABILITY_DEFINITIONS } from "./definitions/core.js";
import type { RegistrySource } from "./schema/capability-definition.js";

export const REGISTRY_VERSION = "7.0.0";
export const RUNTIME_VERSION = "1.0.0";
export const BLUEPRINT_SCHEMA_RANGE = ">=1.0.0 <2.0.0";

export const CAPABILITY_REGISTRY_SOURCE: RegistrySource = {
  registryVersion: REGISTRY_VERSION,
  runtimeVersion: RUNTIME_VERSION,
  blueprintSchemaRange: BLUEPRINT_SCHEMA_RANGE,
  capabilities: CORE_CAPABILITY_DEFINITIONS
};
