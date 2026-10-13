import { describe, expect, test } from "vitest";

import { evaluateResult, resultDurability } from "../../src/platform/runtime/result-evaluation.js";
import { productionHarness, resultBlueprint } from "../runtime/result-fixtures.js";
import { change } from "../runtime/runtime-fixtures.js";

describe("F03 result sensitivity for F16 persistence policy", () => {
  test("TEST-F03-AC-024 every evaluated output carries its canonical sensitivity and durability class, and F03 itself persists none of it", async () => {
    const harness = await productionHarness(resultBlueprint());
    const declared = harness.runtime.blueprint?.result.outputs.map(({ id, sensitivity }) => ({ id, sensitivity }));
    const policyView = () =>
      evaluateResult(harness.runtime)?.outputs.map((output) => ({
        id: output.id,
        status: output.status,
        sensitivity: output.sensitivity,
        durability: resultDurability(output.sensitivity)
      }));

    const expected = [
      { id: "per_person", status: "AVAILABLE", sensitivity: "NORMAL", durability: "DURABLE_ELIGIBLE" },
      { id: "ratio", status: "ERROR", sensitivity: "SENSITIVE", durability: "NOT_DURABLE_UNLESS_EXPLICIT_POLICY" },
      { id: "note", status: "AVAILABLE", sensitivity: "DO_NOT_PERSIST", durability: "NEVER_DURABLE" }
    ];
    expect(policyView()).toEqual(expected);
    expect(policyView()?.map(({ id, sensitivity }) => ({ id, sensitivity }))).toEqual(declared);

    // Values follow committed state; the sensitivity classes never move with them.
    expect(change(harness, "node_note", "生日驚喜名單").accepted).toBe(true);
    expect(evaluateResult(harness.runtime)?.outputs[2]).toMatchObject({ status: "AVAILABLE", value: "生日驚喜名單", sensitivity: "DO_NOT_PERSIST" });
    expect(policyView()).toEqual(expected);

    // F03 hands the classes to F16 and writes no Result value into its own Evidence.
    const evidence = JSON.stringify(harness.evidence);
    expect(harness.evidence.length).toBeGreaterThan(0);
    for (const value of ["生日驚喜名單", "私人備註"]) expect(evidence).not.toContain(value);
  });
});
