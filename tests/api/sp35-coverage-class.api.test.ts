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
      requirements: [{ ...requirement("form", "Unrecognized arbitrary UI request"), input_types: ["LIST", "STRING"], output_types: ["LIST"] }]
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.selected).toEqual([]);
  });

  it("selects a registered text input for exact STRING form input and output", () => {
    const result = resolveCapabilityCoverage({ requirements: [
      requirement("form", "Enter a new task title as text")
    ] });
    expect(result.status).toBe("FULLY_SUPPORTED");
    expect(result.selected).toEqual([{ id: "input.text", version: "1.0.0" }]);
  });

  it("selects a registered toggle for exact BOOLEAN form input and output", () => {
    const result = resolveCapabilityCoverage({ requirements: [{
      ...requirement("form", "Toggle task completion"),
      input_types: ["BOOLEAN"], output_types: ["BOOLEAN"]
    }] });
    expect(result.status).toBe("FULLY_SUPPORTED");
    expect(result.selected).toEqual([{ id: "input.toggle", version: "1.0.0" }]);
  });

  it("never pretends mixed task CRUD or unknown numeric form input is covered", () => {
    for (const types of [["STRING", "LIST"], ["NUMBER"]]) {
      const result = resolveCapabilityCoverage({ requirements: [{
        ...requirement("form", "Add, edit, delete, complete, group and filter all tasks"),
        input_types: types, output_types: ["LIST"]
      }] });
      expect(result.status).toBe("UNSUPPORTED");
      expect(result.selected).toEqual([]);
    }
  });

  it("maps a read-only numeric count to real reactive data.stat", () => {
    const coverage = resolveCapabilityCoverage({ requirements: [{
      ...requirement("counter", "Show remaining shopping item count"),
      input_types: [], output_types: ["NUMBER"]
    }] });
    expect(coverage.status).toBe("FULLY_SUPPORTED");
    expect(coverage.selected).toEqual([{ id: "data.stat", version: "1.0.0" }]);
  });

  it("refuses to mistake record-list mutation for a numeric counter", () => {
    const coverage = resolveCapabilityCoverage({ requirements: [{
      ...requirement("counter", "Add expenses and update all entries"),
      input_types: ["RECORD"], output_types: ["LIST", "NUMBER"]
    }] });
    expect(coverage.status).toBe("UNSUPPORTED");
    expect(coverage.selected).toEqual([]);
  });

  it("does not match a made-up interaction class or arbitrary capability", () => {
    const result = resolveCapabilityCoverage({
      requirements: [requirement("unregistered_intent_class", "Display secret data")]
    });
    expect(result.status).toBe("UNSUPPORTED");
    expect(result.selected).toEqual([]);
  });
  it("never mistakes a button/list/stat display for full mutable task CRUD", () => {
    for (const invalid of [
      { interaction_class: "button", input_types: ["RECORD", "LIST"], output_types: ["LIST"] },
      { interaction_class: "action", input_types: ["RECORD"], output_types: ["LIST"] },
      { interaction_class: "list", input_types: ["RECORD"], output_types: ["LIST"] },
      { interaction_class: "repeated_content", input_types: ["STRING", "LIST"], output_types: ["LIST"] },
      { interaction_class: "statistic", input_types: ["LIST"], output_types: ["NUMBER"] }
    ]) {
      const coverage = resolveCapabilityCoverage({ requirements: [{
        ...requirement(invalid.interaction_class, "Edit all task records and filter completion"),
        input_types: invalid.input_types, output_types: invalid.output_types
      }] });
      expect(coverage.status).toBe("UNSUPPORTED");
      expect(coverage.selected).toEqual([]);
    }
  });

  it("still admits an actual atomic button, bounded list and display metric", () => {
    const cases = [
      { interaction_class: "button", input_types: [], output_types: [], id: "action.button" },
      { interaction_class: "list", input_types: [], output_types: ["LIST"], id: "content.list" },
      { interaction_class: "statistic", input_types: [], output_types: ["NUMBER"], id: "data.stat" },
      { interaction_class: "result", input_types: ["NUMBER"], output_types: ["NUMBER"], id: "data.stat" }
    ];
    for (const shape of cases) {
      const result = resolveCapabilityCoverage({ requirements: [{
        ...requirement(shape.interaction_class, "Atomic display or button"),
        input_types: shape.input_types, output_types: shape.output_types
      }] });
      expect(result.status).toBe("FULLY_SUPPORTED");
      expect(result.selected.map(ref => ref.id)).toEqual([shape.id]);
    }
  });

});
