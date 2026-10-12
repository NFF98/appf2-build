import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { build, createServer as createViteServer, type ViteDevServer } from "vite";

import type { AppSurfaceEntry } from "../../../src/app/app-surface/AppSurface.js";
import type * as S03AdmittedModule from "./s03-admitted.js";
import { APP_ORIGIN, fulfillStatic } from "./s03-worker-host.js";

const HARNESS_ROOT = fileURLToPath(new URL("./s03-surface-harness/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ADMITTED_MODULE = "/tests/e2e/support/s03-admitted.ts";

export type S03Variant = S03AdmittedModule.S03Variant;

/** What the harness page recorded from the product AppSurface callbacks. */
export type SurfaceRecord = { readonly entries: AppSurfaceEntry[]; readonly returns: number; readonly homes: number };

interface SharedBuild {
  readonly outDir: string;
  readonly vite: ViteDevServer;
  readonly module: typeof S03AdmittedModule;
}

let shared: Promise<SharedBuild> | null = null;

async function buildOnce(): Promise<SharedBuild> {
  const outDir = resolve(await mkdtemp(join(tmpdir(), "appf2-s03-surface-")));
  await build({ root: HARNESS_ROOT, configFile: false, logLevel: "error", base: "/", build: { outDir, emptyOutDir: true } });
  const vite = await createViteServer({
    root: REPO_ROOT,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false }
  });
  return { outDir, vite, module: (await vite.ssrLoadModule(ADMITTED_MODULE)) as typeof S03AdmittedModule };
}

/**
 * Test-only page that mounts the product S03 `AppSurface` over a real browser F03 Instance (production handler
 * catalog) hydrated from a fresh server-side admission, and records the entries the surface hands off. No network
 * beyond the page itself: every other origin is aborted.
 */
export const S03SurfaceHarness = {
  async open(page: Page, options: { readonly variant?: S03Variant; readonly inspection?: "COMPOSER" | "PREVIEW" } = {}): Promise<void> {
    shared ??= buildOnce();
    const { outDir, module } = await shared;
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== APP_ORIGIN) return route.abort("blockedbyclient");
      if (url.pathname !== "/admitted.json") return fulfillStatic(route, outDir, url);
      const admitted = await module.freshAdmittedBlueprint(options.variant ?? "ORIGINAL");
      return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(admitted) });
    });
    await page.goto(`${APP_ORIGIN}/${options.inspection === undefined ? "" : `?inspection=${options.inspection}`}`);
    await page.locator("body[data-hydration]").waitFor();
  },

  record(page: Page): Promise<SurfaceRecord> {
    return page.evaluate(() => structuredClone((window as unknown as { s03Harness: SurfaceRecord }).s03Harness));
  },

  async shutdown(): Promise<void> {
    const current = shared;
    shared = null;
    if (current === null) return;
    const { outDir, vite } = await current;
    await vite.close();
    await rm(outDir, { recursive: true, force: true });
  }
};
