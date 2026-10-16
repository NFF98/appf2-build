#!/usr/bin/env bash
# Fail-closed FIRST step before real full CI/CodeQL/Attack/Governance for L1 Task PRs.
# Only real GitHub Environment approval may authorize expensive final validation.
set -euo pipefail
if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
  echo "非 PR 驗證：此 gate 不核發授權"
  exit 0
fi
if [[ -z "${GITHUB_EVENT_PATH:-}" || -z "${GH_TOKEN:-}" ]]; then
  echo "::error::缺少真實 GitHub Task 核准查驗上下文"
  exit 1
fi
if node -e '
  const x=JSON.parse(require("node:fs").readFileSync(process.env.GITHUB_EVENT_PATH));
  process.exit(/^Task:\s*T\d{3}\b/m.test(x.pull_request?.body||"")?0:1);
'; then
  node harness/scripts/trusted-human-task-grant.mjs
else
  # Do not allow a product PR to avoid the one-Human grant merely by
  # deleting "Task: Txxx" from its PR body. Inspect REAL GitHub changed files.
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
  node -e '
    const pages=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));
    if(!Array.isArray(pages)||!pages.length||!pages.every(Array.isArray)){
      console.error("::error::GitHub changed-file inventory unavailable");process.exit(1);
    }
    const files=pages.flat();
    if(!files.length||files.some(f=>typeof f.filename!=="string")){
      console.error("::error::GitHub PR changed-file inventory empty or malformed");process.exit(1);
    }
    const product=files.filter(f=>/^(?:src\/|tests\/|supabase\/|generated\/)/.test(f.filename));
    if(product.length){
      console.error("::error::產品/測試變更沒有 Task 宣告及可信 Human grant：HARD STOP");
      console.error(product.map(f=>f.filename).join(", "));
      process.exit(1);
    }
    console.log("非產品路徑，仍須獨立 L2/L3 治理授權；不得假稱已批准");
  ' "$inventory"
fi
