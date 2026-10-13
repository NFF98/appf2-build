# Harness Gate Matrix

| Area | Automation Level | Gate / Tool |
|---|---|---|
| Forbidden shadow SSOT directories | FULL AUTO | Harness |
| Locked baseline file/hash integrity | FULL AUTO | Harness |
| Pinned Freeze Audit commit enforcement | FULL AUTO after audit PASS | Projection Gate |
| Projection source blob / exact selector / output hash integrity | FULL AUTO | Projection Gate / Baseline Gate |
| Old baseline mutation | FULL AUTO | Harness |
| Toolchain version/config drift | FULL AUTO | Toolchain Gate |
| Acceptance ID/Test ID existence + duplicates | FULL AUTO | Harness |
| Backlog ↔ Build Spec binding | FULL AUTO | Backlog Gate |
| Sprint ↔ Build Spec binding | FULL AUTO | Sprint Gate |
| One active Task + write-path scope | FULL AUTO | Scope Gate |
| Generic Human exception lane (exact bytes/base/expiry/replay/lane scope) | FULL AUTO + HUMAN provenance check | Scope Gate + `human-exception.mjs` |
| Human approver identity / provenance | HUMAN ONLY | Human manual check (CI cannot prove a person) |
| One Task → one open PR | FULL AUTO | Governance Gate PR guard (`gpt-preflight.mjs`) |
| Draft fast loop (impacted tests, NOT full PASS) | FULL AUTO, non-required | CI `fast-loop` job |
| Full required checks on exact Final Ready HEAD | FULL AUTO after Human Ready | CI / CodeQL (Draft = NOT_READY failure) |
| Change routing (Bugfix/Evidence/Closure/Activation/Governance/Hotfix) | FULL AUTO, informational | `task-pr-lifecycle.mjs classify` |
| Final Ready / Merge approval | HUMAN ONLY | User |
| Type correctness | FULL AUTO | TypeScript |
| Static code quality | FULL AUTO | ESLint |
| Unit / contract / runtime deterministic tests | FULL AUTO | Vitest |
| Real browser E2E | FULL AUTO before release | Playwright |
| Responsive checks | FULL AUTO + human UX where material | Playwright |
| Accessibility | FULL AUTO + human UX where material | Playwright + axe |
| Dependency vulnerability | FULL AUTO | npm audit + Dependabot |
| SAST | FULL AUTO | CodeQL |
| Finding/Delta schema + references | FULL AUTO | Harness |
| Two-attempt retry ceiling | FULL AUTO | Harness |
| Visual regression | SEMI AUTO | Playwright screenshot + human materiality review |
| Implementation ↔ Build Spec semantic drift | SEMI AUTO | traceability + human semantic review |
| Product behavior choice | HUMAN ONLY | User / governance |
| DESIGN_DELTA approval | HUMAN ONLY | User |
| Freeze Audit PASS / audited version selection | HUMAN ONLY | User / Design Audit |
| Build Spec Freeze / Rebaseline | HUMAN ONLY | User |
| Material visual change | HUMAN ONLY | User |
| Public API / Data / Security / Runtime contract change | HUMAN ONLY | User |
| Sprint Activation / Sprint Close | HUMAN GATE | User / governance |
| Production Release approval | HUMAN GATE | User / governance |
