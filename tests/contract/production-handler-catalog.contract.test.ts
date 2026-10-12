import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "vitest";

import { createBundledReleaseSource, CURRENT_BUNDLED_RELEASE } from "../../src/platform/capabilities/bundled-release.js";
import { CORE_CAPABILITY_HANDLERS } from "../../src/platform/runtime/core-handlers.js";

const SRC = join(import.meta.dirname, "../../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

describe("production trusted handler catalog", () => {
  test("the bundled handler set covers exactly the pinned Runtime Registry registration keys and nothing from tests/", async () => {
    const registered = Object.values(CURRENT_BUNDLED_RELEASE.runtime_registry.capabilities)
      .flatMap((versions) => Object.values(versions).map((binding) => binding.registration_key))
      .sort();
    expect([...CORE_CAPABILITY_HANDLERS.keys()].sort()).toEqual(registered);

    const catalog = await createBundledReleaseSource({ bundledHandlers: CORE_CAPABILITY_HANDLERS }).loadRuntimeHandlerCatalog();
    expect(catalog).toEqual({ registration_keys: registered });

    const testImports = sourceFiles(SRC)
      .filter((file) => /from\s+["'][^"']*\/tests\//u.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(testImports).toEqual([]);

    const compositions = ["edge/worker-composition.ts", "platform/runtime/browser/browser-runtime.ts"].map((file) => readFileSync(join(SRC, file), "utf8"));
    for (const text of compositions) expect(text).toMatch(/import \{ CORE_CAPABILITY_HANDLERS \} from "(?:\.\.\/)+(?:platform\/runtime\/)?core-handlers\.js"/u);
  });
});
