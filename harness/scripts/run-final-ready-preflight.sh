#!/usr/bin/env bash
# Cheap, fail-closed admission before full Governance/CI/CodeQL/Attack work.
set -euo pipefail
repo="${GITHUB_REPOSITORY:?missing GitHub repository}"
event="${GITHUB_EVENT_NAME:?missing GitHub event}"
ref="${GITHUB_REF:?missing GitHub ref}"
sha="${GITHUB_SHA:?missing GitHub SHA}"
event_file="${GITHUB_EVENT_PATH:?missing GitHub event payload}"
test -n "${GH_TOKEN:-}" || { echo "::error::NOT_READY — GH_TOKEN is missing"; exit 1; }
command -v gh >/dev/null || { echo "::error::NOT_READY — gh API client missing"; exit 1; }
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
case "$event" in
  pull_request)
    number="$(node -e 'const e=require(process.argv[1]);if(!Number.isSafeInteger(e?.pull_request?.number))process.exit(2);process.stdout.write(String(e.pull_request.number))' "$event_file")" || {
      echo "::error::NOT_READY — PR metadata absent"; exit 1;
    }
    gh api "repos/$repo/pulls/$number" >"$tmp/live-pr.json"
    head="$(node -e 'const p=require(process.argv[1]);if(!/^[0-9a-f]{40}$/.test(p?.head?.sha||""))process.exit(2);process.stdout.write(p.head.sha)' "$tmp/live-pr.json")" || {
      echo "::error::NOT_READY — live HEAD missing"; exit 1;
    }
    gh api "repos/$repo/issues/$number/comments?per_page=100" --paginate --slurp >"$tmp/comments.json"
    gh api "repos/$repo/commits/$head/check-runs?per_page=100" --paginate --slurp >"$tmp/check-pages.json"
    node --input-type=module -e '
      import fs from "node:fs";
      import {completeCheckRunPages} from "./harness/scripts/final-ready-preflight.mjs";
      const pages=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const inventory=completeCheckRunPages(pages);
      fs.writeFileSync(process.argv[2],JSON.stringify(inventory));
      console.log("READY Check Runs: complete GitHub pages, "+
        inventory.total_count+" unique entries");
    ' "$tmp/check-pages.json" "$tmp/checks.json"
    gh api "repos/$repo/pulls/$number/files?per_page=100" --paginate --slurp >"$tmp/changed-files.json"
    node harness/scripts/final-ready-preflight.mjs --event "$event_file" --live-pr "$tmp/live-pr.json" \
      --comments "$tmp/comments.json" --checks "$tmp/checks.json" --changed-files "$tmp/changed-files.json"
    ;;
  push)
    gh api "repos/$repo/commits/$sha/pulls?per_page=100" --paginate --slurp >"$tmp/associated-prs.json"
    node harness/scripts/final-ready-preflight.mjs --event "$event_file" --associated-prs "$tmp/associated-prs.json"
    ;;
  schedule|workflow_dispatch)
    node harness/scripts/final-ready-preflight.mjs --event "$event_file"
    ;;
  *)
    echo "::error::NOT_READY — unsupported workflow event $event on $ref"
    exit 1
    ;;
esac
