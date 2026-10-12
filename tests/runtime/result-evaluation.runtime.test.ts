import { describe, expect, test } from "vitest";

import { evaluateResult } from "../../src/platform/runtime/result-evaluation.js";
import type { RuntimeNodeRenderer } from "../../src/platform/runtime/runtime-instance.js";
import { productionHarness, resultBlueprint } from "./result-fixtures.js";
import { change, runtimeHarness, snapshot } from "./runtime-fixtures.js";

describe("F03 result evaluation", () => {
  test("TEST-F03-009 Result is evaluated from result.outputs over committed Runtime state, never from rendered output", async () => {
    const pending = await runtimeHarness(resultBlueprint());
    expect(evaluateResult(pending.runtime)).toBeUndefined();

    const harness = await productionHarness(resultBlueprint());
    expect(typeof document).toBe("undefined");
    expect(evaluateResult(harness.runtime)).toEqual({
      action_sequence: 0,
      outputs: [
        { id: "per_person", label: "每人金額", sensitivity: "NORMAL", status: "AVAILABLE", value: 30 },
        { id: "ratio", label: "比例", sensitivity: "SENSITIVE", status: "ERROR", error_code: "F03-ERR-008" },
        { id: "note", label: "備註", sensitivity: "DO_NOT_PERSIST", status: "AVAILABLE", value: "私人備註" }
      ]
    });

    expect(change(harness, "node_people", 6).accepted).toBe(true);
    const committed = evaluateResult(harness.runtime);
    expect(committed?.action_sequence).toBe(1);
    expect(committed?.outputs[0]).toMatchObject({ status: "AVAILABLE", value: 20 });
    expect(committed?.outputs[1]).not.toHaveProperty("value");

    // A renderer that displays something else entirely cannot influence the Result.
    const tampered: RuntimeNodeRenderer<string> = { render: () => "999", fallback: () => "999" };
    expect(harness.runtime.renderTree(tampered)).toBe("999");
    expect(evaluateResult(harness.runtime)).toEqual(committed);

    // A rejected action commits nothing, so the Result keeps the last committed value.
    const before = snapshot(harness, ["people", "total"]);
    change(harness, "node_people", "six");
    expect(snapshot(harness, ["people", "total"])).toEqual(before);
    expect(evaluateResult(harness.runtime)).toEqual(committed);

    harness.runtime.dispose();
    expect(evaluateResult(harness.runtime)).toBeUndefined();
  });
});
