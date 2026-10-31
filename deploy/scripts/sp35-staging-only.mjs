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
// Authorized FREE-ONLY staging deployment keeps DB/Agent routes without
// enabling billable AI credentials or any Cloudflare Browser Run entitlement.
const noNewAi=process.env.APPF2_STAGING_FREE_ONLY_NO_AI==="1";
const modelSecret = bootstrapOnly ? null :
 (noNewAi ? "APPF2_SP35_FREE_ONLY_AI_DISABLED" : required("APPF2_MODEL_API_KEY"));
// Agent uses an independent signed paid-operation permission even if an
// operator explicitly selects an existing OpenAI staging credential.
const dedicatedAgentKey = bootstrapOnly ? "" :
 (process.env.APPF2_OPENAI_AGENT_API_KEY?.trim() || "");
const sharedStagingOpenai = !bootstrapOnly && !noNewAi &&
 process.env.APPF2_STAGING_AGENT_REUSE_OPENAI_KEY === "1" &&
 (process.env.APPF2_MODEL_PROVIDER?.trim().toLowerCase() || "openai") === "openai";
const agentKey = dedicatedAgentKey ||
 (sharedStagingOpenai ? modelSecret : "");
const agentEnabled = !bootstrapOnly;
const agentModelEnabled = !noNewAi && agentEnabled && agentKey.length >= 16 &&
  process.env.APPF2_STAGING_AGENT_MODEL_ENABLED === "1";
const agentPrivateToken = process.env.APPF2_SANDBOX_BROKER_TOKEN?.trim() || "";
const agentJobScope = process.env.APPF2_SANDBOX_ALLOWED_JOB_ID?.trim() || "";
const agentQaToken = process.env.APPF2_QA_PRIVATE_TOKEN?.trim() || "";
const agentQaVerifier = process.env.APPF2_AGENT_QA_VERIFIER_SECRET?.trim() || "";
// Never deploy a binding to a nonexistent Worker just because an API key exists.
// Both private Workers must first be provisioned through a separately approved
// cloud deployment. These are staging-only, explicit protected opt-ins.
// Human cost decision 2026-10-31: never provision paid private Workers
// even if an old repository secret/variable still requests that opt-in.
if(process.env.APPF2_STAGING_AGENT_PRIVATE_SERVICES_ENABLED==="1")
 throw Error("SP35_FREE_ONLY_PAID_PRIVATE_SERVICES_FORBIDDEN");
const privateServices = false;
if(privateServices && (agentPrivateToken.length < 32 ||
  !/^(?:OWNER_SCOPED_JOBS|[0-9a-f-]{36})$/i.test(agentJobScope) ||
  agentQaToken.length < 32 || agentQaVerifier.length < 32))
  throw Error("STAGING AGENT: incomplete private Sandbox / Browser QA binding secrets");
console.log("STAGING AGENT: candidate="+(agentEnabled?"ENABLED":"DISABLED")+
  " model="+(agentModelEnabled?"KEY_PRESENT_BUT_DISABLED_FREE_ONLY":"DISABLED")+
  " private_services="+(privateServices?"CONFIGURED":"NOT_DEPLOYED"));
const provider = process.env.APPF2_MODEL_PROVIDER?.trim().toLowerCase() || "openai";
if (!["openai", "xai", "deepseek"].includes(provider)) {
  throw new Error("STAGING PRECHECK: invalid APPF2_MODEL_PROVIDER");
}
const xaiKey = bootstrapOnly ? null : process.env.APPF2_XAI_API_KEY?.trim();
const deepseekKey = bootstrapOnly ? null : process.env.APPF2_DEEPSEEK_API_KEY?.trim();
// The Sprint 3.5 owner explicitly consented to xAI as a staging-only 429 backup.
// Auto-select only when BOTH the private key and model name actually exist;
// no secret, no model, non-OpenAI primary, or bootstrap => no transfer.
// A nonempty APPF2_MODEL_FALLBACK_PROVIDER remains the explicit override.
const requestedFallback = process.env.APPF2_MODEL_FALLBACK_PROVIDER?.trim().toLowerCase() || "";
const consentedStagingXai = process.env.APPF2_STAGING_XAI_ON_429 === "1";
const canUseStagingXai = !bootstrapOnly && provider === "openai" &&
  Boolean(xaiKey && process.env.APPF2_XAI_MODEL_NAME?.trim());
const fallback = requestedFallback || (consentedStagingXai && canUseStagingXai ? "xai" : "");
if (!bootstrapOnly) {
  console.log("STAGING FALLBACK: " + (fallback
    ? fallback.toUpperCase() + "_ON_429_CONFIGURED"
    : consentedStagingXai ? "XAI_NOT_CONFIGURED_PRIMARY_ONLY" : "DISABLED"));
}
if (fallback && !["xai", "deepseek"].includes(fallback))
  throw new Error("STAGING PRECHECK: invalid APPF2_MODEL_FALLBACK_PROVIDER");
if (fallback && fallback === provider)
  throw new Error("STAGING PRECHECK: fallback must differ from primary");
if (!bootstrapOnly && fallback === "xai" && (!xaiKey || !process.env.APPF2_XAI_MODEL_NAME?.trim()))
  throw new Error("STAGING PRECHECK: missing configured xAI fallback");
if (!bootstrapOnly && fallback === "deepseek" && (!deepseekKey || !process.env.APPF2_DEEPSEEK_MODEL_NAME?.trim()))
  throw new Error("STAGING PRECHECK: missing configured DeepSeek fallback");
if (!bootstrapOnly && provider === "xai" && !xaiKey) throw new Error("STAGING PRECHECK: missing APPF2_XAI_API_KEY");
if (!bootstrapOnly && provider === "deepseek" && !deepseekKey) throw new Error("STAGING PRECHECK: missing APPF2_DEEPSEEK_API_KEY");
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
  ...(bootstrapOnly ? {} : {hyperdrive,...(noNewAi?{}:{browser:{binding:"APPF2_QA_BROWSER"}})}),
  ...(privateServices ? {services:[
    {binding:"APPF2_SANDBOX_BROKER_SERVICE",service:"appf2-sp35-private-sandbox"},
    {binding:"APPF2_QA_BROWSER_SERVICE",service:"appf2-sp35-private-browser-qa"}
  ]} : {}),
  ...(bootstrapOnly ? {} : {vars: {
    APPF2_MODEL_BASE_URL: modelBase.toString(),
    APPF2_MODEL_NAME: model,
    APPF2_MODEL_PROVIDER: provider,
    // Candidate creation and signed Postgres read are free and only available
    // when real staging DB bindings exist. All paid capabilities stay separate.
    APPF2_AGENT_CANDIDATE_ENABLED: agentEnabled ? "1" : "0",
    APPF2_AGENT_FREE_ONLY: "1",
    // Do not bill the new multi-file Agent before isolated build/QA
    // services are configured. Legacy single-file model flow unchanged.
    APPF2_AGENT_MODEL_EXECUTION_ENABLED: "0",
    APPF2_AGENT_SANDBOX_EXECUTION_ENABLED: "0",
    APPF2_AGENT_AUTOSTEP_ENABLED: "0",
    APPF2_AGENT_QA_BROWSER_ENABLED: "0",
    APPF2_AGENT_QA_REVIEW_ENABLED: "0",
    ...(privateServices ? {APPF2_SANDBOX_ALLOWED_JOB_ID:agentJobScope} : {}),
    // Cost guard for staging only. Production keeps its own unchanged settings.
    APPF2_MODEL_OUTPUT_CAP_ANALYSIS: "6000",
    APPF2_MODEL_OUTPUT_CAP_BLUEPRINT: "16000",
    ...(fallback ? {APPF2_MODEL_FALLBACK_PROVIDER: fallback} : {}),
    ...(process.env.APPF2_XAI_MODEL_NAME?.trim() ? {APPF2_XAI_MODEL_NAME: process.env.APPF2_XAI_MODEL_NAME.trim()} : {}),
    ...(process.env.APPF2_DEEPSEEK_MODEL_NAME?.trim() ? {APPF2_DEEPSEEK_MODEL_NAME: process.env.APPF2_DEEPSEEK_MODEL_NAME.trim()} : {})
  }})
};
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  fs.writeFileSync(secretsPath, JSON.stringify({
    ...(bootstrapOnly ? {} : {APPF2_MODEL_API_KEY: modelSecret}),
    ...(agentModelEnabled ? {APPF2_OPENAI_AGENT_API_KEY:agentKey} : {}),
    ...(privateServices ? {APPF2_SANDBOX_BROKER_TOKEN:agentPrivateToken,
      APPF2_QA_PRIVATE_TOKEN:agentQaToken,
      APPF2_AGENT_QA_VERIFIER_SECRET:agentQaVerifier} : {}),
    ...(xaiKey ? {APPF2_XAI_API_KEY: xaiKey} : {}),
    ...(deepseekKey ? {APPF2_DEEPSEEK_API_KEY: deepseekKey} : {}),
    // Free CI GitHub Actions token is optional, private and never part of a
    // bundled SPA/Worker var. The branch workflow can dispatch ONLY when set.
    ...(process.env.APPF2_FREE_CI_GITHUB_TOKEN?.trim() ?
      {APPF2_FREE_CI_GITHUB_TOKEN:process.env.APPF2_FREE_CI_GITHUB_TOKEN.trim()} : {}),
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
    .replaceAll(modelSecret || "[NO_MODEL_SECRET]", "[REDACTED]")
    .replaceAll(agentKey || "[NO_AGENT_KEY]", "[REDACTED]")
    .replaceAll(agentPrivateToken || "[NO_AGENT_BROKER_TOKEN]", "[REDACTED]")
    .replaceAll(agentQaToken || "[NO_AGENT_QA_TOKEN]", "[REDACTED]")
    .replaceAll(agentQaVerifier || "[NO_AGENT_QA_VERIFIER]", "[REDACTED]")
    .replaceAll(xaiKey || "[NO_XAI_SECRET]", "[REDACTED]")
    .replaceAll(deepseekKey || "[NO_DEEPSEEK_SECRET]", "[REDACTED]");
  process.stdout.write(redact(r.stdout));
  process.stderr.write(redact(r.stderr));
  if (r.status !== 0) throw new Error("STAGING DEPLOY: Wrangler failed (exit " + r.status + ")");
  const output = String(r.stdout || "") + "\n" + String(r.stderr || "");
  const urls = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\/?/gi) || [];
  const url = urls.map(s => new URL(s)).find(u => u.hostname.startsWith(name + "."));
  if (!url) throw new Error("STAGING DEPLOY: Wrangler reported success but no verifiable workers.dev URL");
  if (process.env.GITHUB_ENV)
    fs.appendFileSync(process.env.GITHUB_ENV, "APPF2_STAGING_URL=" + url.origin + "\n");
  console.log("STAGING FREE CI DISPATCH: "+(
    process.env.APPF2_FREE_CI_GITHUB_TOKEN?.trim()?
      "GITHUB_CREDENTIAL_CONFIGURED_NOT_TESTED":"GITHUB_CREDENTIAL_NOT_CONFIGURED"));
  console.log("STAGING URL: " + url.origin);
  console.log(bootstrapOnly
    ? "STAGING FIRST-HOP ONLY: real Worker + SPA; AI/Postgres/Creation NOT CONFIGURED"
    : "STAGING DEPLOY: real bindings submitted; LIVE AI/PG E2E NOT VERIFIED");
} finally {
  for (const p of [secretsPath, configPath]) {
    try { fs.rmSync(p, { force: true }); } catch { /* do not mask deployment error */ }
  }
}
