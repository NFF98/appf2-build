import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin, type ProxyOptions } from "vite";

import { parseWorkerOrigin } from "./worker-origin.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workerOrigin = parseWorkerOrigin(process.env.APPF2_STAGING_WORKER_ORIGIN);

// The local browser retains a same-origin /api/v1 URL. The proxy, not Browser,
// translates that request to a deployed Worker; no Cloudflare/AI/DB secret enters
// client code. Origin must match the upstream host for the Worker's same-origin
// mutation guard. We do not disable that guard.
const apiProxy = workerOrigin
  ? ({
      "/api/v1": {
        target: workerOrigin,
        changeOrigin: true,
        secure: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", workerOrigin);
          });
        }
      }
    } satisfies Record<string, ProxyOptions>)
  : undefined;

// Missing configuration must be a truthful JSON 503, never Vite HTML/404
// mistaken for a response from the real Cloudflare Worker.
const missingWorkerOrigin: Plugin = {
  name: "appf2-missing-staging-worker-origin",
  configureServer(server) {
    if (workerOrigin) return;
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/v1/")) return next();
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: { code: "STAGING_WORKER_ORIGIN_NOT_CONFIGURED" } }));
    });
  },
  configurePreviewServer(server) {
    if (workerOrigin) return;
    server.middlewares.use((req, res, next) => {
      if (!req.url?.startsWith("/api/v1/")) return next();
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify({ error: { code: "STAGING_WORKER_ORIGIN_NOT_CONFIGURED" } }));
    });
  }
};

export default defineConfig({
  root: resolve(repoRoot, "src/app"),
  plugins: [missingWorkerOrigin],
  build: {
    outDir: resolve(repoRoot, "dist/web"),
    emptyOutDir: true
  },
  server: {
    proxy: apiProxy
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: apiProxy
  }
});
