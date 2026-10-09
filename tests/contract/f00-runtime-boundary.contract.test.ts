import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { RuntimeProcessingPresenter, type RuntimeOperationFeed } from "../../src/app/runtime/runtime-processing.js";
import type { RuntimeInstance } from "../../src/platform/runtime/runtime-instance.js";
import { committedSnapshot, operationBlueprint, operationHarness, pressOp, tokenOf } from "../runtime/runtime-operation-fixtures.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const APP_ROOT = join(REPO_ROOT, "src/app");
const RUNTIME_ROOT = join(REPO_ROOT, "src/platform/runtime");
/** Read-only projection types the Shell may name; everything else in F03 (Instance, Store, transactions) is off-limits. */
const ALLOWED_RUNTIME_TYPE_MODULES = new Set(["runtime-operation.ts", "runtime-evidence.ts"]);
const IMPORT_PATTERN = /^\s*(import|export)\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

type RuntimeImport = { readonly file: string; readonly target: string; readonly typeOnly: boolean };

function runtimeImports(): RuntimeImport[] {
  const found: RuntimeImport[] = [];
  for (const file of sourceFiles(APP_ROOT)) {
    for (const match of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
      const specifier = match[3] ?? "";
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(file), specifier).replace(/\.js$/, ".ts");
      if (!target.startsWith(RUNTIME_ROOT)) continue;
      found.push({ file: relative(REPO_ROOT, file).replaceAll("\\", "/"), target: relative(RUNTIME_ROOT, target), typeOnly: match[2] !== undefined });
    }
  }
  return found;
}

/** Wraps the real Runtime Instance and records every member the Shell touches. */
function observedFeed(runtime: RuntimeInstance): { readonly feed: RuntimeOperationFeed; readonly touched: Set<PropertyKey> } {
  const touched = new Set<PropertyKey>();
  const feed = new Proxy(runtime, {
    get(target, property) {
      touched.add(property);
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  return { feed, touched };
}

describe("F00 Shell / F03 Runtime Instance Store boundary", () => {
  test("TEST-F00-020 the Shell only reads F03 operation projections and never writes the Runtime Instance Store", async () => {
    // Static boundary: src/app reaches F03 only through type-only imports of the projection contracts.
    const imports = runtimeImports();
    expect(imports.length).toBeGreaterThan(0);
    for (const entry of imports) {
      expect(entry.typeOnly, `${entry.file} → ${entry.target}`).toBe(true);
      expect(ALLOWED_RUNTIME_TYPE_MODULES.has(entry.target), `${entry.file} → ${entry.target}`).toBe(true);
    }

    // Behavioral boundary: with the Shell presenter attached, the committed Runtime state is exactly what F03
    // produces without it, and the presenter touched nothing but the operation subscription.
    const observed = await operationHarness(operationBlueprint());
    const twin = await operationHarness(operationBlueprint());
    const { feed, touched } = observedFeed(observed.runtime);
    const presenter = new RuntimeProcessingPresenter(feed);
    const committed = new Set<string>();
    presenter.subscribe(() => {
      const settled = presenter.getSnapshot().settled;
      if (settled?.status === "COMMITTED") committed.add(settled.operationToken);
    });
    const before = committedSnapshot(observed);
    for (const nodeId of ["node_go", "node_plain", "node_go"]) {
      const token = tokenOf(pressOp(observed, nodeId));
      pressOp(twin, nodeId);
      expect(committed.has(token)).toBe(true);
      expect(presenter.getSnapshot().processing).toBeNull();
    }
    expect([...touched]).toEqual(["subscribeOperations"]);
    expect(committedSnapshot(observed)).toBe(committedSnapshot(twin));
    expect(committedSnapshot(observed)).not.toBe(before);
    expect(observed.notices).toEqual(twin.notices);
    expect(observed.runtime.actionSequence).toBe(twin.runtime.actionSequence);

    presenter.dispose();
    pressOp(observed, "node_plain");
    pressOp(twin, "node_plain");
    expect(committedSnapshot(observed)).toBe(committedSnapshot(twin));
  });
});
