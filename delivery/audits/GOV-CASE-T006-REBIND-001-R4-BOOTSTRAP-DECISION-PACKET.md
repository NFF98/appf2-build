# GOV-CASE-T006-REBIND-001 — R4 minimal signer bootstrap decision packet (DRAFT, not an approval)

**Canonical main:** `7bf5c9466e681719463560c2676ccb82ab097f0e`. Human R3 authorized C **isolated PoC only**; R4 Human decision PENDING; R5 NOT AUTHORIZED; independent signed R1–R5 receipts **0/5**; T006 BLOCKED; BS025 LOCKED, NOT ACTIVATED. No protected modification, merge, new Sprint or Cursor.

## Decision before unnecessary L3 expansion

Propose a tightly bounded **Phase A: trust-bootstrap only**. The only **proposed new protected code path** is:

`.github/workflows/revalidation-trust-bootstrap.yml`

Exact audit-only candidate source: `delivery/audits/R4-TRUST-BOOTSTRAP-WORKFLOW-CANDIDATE.yml`; Git blob `f5fa3125a65eb4f5044b6543888a92d46afcc15e`; exact file SHA256 `f5186b085b7e02a3e8faca28c6c2032518e067ad54ed70b4a53f4c08a8234ade`.

The **SHA256 path+NUL+bytes+NUL** digest of that *single protected source file* is `aa750e6de97810e61b6b1adb1928b5481b22f9c5d6ece62fe75b085877f1643b`. **NOT yet the constitutional candidate digest**: `validate-constitutional-change.mjs` must include all five immutable canonical stage dossiers and an independently Human-signed case docket in the final exact changed-path inventory. Recompute the whole exact approved path digest after those exist.

Exact staged patch: `delivery/audits/R4-BOOTSTRAP-ONE-FILE-EXACT-CANDIDATE.patch`, Git blob `38af563878488be9c8f0d22d7120bf2472efea5f`. Real Git `apply --check`, `apply`, and byte-for-byte comparison **PASS** in disposable repo; destination confirmed absent on canonical main. The only protected file inside this patch is the named workflow. **Nothing installed.**

## Why 5 — evidence, not speculation

| Why | Finding | Verifiable source |
|---|---|---|
| W1 symptom | T006 blocked; nine named Acceptance Test IDs absent in 83 enumerated main test files; no signed new revalidation result | `T006-MAIN-9-TEST-SOURCE-SCAN.json`, canonical tasks.json |
| W2 direct cause | Current general CI success can be PRODUCT CI HOLD; proposed Gate closure still returns fail-closed without a trusted signed issuer | `R4-CI-TRUST-DESIGN.md`, `R4-PROTECTED-AUTHORITY-ENTRY-CANDIDATE.mjs` |
| W3 missing capability | No protected GitHub Native Artifact Attestation signer workflow; cannot bootstrap proof of issuer provenance using a user-supplied JSON | canonical `.github/workflows/ci.yml`; exact candidate workflow |
| W4 historical origin | **UNKNOWN**: original decision that caused the missing signer is not independently evidenced | Historical governance origin not asserted |
| W5 cannot ordinary-Task-fix | `.github/`, `harness/`, `ci/` protected security policies require constitutional 5-stage, independently signed Human approval; an L1 Cursor Task lease has no such authority | `harness/policy/APPF2-CONSTITUTION.md`, `harness/scripts/validate-constitutional-change.mjs` |

## Exactly what this *can* and *cannot* accomplish

- Uses SHA-pinned `actions/checkout`, `actions/setup-node`, `actions/attest`. Triggers only from protected `main` push modifying named proof-workflow files; no pull_request trigger. Emits **`TRUST_BOOTSTRAP_ONLY`**, `eligible_for_closure=false`, `product_ci_mode=NOT_EXECUTED`, zero Acceptance/Test IDs. It **cannot close T006**, and does not authorize real Revalidation or any product PASS.
- Requires repository GitHub Actions setting that actually permits attestation, and independent `gh attestation verify` of artifact digest/signer workflow/run attempt, plus authentic API read of main Push event. These **cannot be tested live until Human-authorized installation**.
- Existing verified NFF Build Ruleset id `23969502`: active, main, strict four CI statuses, PR-only, non-fast-forward prohibited, no bypass actors, **required approvals 0**. Ruleset protects Git main ancestry but **does not prove independent Human approval**.
- Optional **Phase B, separate future protected modification**: complete main-anchored replay Ledger Gate, signed real test-runner proof, and three-Gate closure wiring. Current four-file patch and overlay are audit-only and contain deliberate fail-closed authority. Phase B cannot be promoted using Phase A signatures, approver context or digest; it requires its own exact constitutional authorization scope.
- GitHub-main ledger option C documented in `GOV-CASE-T006-REBIND-001-R4-PROTECTED-MAIN-LEDGER-OPTION-C.md`. Local `git update-ref` stale-writer CAS test 5/5; separately `R4-MAIN-ANCHORED-LEDGER-CANDIDATE.mjs` and 19-case isolated negative suite. **GitHub protected PR merge is not literally `git update-ref`**, so only server-enforced strict PR up-to-date merge + authenticated current-main recheck may be proposed as concurrency defense.

## Human constitutional approval prerequisite — exact machine schema

Canonical `harness/scripts/validate-constitutional-change.mjs` requires one `delivery/constitutional-cases/GOV-CASE-T006-REBIND-001.json` changed docket and **all five** `delivery/constitutional-dossiers/GOV-CASE-T006-REBIND-001-R{1..5}.md` immutable canonical names in the same protected PR. Its `exact_changed_paths` must match *every* changed file except the docket, and its SHA256 candidate digest is computed from sorted `path + NUL + exact bytes + NUL`. R1→R5 need **five distinct, sequential Ed25519 signatures** from an independently configured Human public key, each binding canonical base, dossier SHA256, previous signature digest, direct Human reference and timestamp. R5 must additionally sign the **full candidate digest**. The current direct Human R1–R3 chat approvals are not automatically valid cryptographic signatures. No AI may generate or submit them as Human.

**This proposed Phase A is not itself Human-approved and cannot be merged as drafted.** If narrowing Phase A changes the scope of the earlier R3 choice materially, Human must explicitly accept that change at its proper constitutional review stage; no AI self-ruling on materiality.

## Test scope / rollback / go-no-go

- Verified isolated negative proofs: bootstrap 10/10 fail-closed, full proof bridge 18/18, closure guard 29/29, Authority 15/15; source-level candidate four baseline hunks and three overlays validated. These are **not** actual GitHub Native Attestation positives.
- Rollback option after a later authorized deployment: Human-directed disable of the bootstrap workflow and subsequent constitutional change to remove it; no automatic rollback, no disabling protected checks by AI. Because bootstrap is non-product, failure only prevents new signing and leaves **T006 BLOCKED**.
- **R4 go/no-go:** approve review of the *precise Phase A approach* only after Human judges the staged reduction, independent signer setup and absence of external trust proof. **R4 stage not completed; R5 cannot begin** until a specific eligible Human R4 decision exists and the five-stage cryptographic trust chain is made valid. The source patch by itself cannot satisfy the constitutional Gate.
- **Next Owner:** ChatGPT Governance prepares exact candidate, independent BCE and signer provenance; Human remains the sole authority for R4/R5, final protected merge, activation, and separately Cursor.
