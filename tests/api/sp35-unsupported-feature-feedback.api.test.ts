import { describe, expect, it } from "vitest";
import { resolveCapabilityCoverage } from "../../src/platform/capabilities/coverage.js";
import type { CapabilityRequirement } from "../../src/platform/intent/capability-requirements.js";
import { unsupportedCoverageDetails } from "../../src/platform/compiler/compile-intent.js";
import { readFailure } from "../../src/app/create/f01-wire.js";

const required = (id: string, cls: string, description: string, needed = true): CapabilityRequirement => ({
  requirement_id: id, semantic_need: description, required: needed, impact_level: "HIGH",
  input_types: ["RECORD"], output_types: ["LIST"], interaction_class: cls, constraints: []
});

describe("Sprint 3.5 truthful unmet-feature feedback", () => {
  it("lists required unsupported LifePilot workflows without calling static cards a PASS", () => {
    const requirements = [
      required("tasks", "form", "Edit, delete and filter real tasks"),
      required("shopping", "form", "Add a quantity and edit grocery items"),
      required("optional", "form", "Optional decorative effect", false)
    ];
    const coverage = resolveCapabilityCoverage({ requirements });
    expect(coverage.status).toBe("UNSUPPORTED");
    const details = unsupportedCoverageDetails(coverage, requirements);
    expect(details).toEqual({
      coverage_status: "UNSUPPORTED", unsupported_count: 2,
      unsupported_features: ["Edit, delete and filter real tasks", "Add a quantity and edit grocery items"]
    });
    const failure = readFailure(422, {
      error: { code: "F01-ERR-008", retryable: false, details }
    });
    expect(failure).toMatchObject({
      kind: "API", code: "F01-ERR-008", unsupportedCount: 2,
      unsupportedFeatures: ["Edit, delete and filter real tasks", "Add a quantity and edit grocery items"]
    });
  });

  it("limits user-visible text to six bounded missing features", () => {
    const reqs = Array.from({ length: 12 }, (_, index) =>
      required("req_" + index, "form", "X".repeat(250) + index));
    const coverage = resolveCapabilityCoverage({ requirements: reqs });
    const details = unsupportedCoverageDetails(coverage, reqs);
    expect(details.unsupported_count).toBe(12);
    expect(details.unsupported_features).toHaveLength(6);
    expect((details.unsupported_features as string[]).every(s => s.length <= 160)).toBe(true);
  });

  it("ignores malformed provider messages and forged feature count in error body", () => {
    const failure = readFailure(422, {
      error: { code: "F01-ERR-008", retryable: false, details: {
        unsupported_count: "not a number",
        unsupported_features: ["fake", 123, "X".repeat(10000)]
      } }
    });
    expect(failure).toMatchObject({
      kind: "API", unsupportedFeatures: [], unsupportedCount: 0
    });
  });
});
