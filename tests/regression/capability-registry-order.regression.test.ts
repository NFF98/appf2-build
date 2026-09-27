import { expect, test } from "vitest";

import { generateRegistryArtifacts } from "../../src/platform/capabilities/generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";

test("capability registry artifacts remain deterministic when source definition order changes", () => {
  const canonical = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE);
  const reordered = generateRegistryArtifacts({
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities: [...CAPABILITY_REGISTRY_SOURCE.capabilities].reverse()
  });

  expect(reordered).toEqual(canonical);
});
