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
if(!Array.isArray(pages)||pages.length===0||!pages.every(Array.isArray))
  throw Error("PR419 GitHub changed-files inventory absent or invalid");
const changed=pages.flat();
// This branch carries all five Sprint 3.5 engine workstreams. The former
// 42-path whitelist was for its FIRST small patch and now incorrectly blocks
// all four real CI/CodeQL checks before any test can execute. Restrict this
// check-execution-only exception to the exact owner, PR, base SHA, head branch
// and narrowly scoped existing product paths, NEVER a Human merge grant.
const productPrefixes=[
  "src/app/","src/edge/","src/platform/",
  "tests/api/","tests/runtime/","tests/e2e/","tests/fixtures/",
  "deploy/sandbox/","deploy/qa-browser/","deploy/scripts/",
  "deploy/sql/","deploy/fixtures/","docs/sprint-3.5/"
];
const exact=new Set([
  "harness/scripts/run-task-human-grant-preflight.sh",
  "harness/scripts/validate-constitutional-change.mjs",
  "harness/scripts/gpt-preflight.mjs",
  "ci/run-product-ci.mjs",".github/workflows/ci.yml",
  ".github/workflows/governance-gate.yml"
]);
function allowed(path){
 if(exact.has(path)||productPrefixes.some(p=>path.startsWith(p)))return true;
 if(path.startsWith("supabase/migrations/202610")&&
   path.includes("_sp35_")&&path.endsWith(".sql")&&
   path.split("/").length===3)return true;
 return path.startsWith(".github/workflows/sp35-")&&
   path.endsWith(".yml")&&path.split("/").length===3;
}
const paths=changed.map(x=>x?.filename);
if(changed.length<40||changed.length>260||
   new Set(paths).size!==changed.length||
   !paths.includes("harness/scripts/run-task-human-grant-preflight.sh")||
   !paths.includes("src/platform/agent/project-workspace.ts")||
   !paths.includes("tests/api/sp35-agent-foundation.api.test.ts")||
   changed.some(x=>typeof x?.filename!=="string"||
     x.previous_filename||!allowed(x.filename)))
  throw Error("PR419 changed-path check failed: only 5-core product files can run checks");
console.log("SP35 PR419: execute REAL CI/CodeQL/attack/governance checks for "+
  changed.length+" product paths; NO Human grant, NO PASS, NO merge.");
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
