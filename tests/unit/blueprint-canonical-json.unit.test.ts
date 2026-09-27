import { describe, expect, test } from "vitest";

import {
  canonicalBlueprintBytes,
  canonicalizeJson,
  CanonicalJsonError
} from "../../src/platform/blueprint/canonical-json.js";

describe("Blueprint canonical JSON", () => {
  test("TEST-F02-001 canonicalizes equivalent logical Blueprints byte-for-byte", () => {
    const first = {
      state: { total: { type: "NUMBER", initial: 10 }, enabled: true },
      meta: { title: "Budget", description: "A\nB" },
      nodes: [{ id: "node_second" }, { id: "node_first" }]
    };
    const second = {
      nodes: [{ id: "node_second" }, { id: "node_first" }],
      meta: { description: "A\nB", title: "Budget" },
      state: { enabled: true, total: { initial: 10, type: "NUMBER" } }
    };

    expect(canonicalizeJson(first)).toBe(
      '{"meta":{"description":"A\\nB","title":"Budget"},"nodes":[{"id":"node_second"},{"id":"node_first"}],"state":{"enabled":true,"total":{"initial":10,"type":"NUMBER"}}}'
    );
    expect(canonicalBlueprintBytes(second)).toEqual(canonicalBlueprintBytes(first));
    expect(Array.from(canonicalBlueprintBytes("\u00e9"))).toEqual([34, 195, 169, 34]);
    expect(Array.from(canonicalBlueprintBytes("e\u0301"))).toEqual([34, 101, 204, 129, 34]);
    expect(canonicalizeJson("\u00e9")).not.toBe(canonicalizeJson("e\u0301"));
  });

  test("preserves array order and canonicalizes negative zero as zero", () => {
    expect(canonicalizeJson({ values: [3, -0, 1] })).toBe('{"values":[3,0,1]}');
    expect(canonicalizeJson({ values: [1, 0, 3] })).not.toBe(
      canonicalizeJson({ values: [3, -0, 1] })
    );
  });

  test.each([
    ["undefined object value", { value: undefined }, "UNSUPPORTED_TYPE"],
    ["undefined array value", [undefined], "UNSUPPORTED_TYPE"],
    ["NaN", { value: Number.NaN }, "NON_FINITE_NUMBER"],
    ["positive Infinity", { value: Number.POSITIVE_INFINITY }, "NON_FINITE_NUMBER"],
    ["negative Infinity", { value: Number.NEGATIVE_INFINITY }, "NON_FINITE_NUMBER"]
  ] as const)("rejects %s instead of silently omitting or coercing it", (_label, value, code) => {
    expect(() => canonicalizeJson(value)).toThrowError(CanonicalJsonError);
    expect(() => canonicalizeJson(value)).toThrowError(
      expect.objectContaining({ code })
    );
  });

  test("keeps a missing optional field distinct from explicit null", () => {
    expect(canonicalizeJson({ title: "App" })).toBe('{"title":"App"}');
    expect(canonicalizeJson({ title: "App", description: null })).toBe(
      '{"description":null,"title":"App"}'
    );
  });

  test("rejects accessor-backed properties without executing them", () => {
    let getterExecuted = false;
    const value = Object.defineProperty({}, "title", {
      enumerable: true,
      get() {
        getterExecuted = true;
        return "App";
      }
    });

    expect(() => canonicalizeJson(value)).toThrowError(
      expect.objectContaining({ code: "ACCESSOR_PROPERTY" })
    );
    expect(getterExecuted).toBe(false);
  });
});
