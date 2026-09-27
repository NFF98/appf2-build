import { describe, expect, test } from "vitest";

import {
  canonicalCoverageContext,
  resolveCapabilityCoverage,
  type CapabilityRequirement,
  type CoverageResolutionContext
} from "../../src/platform/capabilities/coverage.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";

function requirement(
  requirementId: string,
  semanticNeed: string,
  required = true
): CapabilityRequirement {
  return {
    requirement_id: requirementId,
    semantic_need: semanticNeed,
    required,
    impact_level: required ? "HIGH" : "LOW",
    input_types: [],
    output_types: [],
    interaction_class: "PRESENTATION",
    constraints: []
  };
}

function degradationContext(): CoverageResolutionContext {
  const base = CAPABILITY_REGISTRY_SOURCE.capabilities.find(({ id }) => id === "content.card");
  expect(base).toBeDefined();
  const sourceCapability: CapabilityDefinition = {
    ...base!,
    id: "test.rich_text",
    runtime: { ...base!.runtime, registrationKey: "test/rich-text" },
    semantic: {
      ...base!.semantic,
      meaning: "Present unavailable rich text.",
      intentClasses: ["rich_text"]
    },
    lifecycle: { ...base!.lifecycle, availability: "DISABLED" },
    degradation: {
      allowed: true,
      alternatives: [{ id: "content.text", version: "1.0.0" }],
      preservesSemanticCore: true
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
    ),
    mode: "PRODUCTION"
  };
}

function flattenedRefs(result: ReturnType<typeof resolveCapabilityCoverage>): readonly string[] {
  return result.requirements.flatMap(({ capabilityRefs }) =>
    capabilityRefs.map(({ id, version }) => `${id}@${version}`)
  );
}

describe("capability coverage contract", () => {
  test("F04-AC-012 TEST-F04-012 resolves every material requirement exactly once with an explicit status", () => {
    const requirements = [
      requirement("covered", "text"),
      requirement("degraded", "rich_text"),
      requirement("unsupported", "not_registered"),
      requirement("external", "external_generation")
    ];
    const result = resolveCapabilityCoverage(
      {
        requirements,
        externalRequirementIds: new Set(["external"])
      },
      degradationContext()
    );

    expect(result.requirements.map(({ requirementId }) => requirementId)).toEqual([
      "covered",
      "degraded",
      "unsupported",
      "external"
    ]);
    expect(new Set(result.requirements.map(({ requirementId }) => requirementId)).size).toBe(4);
    expect(result.requirements.map(({ status }) => status)).toEqual([
      "COVERED",
      "DEGRADED",
      "UNSUPPORTED",
      "EXTERNAL_REQUIRED"
    ]);
    expect(
      result.requirements.every(({ status }) =>
        ["COVERED", "DEGRADED", "UNSUPPORTED", "EXTERNAL_REQUIRED"].includes(status)
      )
    ).toBe(true);
    expect(result.registryVersion).toBe(degradationContext().source.registryVersion);
    expect(result.registryDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("F04-AC-015 TEST-F04-AC-015 rejects unknown LLM-suggested IDs and exact versions without fuzzy fallback", () => {
    const result = resolveCapabilityCoverage({
      requirements: [
        requirement("unknown-id", "not_registered"),
        requirement("unknown-version", "text")
      ],
      suggestedCapabilities: {
        "unknown-id": [{ id: "content.closest_looking", version: "1.0.0" }],
        "unknown-version": [{ id: "content.text", version: "9.9.9" }]
      }
    });
    const refs = flattenedRefs(result);

    expect(result.requirements[0]).toMatchObject({
      requirementId: "unknown-id",
      status: "UNSUPPORTED",
      capabilityRefs: []
    });
    expect(result.requirements[1]).toMatchObject({
      requirementId: "unknown-version",
      status: "COVERED",
      capabilityRefs: [{ id: "content.text", version: "1.0.0" }]
    });
    expect(refs).not.toContain("content.closest_looking@1.0.0");
    expect(refs).not.toContain("content.text@9.9.9");
    expect(result.selected).toEqual([{ id: "content.text", version: "1.0.0" }]);
  });

  test("F04-AC-016 TEST-F04-AC-016 keeps an optional absence truthful without blocking the Core Loop", () => {
    const result = resolveCapabilityCoverage(
      {
        requirements: [
          requirement("core-text", "text"),
          requirement("optional-chart", "chart", false)
        ],
        suggestedCapabilities: {
          "optional-chart": [{ id: "data.chart_basic", version: "1.0.0" }]
        }
      },
      canonicalCoverageContext()
    );

    expect(result.status).toBe("FULLY_SUPPORTED");
    expect(result.requirements).toEqual([
      expect.objectContaining({
        requirementId: "core-text",
        status: "COVERED",
        capabilityRefs: [{ id: "content.text", version: "1.0.0" }]
      }),
      expect.objectContaining({
        requirementId: "optional-chart",
        status: "UNSUPPORTED",
        capabilityRefs: []
      })
    ]);
    expect(result.gaps).toEqual([
      expect.objectContaining({ requirementId: "optional-chart", evidenceCode: "F04-EVT-006" })
    ]);
    expect(flattenedRefs(result)).not.toContain("data.chart_basic@1.0.0");
  });
});
