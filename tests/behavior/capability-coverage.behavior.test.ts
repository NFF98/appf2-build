import { describe, expect, test } from "vitest";

import {
  resolveCapabilityCoverage,
  type CapabilityRequirement,
  type CoverageResolutionContext
} from "../../src/platform/capabilities/coverage.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";

function requirement(semanticNeed: string): CapabilityRequirement {
  return {
    requirement_id: "rich-output",
    semantic_need: semanticNeed,
    required: true,
    impact_level: "HIGH",
    input_types: [],
    output_types: ["STRING"],
    interaction_class: "PRESENTATION",
    constraints: []
  };
}

function contextWithDegradation(
  semanticNeed: string,
  preservesSemanticCore: boolean
): CoverageResolutionContext {
  const base = CAPABILITY_REGISTRY_SOURCE.capabilities.find(({ id }) => id === "content.card");
  expect(base).toBeDefined();
  const sourceCapability: CapabilityDefinition = {
    ...base!,
    id: `test.${semanticNeed}`,
    runtime: { ...base!.runtime, registrationKey: `test/${semanticNeed}` },
    semantic: {
      ...base!.semantic,
      meaning: `Unavailable ${semanticNeed} presentation.`,
      intentClasses: [semanticNeed]
    },
    lifecycle: { ...base!.lifecycle, availability: "DISABLED" },
    degradation: {
      allowed: true,
      alternatives: [{ id: "content.text", version: "1.0.0" }],
      preservesSemanticCore
    }
  };
  const source: RegistrySource = {
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities: [...CAPABILITY_REGISTRY_SOURCE.capabilities, sourceCapability]
  };
  return {
    source,
    trustedRuntimeRegistrationKeys: new Set(
      source.capabilities.map(({ runtime }) => runtime.registrationKey)
    )
  };
}

describe("capability degradation behavior", () => {
  test("F04-AC-013 TEST-F04-AC-013 selects only a declared degradation that preserves semantic core", () => {
    const result = resolveCapabilityCoverage(
      { requirements: [requirement("safe_rich_output")] },
      contextWithDegradation("safe_rich_output", true)
    );

    expect(result.status).toBe("PARTIALLY_SUPPORTED");
    expect(result.requirements).toEqual([
      expect.objectContaining({
        requirementId: "rich-output",
        status: "DEGRADED",
        capabilityRefs: [{ id: "content.text", version: "1.0.0" }],
        degradation: {
          sourceCapabilityRef: { id: "test.safe_rich_output", version: "1.0.0" },
          alternativeCapabilityRef: { id: "content.text", version: "1.0.0" },
          preservesSemanticCore: true
        }
      })
    ]);
    expect(result.selected).toEqual([
      { id: "content.text", version: "1.0.0" }
    ]);
  });

  test("F04-AC-014 TEST-F04-014 rejects a declared alternative that loses semantic core", () => {
    const result = resolveCapabilityCoverage(
      { requirements: [requirement("unsafe_rich_output")] },
      contextWithDegradation("unsafe_rich_output", false)
    );

    expect(result.status).toBe("UNSUPPORTED");
    expect(result.status).not.toBe("FULLY_SUPPORTED");
    expect(result.status).not.toBe("PARTIALLY_SUPPORTED");
    expect(result.requirements).toEqual([
      {
        requirementId: "rich-output",
        status: "UNSUPPORTED",
        capabilityRefs: [],
        reason: "F04-ERR-008 SEMANTIC_CORE_NOT_PRESERVED"
      }
    ]);
    expect(result.selected).toEqual([]);
    expect(result.gaps).toEqual([
      {
        requirementId: "rich-output",
        description: "F04-ERR-008 SEMANTIC_CORE_NOT_PRESERVED",
        evidenceCode: "F04-ERR-008"
      }
    ]);
  });
});
