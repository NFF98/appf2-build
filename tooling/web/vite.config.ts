import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

const repoRoot=resolve(dirname(fileURLToPath(import.meta.url)),"../..");

export default defineConfig({
  root: resolve(repoRoot,"src/app"),
  build: {
    outDir: resolve(repoRoot,"dist/web"),
    emptyOutDir: true
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true
  }
});
