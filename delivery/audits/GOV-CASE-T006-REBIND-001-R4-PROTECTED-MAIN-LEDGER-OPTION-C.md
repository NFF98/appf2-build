# GOV-CASE-T006-REBIND-001 / R4 — Trusted ledger breakthrough: protected-main anchor (review-only)

**Classification:** R3 Human Option C isolated review only. **Not a change to `main`, a Human R4/R5 approval, a production authorization, or T006 execution.**

## Grounded GitHub authority — exact live ruleset inspected 2026-10-11

Repository: `NFF98/appf2-build`; canonical main `7bf5c9466e681719463560c2676ccb82ab097f0e`.
GitHub Ruleset **NFF Build**, id `23969502`, `enforcement=active`, ref include `~DEFAULT_BRANCH`, bypass actors **[]**. Rules: **deletion prohibited; non_fast_forward prohibited; pull_request required; strict_required_status_checks_policy=true** with contexts `ci`, `attack`, `governance`, `Analyze JavaScript / TypeScript`, integration ID `15368`. Permitted merge method `squash`.

**Caveat:** `required_approving_review_count=0`, `require_code_owner_review=false`, `require_last_push_approval=false`. This is not a Human authentication source, and even four green required checks cannot replace independent Human Ed25519 approval + explicit Human merge consent. Rulesets can be reconfigured; a future Gate must re-read live ruleset before a closure and fail closed on drift.

## Concrete replacement candidate for the missing external immutable CAS database

**Use canonical protected `main` commit ancestry as the externally hosted, durable, append-only anchor for signed Revalidation proof ledger entries.** Do NOT write a standalone unprotected mutable JSON ledger with a pretend CAS callback.

The ledger is data in `delivery/audits/` or other **Human-approved exact governed record path**. Its `root` is bound to the actual GitHub-protected main commit and the verified ledger SHA-256 chain; the next state is validated against an authenticated exact base SHA from GitHub before merge. One fresh round proof is appended at a time; previous entries and legacy CLOSED T001/T007 state cannot be edited, removed, re-ordered or replayed.

A successfully merged new ledger commit is an externally anchored root, subject to the existing GitHub branch protection: no direct write, no force push, no deletion, an up-to-date required CI before squash merge. Competing PRs created from stale main must rebase, re-run all checks, and revalidate the old/current ledger head; **avoid calling GitHub PR merge a literal `git update-ref` CAS API**. Strongest available correctness depends on server-side strict check enforcement plus independently verified exact SHA at merge. It remains essential to prohibit a status-only or author-only proof.

### Real local Git CAS proof (separate temporary repository only)

Ran `git update-ref refs/heads/main <writerA> <base>` followed by stale competing `git update-ref ... <writerB> <same old base>` on different commits sharing a base: first succeeds; second rejected. Independently confirmed `git merge-base --is-ancestor <base> <new main>` success and incompatible writer not ancestor.

Actual evidence digest `SHA256=8f817e52e39f1cb0d233b9bb4228095b4c13dec5d23795c589807516d26b70c7`; **five verified local Git assertions**. This **does not** prove GitHub's merge endpoint is `git update-ref` or that a new canonical ledger path currently enjoys configured branch protection. GitHub currently protects `main`; the protected-boundary ledger must be validated **at the actual merge**.

## Sequenced implementation / proof with no fabricated PASS

1. **PR-A: trust-root bootstrap only.** On independent Human R4 then R5, exact protected diff/digest, clean independent CI/BCE, separate Human merge approval: install pinned `main`-only `.github/workflows/revalidation-trust-bootstrap.yml` and read-only trust/verifier modules. `TRUST_BOOTSTRAP_ONLY`, `product_ci_mode=NOT_EXECUTED`, zero Acceptance/Tests, `eligible_for_closure=false`. Any approved PR-A changes to `harness/`, `.github/`, `ci/` must be separately enumerated and signed.
2. **Post-PR-A main push:** obtain first **real GitHub Native Attestation**, verify against independent `gh attestation verify` and authenticated main-push Run/Job metadata. This proves the trust-root *pipeline*, not any Product acceptance.
3. **Authorized Task proof:** after separately approved BS025 activation/rebind and Human Cursor execution, run the *real named Test ID(s)* on protected main and produce an independently verified `EXECUTED` artifact bound to source commit, run attempt, Task, Sprint, baseline, Registry digest, Acceptance/Test pair(s), workflow digest and proof subject digest.
4. **PR-B: append-only closure.** Submit signed proof reference and exact new ledger entry in a separate PR; CI verifies prior ledger at authenticated base/main, prev-head SHA and immutable prior entries, no duplicate identity, Git ancestry, task-owner, Human signature, authentic signer workflow/run/subject, and **all** mapped executable tests and required commands. Only independent Human merge may commit the transition; each Gate reads the same trusted anchored ledger **without consuming replay tokens**.
5. **On concurrent updates:** strict status checks + fresh authenticated base SHA and non-fast-forward/PR rules reject stale closures until revalidation. If ruleset altered, read blocked, signature missing, proof missing, or source SHA no longer ancestor: **HARD STOP / HOLD**.

## R4 exact changes — what is already staged vs what's NOT

**Already audit-staged:** 4-file old fail-closed core patch; three-Gate trust overlay; 4-new-module protected destination patch; separately pinned source-signing and bootstrap workflow candidates. Rechecked CI on Draft PR #364 at `ce3ee5c8bc484a133311b95321914d76fc985387`: Governance Gate/Attack Dry-run/CI Gate/CodeQL all `completed/success`.

**NOT YET proven/authorized:**
- No live GitHub native attestation from the proposed workflow (not installed), and no cryptographically verified independent R1–R5 Human signatures (`0/5`).
- Actual installed `revalidation-proof-authority.mjs` candidate intentionally always rejects. **Do not claim the three-Gate overlay enables closure.**
- No production implementation of **main-anchored ledger append-only Git diff plus authenticated GitHub main/ruleset exact SHA recheck**. Current `R4-REPLAY-LEDGER.mjs` relies on injected `compareAndSet`, **not sufficient for production**.
- No exact Human-approved two-phase protected PR-A/PR-B candidate digest, CI/BCE, real issuer/test runner or T006 mapped 9 Test results.

## BCE / next owner

The present research establishes a defensible **GitHub-main-backed durable CAS alternative** and removes the *need to invent* a second datastore **as an architectural proposal**, not as deployed security. **Disposition: R4 RESEARCH ADVANCED; PRODUCTION SIGNATURE AND APPEND-ONLY GATE STILL BLOCKED.** Must obtain Human approval in the constitutional order before touching protected paths.

**Next ACTION OWNER: ChatGPT Governance.** Produce and audit the exact PR-A candidate (bootstrap trust only, never PASS), then separate the PR-B actual revalidation/closure path. Do not activate BS025, run Cursor, open T006 or rewrite historical CLOSED Tasks from this review.
