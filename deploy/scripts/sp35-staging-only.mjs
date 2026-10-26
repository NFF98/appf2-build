// Sprint 3.5: dedicated staging-only Worker + SPA deployment.
// Never uses releases/CURRENT.json, production target, or a production tag.
// All secrets are passed to Wrangler as an ephemeral file and removed even on failure.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const required = (name) => {
  const value = process.env[name];
  if (!value?.trim()) throw new Error("STAGING PRECHECK: missing " + name);
  return value.trim();
};
// Bootstrap only proves same-origin browser/Worker transport. It intentionally
// has NO AI model and NO PostgreSQL/Hyperdrive bindings. The real signed
// Creation flow remains unavailable until all staging bindings are present.
const bootstrapOnly = process.env.APPF2_STAGING_BOOTSTRAP_ONLY === "1";
const name = process.env.APPF2_STAGING_WORKER_NAME?.trim() || "appf2-sp35-417-staging";
if (!/^[a-z0-9-]*staging[a-z0-9-]*$/.test(name)) {
  throw new Error("STAGING PRECHECK: Worker name must contain 'staging', never production");
}
if (bootstrapOnly && name !== "appf2-sp35-417-staging") {
  throw new Error("STAGING BOOTSTRAP: fixed isolated worker name required");
}
const IDs = [
  ["HYPERDRIVE_FRESH", "APPF2_HYPERDRIVE_FRESH_ID"],
  ["HYPERDRIVE_F02_ADMISSION", "APPF2_HYPERDRIVE_F02_ADMISSION_ID"],
  ["HYPERDRIVE_F07_EVENTS", "APPF2_HYPERDRIVE_F07_EVENTS_ID"]
];
const hyperdrive = bootstrapOnly ? [] : IDs.map(([binding, env]) => ({ binding, id: required(env) }));
const modelBase = bootstrapOnly ? null : new URL(required("APPF2_MODEL_BASE_URL"));
if (modelBase && (modelBase.username || modelBase.password))
  throw new Error("STAGING PRECHECK: model URL cannot include credentials");
if (modelBase && modelBase.protocol !== "https:")
  throw new Error("STAGING PRECHECK: model URL must be HTTPS");
const model = bootstrapOnly ? null : required("APPF2_MODEL_NAME");
const token = required("CLOUDFLARE_API_TOKEN");
const account = required("CLOUDFLARE_ACCOUNT_ID");
const modelSecret = bootstrapOnly ? null : required("APPF2_MODEL_API_KEY");
const cookieSecret = bootstrapOnly ? randomBytes(48).toString("base64url") : required("APPF2_IDENTITY_COOKIE_SECRET");
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
  ...(bootstrapOnly ? {} : {hyperdrive}),
  ...(bootstrapOnly ? {} : {vars: {
    APPF2_MODEL_BASE_URL: modelBase.toString(),
    APPF2_MODEL_NAME: model
  }})
};
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(secretsPath, JSON.stringify({
    ...(bootstrapOnly ? {} : {APPF2_MODEL_API_KEY: modelSecret}),
    APPF2_IDENTITY_COOKIE_SECRET: cookieSecret
  }), { flag: "wx", mode: 0o600 });
  const r = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "wrangler@4.135.0", "deploy", "--config", path.basename(configPath), "--secrets-file", path.basename(secretsPath)],
    { stdio: "pipe", encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account },
      shell: process.platform === "win32" }
  );
  const redact = value => String(value || "")
    .replaceAll(token, "[REDACTED]").replaceAll(cookieSecret, "[REDACTED]")
    .replaceAll(modelSecret || "[NO_MODEL_SECRET]", "[REDACTED]");
  process.stdout.write(redact(r.stdout));
  process.stderr.write(redact(r.stderr));
  if (r.status !== 0) throw new Error("STAGING DEPLOY: Wrangler failed (exit " + r.status + ")");
  const output = String(r.stdout || "") + "\\n" + String(r.stderr || "");
  const urls = output.match(/https:\\/\\/[a-z0-9.-]+\\.workers\\.dev\\/?/gi) || [];
  const url = urls.map(s => new URL(s)).find(u => u.hostname.startsWith(name + "."));
  if (!url) throw new Error("STAGING DEPLOY: Wrangler reported success but no verifiable workers.dev URL");
  if (process.env.GITHUB_ENV)
    fs.appendFileSync(process.env.GITHUB_ENV, "APPF2_STAGING_URL=" + url.origin + "\\n");
  console.log("STAGING URL: " + url.origin);
  console.log(bootstrapOnly
    ? "STAGING FIRST-HOP ONLY: real Worker + SPA; AI/Postgres/Creation NOT CONFIGURED"
    : "STAGING DEPLOY: real bindings submitted; LIVE AI/PG E2E NOT VERIFIED");
} finally {
  for (const p of [secretsPath, configPath]) {
    try { fs.rmSync(p, { force: true }); } catch { /* do not mask deployment error */ }
  }
}
