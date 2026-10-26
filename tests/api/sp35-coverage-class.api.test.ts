import { describe, expect, it } from "vitest";
import { resolveCapabilityCoverage, type CapabilityRequirement } from "../../src/platform/capabilities/coverage.js";

const requirement = (interaction_class: string, semantic_need: string): CapabilityRequirement => ({
  requirement_id: "show_welcome",
  semantic_need,
  interaction_class,
  required: true,
  impact_level: "HIGH",
  input_types: ["STRING"],
  output_types: ["STRING"],
  constraints: []
});

describe("AI-generated semantic needs map only through unambiguous registered classes", () => {
  it("resolves free-text welcome label to real content.text", () => {
    const result = resolveCapabilityCoverage({
      requirements: [requirement("label", "Display Hello World on screen.")]
    });
    expect(result.status).toBe("FULLY_SUPPORTED");
    expect(result.selected).toContainEqual({ id: "content.text", version: "1.0.0" });
  });

  it("resolves a one-screen layout to its registered layout.container", () => {
    const result = resolveCapabilityCoverage({
      requirements: [requirement("layout", "Present a single read-only screen.")]
    });
    expect(result.selected).toContainEqual({ id: "layout.container", version: "1.0.0" });
  });

  it("fails closed for a class shared by different capabilities", () => {
    const result = resolveCapabilityCoverage({
      requirements: [requirement("form", "Unrecognized arbitrary UI request")]
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.selected).toEqual([]);
  });

  it("does not match a made-up interaction class or arbitrary capability", () => {
    const result = resolveCapabilityCoverage({
      requirements: [requirement("unregistered_intent_class", "Display secret data")]
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.selected).toEqual([]);
  });
});
