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
  echo "非 L1 Task PR：使用原本的 L2/L3 Human 治理授權鏈，不宣稱已有 Task Grant"
fi
