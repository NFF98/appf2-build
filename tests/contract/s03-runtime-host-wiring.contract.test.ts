import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const SRC = join(import.meta.dirname, "../../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");
const SLOT = 'Symbol.for("appf2.f03.runtime-app-host")';

describe("S03 F03 host page wiring", () => {
  test("the page loads the F03 host entry before the Shell and both sides use the same non-writable slot", () => {
    const scripts = [...read("app/index.html").matchAll(/<script type="module" src="([^"]+)"><\/script>/gu)].map((match) => match[1]);
    expect(scripts).toEqual(["../platform/runtime/browser/register-runtime-app-host.ts", "./main.tsx"]);

    const entry = read("platform/runtime/browser/register-runtime-app-host.ts");
    expect(entry).toContain(`Object.defineProperty(globalThis, ${SLOT}`);
    expect(entry).toMatch(/writable: false,\s+configurable: false/u);
    expect(read("app/shell/browser-composition.ts")).toContain(`const RUNTIME_APP_HOST_SLOT = ${SLOT};`);
  });
});
