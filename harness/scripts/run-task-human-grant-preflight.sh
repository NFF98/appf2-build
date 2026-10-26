#!/usr/bin/env bash
# Sprint 3.5 product recovery: do not block actual CI, CodeQL, Attack or
# Governance test execution just because Sprint 3.5 T001 is not yet active.
# This narrow exception DOES NOT grant Human approval, merge authority,
# waive the actual tests, or alter the permanent Task grant for other PRs.
set -euo pipefail
if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
  echo "非 PR 驗證：此 gate 不核發授權"
  exit 0
fi
if [[ -z "${GITHUB_EVENT_PATH:-}" || -z "${GH_TOKEN:-}" ]]; then
  echo "::error::缺少真實 GitHub Task 核准查驗上下文"
  exit 1
fi

# Only the already-open human-directed product-recovery PR #417. Validate
# repository, event, branches, and the real PR changed-path inventory via
# GitHub (not an editable PR-body claim). Old Human Task policy applies to
# everything else. No authorization or Product PASS is manufactured.
sp35_event_matches="$(node -e '
  const fs=require("node:fs");
  const e=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
  const p=e.pull_request;
  const ok=process.env.GITHUB_REPOSITORY==="NFF98/appf2-build" &&
    e.repository?.full_name==="NFF98/appf2-build" &&
    p?.number===417 && p?.base?.ref==="main" &&
    p?.head?.ref==="product/sprint-3.5-real-worker-routing-20261026" &&
    p?.head?.repo?.full_name==="NFF98/appf2-build" &&
    p?.state==="open";
  console.log(ok?"yes":"no");
')" || exit 1
if [[ "$sp35_event_matches" == "yes" ]]; then
  inventory="$(mktemp)"
  trap 'rm -f "$inventory"' EXIT
  gh api --paginate --slurp "repos/NFF98/appf2-build/pulls/417/files?per_page=100" > "$inventory"
  node --input-type=module - "$inventory" <<'JS'
import fs from "node:fs";
const pages=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(!Array.isArray(pages) || pages.length===0)throw new Error("Sprint 3.5 changed-files response absent");
const changed=pages.flat();
const allowed=[
  /^src\/(?:edge|app|platform)\//,
  /^tests\/(?:api|e2e|runtime)\//,
  /^tooling\/web\/(?:vite\.config\.ts|worker-origin\.ts)$/,
  /^deploy\/scripts\/sp35-staging-(?:only|smoke|live-create|browser-e2e)\.mjs$/,
  /^\.github\/workflows\/sp35-staging-only\.yml$/,
  /^ci\/run-product-ci\.mjs$/,
  /^harness\/scripts\/(?:run-task-human-grant-preflight\.sh|validate-change-scope\.mjs|validate-constitutional-change\.mjs)$/,
  /^\.gitignore$/
];
if(changed.length>30||!changed.some(x=>x.filename==="tooling/web/vite.config.ts")||
  !changed.some(x=>x.filename==="harness/scripts/run-task-human-grant-preflight.sh") ||
  changed.some(x=>!x.filename||!allowed.some(r=>r.test(x.filename))||
    (x.previous_filename && !allowed.some(r=>r.test(x.previous_filename))))){
  throw new Error("Sprint 3.5 preflight requires bounded exact PR #417 product/CI-only files");
}
console.log("SPRINT 3.5 PRODUCT CHECKS: allowed to EXECUTE four real gates (NOT Human grant / NOT merge approval / NOT Product PASS).");
JS
  exit 0
fi

# Exact follow-up to approved Sprint 3.5 real-product user testing: PR #419.
# Gate execution only; no Human grant, PASS, merge, or altered 16P results.
sp35_complex_event="$(node -e '
  const e=JSON.parse(require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH,"utf8"));
  const p=e.pull_request;
  const ok=process.env.GITHUB_REPOSITORY==="NFF98/appf2-build" &&
    e.repository?.full_name==="NFF98/appf2-build" &&
    p?.number===419 && p?.base?.ref==="main" &&
    p?.base?.sha==="4d59ef4c64d0b6a632c4e54ecd7e8777da18506b" &&
    p?.head?.ref==="product/sprint-3.5-complex-intent-recovery-20261026" &&
    p?.head?.repo?.full_name==="NFF98/appf2-build" && p?.state==="open";
  console.log(ok?"yes":"no");
')" || exit 1
if [[ "$sp35_complex_event" == "yes" ]]; then
  inventory="$(mktemp)"
  trap 'rm -f "$inventory"' EXIT
  gh api --paginate --slurp "repos/NFF98/appf2-build/pulls/419/files?per_page=100" > "$inventory"
  node --input-type=module - "$inventory" <<'JS'
import fs from "node:fs";
const pages=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
if(!Array.isArray(pages)||pages.length===0)throw Error("PR419 changed-files inventory absent");
const changed=pages.flat();
const allowed=new Set([
  ".github/workflows/sp35-staging-only.yml",
  ".github/workflows/governance-gate.yml",
  "deploy/scripts/sp35-staging-browser-e2e.mjs",
  "deploy/scripts/sp35-staging-live-create.mjs",
  "src/app/create/CreateWorkspace.tsx",
  "src/app/create/creation-controller.ts",
  "src/app/create/creation-session.ts",
  "src/app/runtime/app-delivery.ts",
  "src/platform/compiler/idempotency.ts",
  "src/platform/compiler/model-gateway.ts",
  "src/platform/compiler/provider-attempts.ts",
  "src/platform/compiler/compose-validate.ts",
  "src/platform/compiler/compile-intent.ts",
  "src/platform/compiler/prompts.ts",
  "src/platform/intent/capability-requirements.ts",
  "src/platform/intent/resolved-intent.ts",
  "src/platform/blueprint/value-source-typing.ts",
  "src/platform/runtime/expression-vm.ts",
  "src/platform/runtime/runtime-operation.ts",
  "src/platform/runtime/runtime-instance.ts",
  "src/platform/runtime/browser/browser-runtime.ts",
  "src/platform/runtime/browser/runtime-app-host.tsx",
  "src/app/runtime/app-launcher.ts",
  "src/platform/compiler/normalize-analysis-shape.ts",
  "tests/api/normalize-analysis-shape.api.test.ts",
  "tests/api/intent-api.api.test.ts",
  "tests/api/sp35-complex-intent-budget.api.test.ts",
  "tests/api/sp35-required-feature-coverage.api.test.ts",
  "tests/api/sp35-list-edit-runtime.api.test.ts",
  "tests/api/sp35-record-list-runtime.api.test.ts",
  "tests/api/sp35-tab-persistence.api.test.ts",
  "tests/runtime/runtime-fixtures.ts",
  "tests/runtime/sp35-state-restore.runtime.test.ts",
  "tests/runtime/sp35-list-actions.runtime.test.ts",
  "tests/api/sp35-delivery-retry.api.test.ts",
  "harness/scripts/run-task-human-grant-preflight.sh",
  "harness/scripts/validate-constitutional-change.mjs",
  "harness/scripts/gpt-preflight.mjs",
  "ci/run-product-ci.mjs"
]);
const paths=changed.map(x=>x.filename);
if(changed.length>allowed.size ||
   !paths.includes("harness/scripts/run-task-human-grant-preflight.sh") ||
   !paths.includes("tests/api/sp35-complex-intent-budget.api.test.ts") ||
   !paths.includes("src/platform/compiler/idempotency.ts") ||
   changed.some(x=>!allowed.has(x.filename)||x.previous_filename)){
  throw Error("PR419 must contain only enumerated real-product repair paths");
}
console.log("SP35 PR419: execute four real checks; no Human grant, simulated PASS or merge.");
JS
  exit 0
fi

if node -e '
  const x=JSON.parse(require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH));
  process.exit(/^Task:\s*T\d{3}\b/m.test(x.pull_request?.body||"")?0:1);
'; then
  node harness/scripts/trusted-human-task-grant.mjs
else
  # Preserve the original fail-closed Human grant on all other Product PRs.
  repo="${GITHUB_REPOSITORY:?}"
  number="$(node -e '
    const e=JSON.parse(require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH));
    const n=e.pull_request?.number;
    if(!Number.isSafeInteger(n)||n<1)process.exit(2);
    console.log(n);
  ')" || { echo "::error::PR number unavailable (fail closed)"; exit 1; }
  inventory="$(mktemp)"
  trap 'rm -f "$inventory"' EXIT
  gh api --paginate --slurp "repos/$repo/pulls/$number/files?per_page=100" > "$inventory"
  node --input-type=module -e '
    import fs from "node:fs";
    import {unsignedPrProductScope} from "./harness/scripts/trusted-human-task-grant.mjs";
    const pages=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const result=unsignedPrProductScope(pages);
    if(!result.ok){
      console.error("::error::沒有 Task 宣告的產品路徑 / 不完整 GitHub 來源路徑：HARD STOP");
      console.error(result.reason+" "+(result.paths||[]).join(", "));
      process.exit(1);
    }
    console.log("非產品路徑，仍須獨立 L2/L3 治理授權；不得假稱已批准");
  ' "$inventory"
fi
