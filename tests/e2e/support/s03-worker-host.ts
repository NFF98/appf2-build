import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page, Route } from "@playwright/test";
import { build, createServer as createViteServer, type ViteDevServer } from "vite";

import type * as S03BackendModule from "../../api/s03-worker-backend.js";

/** Secure origin the product build is served from; every other origin is blocked (network / LLM isolation). */
export const APP_ORIGIN = "https://appf2.test";

const APP_ROOT = fileURLToPath(new URL("../../../src/app/", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BACKEND_MODULE = "/tests/api/s03-worker-backend.ts";
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

export type HostedCall = { readonly method: string; readonly path: string; readonly status: number; readonly body: string };

type Backend = ReturnType<typeof S03BackendModule.createS03Backend>;

interface SharedBuild {
  readonly outDir: string;
  readonly vite: ViteDevServer;
  readonly module: typeof S03BackendModule;
}

let shared: Promise<SharedBuild> | null = null;

async function buildOnce(): Promise<SharedBuild> {
  const outDir = resolve(await mkdtemp(join(tmpdir(), "appf2-s03-app-")));
  await build({ root: APP_ROOT, configFile: false, logLevel: "error", base: "/", build: { outDir, emptyOutDir: true } });
  const vite = await createViteServer({
    root: REPO_ROOT,
    configFile: false,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false }
  });
  return { outDir, vite, module: (await vite.ssrLoadModule(BACKEND_MODULE)) as typeof S03BackendModule };
}

/**
 * The production `src/app` build (Vite, no test entry) plus the production Worker fetch handler. Browser traffic to
 * {@link APP_ORIGIN} is fulfilled in-process: `/api/*` and `/b/*` go to `createWorkerFetch`, everything else is the
 * static build. Requests to any other origin are aborted and recorded. One fresh backend per host.
 */
export class S03WorkerHost {
  public readonly calls: HostedCall[] = [];
  public readonly blocked: string[] = [];

  private constructor(
    private readonly outDir: string,
    public readonly backend: Backend,
    public readonly provenance: string
  ) {}

  public static async start(): Promise<S03WorkerHost> {
    shared ??= buildOnce();
    const { outDir, module } = await shared;
    return new S03WorkerHost(outDir, module.createS03Backend(), module.S03_BACKEND_PROVENANCE);
  }

  /** Releases the shared build; call once from `afterAll`. */
  public static async shutdown(): Promise<void> {
    const current = shared;
    shared = null;
    if (current === null) return;
    const { outDir, vite } = await current;
    await vite.close();
    await rm(outDir, { recursive: true, force: true });
  }

  public async attach(page: Page): Promise<void> {
    await page.route("**/*", (route) => this.serve(route));
  }

  public apiCalls(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path} ${call.status}`);
  }

  private async serve(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    if (url.origin !== APP_ORIGIN) {
      this.blocked.push(url.href);
      return route.abort("blockedbyclient");
    }
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/b/")) return this.forward(route, url);
    return fulfillStatic(route, this.outDir, url);
  }

  private async forward(route: Route, url: URL): Promise<void> {
    const request = route.request();
    const headers = new Headers(Object.entries(await request.allHeaders()).filter(([name]) => !name.startsWith(":")));
    // Interception can run before the browser network stack attaches Fetch Metadata and the cookie jar (Chromium /
    // WebKit); restore only what that stack itself would send for this exact URL.
    if (!headers.has("sec-fetch-site") && new URL(request.frame().url()).origin === APP_ORIGIN) headers.set("sec-fetch-site", "same-origin");
    if (!headers.has("cookie")) {
      const jar = await request.frame().page().context().cookies(url.href);
      if (jar.length > 0) headers.set("cookie", jar.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
    }
    const body = request.postDataBuffer();
    const response = await this.backend.handle(
      new Request(url.href, { method: request.method(), headers, ...(body === null ? {} : { body: new Uint8Array(body) }) })
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    this.calls.push({ method: request.method(), path: url.pathname, status: response.status, body: bytes.toString("utf8") });
    await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: bytes });
  }
}

/** Serves a Vite build output; extension-less paths are the SPA entry. */
export async function fulfillStatic(route: Route, outDir: string, url: URL): Promise<void> {
  const relative = extname(url.pathname) === "" ? "/index.html" : decodeURIComponent(url.pathname);
  const file = resolve(outDir, `.${relative}`);
  if (!file.startsWith(outDir + sep)) return route.fulfill({ status: 403, body: "" });
  try {
    const body = await readFile(file);
    await route.fulfill({ status: 200, headers: { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" }, body });
  } catch {
    await route.fulfill({ status: 404, body: "" });
  }
}
