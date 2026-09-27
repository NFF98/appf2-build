import { expect, test } from "vitest";

import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";

test("canonical ordering follows Unicode code points without locale dependence", () => {
  const privateUseBmp = "\uE000";
  const supplementary = "\u{10000}";

  expect(canonicalizeJson({ [supplementary]: 2, [privateUseBmp]: 1 })).toBe(
    `{"${privateUseBmp}":1,"${supplementary}":2}`
  );
});

test("canonicalization and hashing are stable without mutating caller input", () => {
  const blueprint = {
    meta: { title: "Stable" },
    nodes: [{ id: "node_b" }, { id: "node_a" }],
    state: { count: { initial: -0, type: "NUMBER" } }
  };
  const before = structuredClone(blueprint);

  const serializations = Array.from({ length: 5 }, () => canonicalizeJson(blueprint));
  const hashes = Array.from({ length: 5 }, () => hashBlueprint(blueprint));

  expect(new Set(serializations).size).toBe(1);
  expect(new Set(hashes).size).toBe(1);
  expect(Object.is(blueprint.state.count.initial, -0)).toBe(true);
  expect(blueprint).toEqual(before);
});

test("canonicalization rejects cycles instead of recursing indefinitely", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  expect(() => canonicalizeJson(cyclic)).toThrowError(
    expect.objectContaining({ code: "CYCLIC_VALUE" })
  );
});
