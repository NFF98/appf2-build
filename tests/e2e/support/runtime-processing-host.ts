import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { build, createServer as createViteServer } from "vite";

import type * as RuntimeOperationFixtures from "../../runtime/runtime-operation-fixtures.js";

const HOST = "127.0.0.1";
const HARNESS_ROOT = fileURLToPath(new URL("./runtime-processing-harness/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES_MODULE = "/tests/runtime/runtime-operation-fixtures.ts";
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

export type RuntimeProcessingHarness = {
  readonly url: string;
  /** The real F03 Runtime fixtures (Runtime Instance, admission, trusted handlers) for the Node side. */
  readonly runtime: typeof RuntimeOperationFixtures;
  close(): Promise<void>;
};

/**
 * Loads the Node-side F03 fixtures through Vite's SSR module loader: the platform modules import JSON the way
 * the Vite / Vitest toolchain resolves it, which the Playwright Node loader does not.
 */
async function loadRuntimeFixtures(): Promise<{ readonly fixtures: typeof RuntimeOperationFixtures; close(): Promise<void> }> {
  const server = await createViteServer({ root: REPO_ROOT, configFile: false, logLevel: "error", appType: "custom", server: { middlewareMode: true, hmr: false, ws: false } });
  const fixtures = (await server.ssrLoadModule(FIXTURES_MODULE)) as typeof RuntimeOperationFixtures;
  return { fixtures, close: () => server.close() };
}

async function serveFile(outDir: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const { pathname } = new URL(request.url ?? "/", `http://${HOST}`);
  const file = resolve(outDir, `.${pathname === "/" ? "/index.html" : decodeURIComponent(pathname)}`);
  if (!file.startsWith(outDir + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

/**
 * Builds the test-only harness page with the production Vite toolchain (no config file, no aliases) and serves
 * the static output on an ephemeral loopback port so parallel Playwright workers never collide.
 */
export async function startRuntimeProcessingHarness(): Promise<RuntimeProcessingHarness> {
  const outDir = resolve(await mkdtemp(join(tmpdir(), "appf2-f00-runtime-harness-")));
  await build({ root: HARNESS_ROOT, configFile: false, logLevel: "error", base: "./", build: { outDir, emptyOutDir: true } });
  const server = createServer((request, response) => {
    void serveFile(outDir, request, response);
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolveListen);
  });
  const { port } = server.address() as AddressInfo;
  const loader = await loadRuntimeFixtures();
  return {
    url: `http://${HOST}:${port}/`,
    runtime: loader.fixtures,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
      await loader.close();
      await rm(outDir, { recursive: true, force: true });
    }
  };
}
