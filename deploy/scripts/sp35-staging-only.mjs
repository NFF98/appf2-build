// Sprint 3.5: dedicated staging-only Worker + SPA deployment.
// Never uses releases/CURRENT.json, production target, or a production tag.
// All secrets are passed to Wrangler as an ephemeral file and removed even on failure.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const required = (name) => {
  const value = process.env[name];
  if (!value?.trim()) throw new Error("STAGING PRECHECK: missing " + name);
  return value.trim();
};
const name = required("APPF2_STAGING_WORKER_NAME");
if (!/^[a-z0-9-]*staging[a-z0-9-]*$/.test(name)) {
  throw new Error("STAGING PRECHECK: Worker name must contain 'staging', never production");
}
const IDs = [
  ["HYPERDRIVE_FRESH", "APPF2_HYPERDRIVE_FRESH_ID"],
  ["HYPERDRIVE_F02_ADMISSION", "APPF2_HYPERDRIVE_F02_ADMISSION_ID"],
  ["HYPERDRIVE_F07_EVENTS", "APPF2_HYPERDRIVE_F07_EVENTS_ID"]
];
const hyperdrive = IDs.map(([binding, env]) => ({ binding, id: required(env) }));
const modelBase = new URL(required("APPF2_MODEL_BASE_URL"));
if (modelBase.protocol !== "https:") throw new Error("STAGING PRECHECK: model URL must be HTTPS");
const model = required("APPF2_MODEL_NAME");
const token = required("CLOUDFLARE_API_TOKEN");
const account = required("CLOUDFLARE_ACCOUNT_ID");
const modelSecret = required("APPF2_MODEL_API_KEY");
const cookieSecret = required("APPF2_IDENTITY_COOKIE_SECRET");
if (cookieSecret.length < 32) throw new Error("STAGING PRECHECK: identity secret too short");
if (!fs.existsSync(path.join(process.cwd(), "dist/web/index.html"))) {
  throw new Error("STAGING PRECHECK: run npm run web:build first");
}
const configPath = path.join(process.cwd(), ".sp35-staging.wrangler.json");
const secretsPath = path.join(process.cwd(), ".sp35-staging.secrets.json");
if (fs.existsSync(configPath) || fs.existsSync(secretsPath)) {
  throw new Error("STAGING PRECHECK: temporary config/secret file already exists, refusing to overwrite");
}
const config = {
  name,
  main: "src/edge/worker-entry.ts",
  compatibility_date: "2026-10-20",
  compatibility_flags: ["nodejs_compat"],
  workers_dev: true,
  assets: {
    directory: "./dist/web",
    binding: "ASSETS",
    not_found_handling: "single-page-application",
    run_worker_first: ["/api/v1/*", "/b/*"]
  },
  hyperdrive,
  vars: {
    APPF2_MODEL_BASE_URL: modelBase.toString(),
    APPF2_MODEL_NAME: model
  }
};
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(secretsPath, JSON.stringify({
    APPF2_MODEL_API_KEY: modelSecret,
    APPF2_IDENTITY_COOKIE_SECRET: cookieSecret
  }), { flag: "wx", mode: 0o600 });
  const r = spawnSync(
    "npx",
    ["--yes", "wrangler@4.135.0", "deploy", "--config", path.basename(configPath), "--secrets-file", path.basename(secretsPath)],
    { stdio: "inherit", env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account }, shell: false }
  );
  if (r.status !== 0) throw new Error("STAGING DEPLOY: Wrangler failed (exit " + r.status + ")");
  console.log("STAGING DEPLOY: command succeeded; LIVE AI/PG E2E NOT VERIFIED");
} finally {
  for (const p of [secretsPath, configPath]) {
    try { fs.rmSync(p, { force: true }); } catch { /* do not mask deployment error */ }
  }
}
