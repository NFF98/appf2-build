# GOV-CASE-T006-REBIND-001 — R5 v1.0 / exact Phase A candidate review

**R5 REVIEW CANDIDATE ONLY. NOT HUMAN-APPROVED OR SIGNED.** This text must be promoted byte-for-byte into the canonical R5 dossier only following final independent BCE. R4 direct Human decision was granted on 2026-10-11 for A / Phase A review only; its independent Ed25519 signature must be completed and verified separately.

## Approved prior decisions

R1, R2 and R3 original dossiers and Ed25519 signatures must remain immutable; R4 is the exact v1.1 dossier SHA256 `1b8fcaa7374bfb6ebb5d6675c2851e9e37ee9a93b240588f1436addabeec1bbb`. Human R4 permits review of exactly one new protected workflow, but does not authorize R5, merging, product execution, activation, Cursor or T006 closure. Pinned candidate base: `7bf5c9466e681719463560c2676ccb82ab097f0e`; any base or source change requires recalculation and independent review.

## Exact proposed protected source

`.github/workflows/revalidation-trust-bootstrap.yml`, verbatim source `delivery/audits/R4-TRUST-BOOTSTRAP-WORKFLOW-CANDIDATE.yml` at blob `f5fa3125a65eb4f5044b6543888a92d46afcc15e`, SHA256 `f5186b085b7e02a3e8faca28c6c2032518e067ad54ed70b4a53f4c08a8234ade`. Pinned checkout, node setup and GitHub attestation Actions; trigger limited to main push on specified proof-workflow paths. Artifact is `TRUST_BOOTSTRAP_ONLY`, `eligible_for_closure=false`, `product_ci_mode=NOT_EXECUTED`, `acceptance_ids=[]`, `test_ids=[]`. It CANNOT emit a T006/Product PASS.

## Full exact candidate boundary

A separate future protected PR must change **only** the above workflow plus immutable canonical `delivery/constitutional-dossiers/GOV-CASE-T006-REBIND-001-R1.md`, `-R2.md`, `-R3.md`, `-R4.md`, and this exact `-R5.md`: six non-docket paths. The seventh changed file is the single `delivery/constitutional-cases/GOV-CASE-T006-REBIND-001.json` docket, excluded from the SHA256 candidate digest by the active constitutional validator to avoid self-reference. In the docket, five real chronological Human Ed25519 stage receipts bind the immutable dossiers, previous signature hashes and pinned base; R5 separately binds the full six-path candidate digest. Digest is SHA256 of lexically sorted six paths, each as `path + NUL + raw UTF-8 bytes + NUL`. The digest is intentionally not written into this dossier to avoid self-hash recursion. The attached R5 review manifest supplies the computed exact digest. No Draft #364 audit-only file may silently enter the protected change inventory.

## Five evidenced Why findings

1. T006 real nine executable tests are absent on pinned main despite unrelated green CI; source: `delivery/audits/GOV-CASE-T006-REBIND-001-T006-MAIN-9-TEST-SOURCE-SCAN.json`.
2. Current HOLD workflow can report CI success while product tests are not executed; source: `delivery/audits/GOV-CASE-T006-REBIND-001-R4-AUTHENTIC-CI-AND-LOCAL-TEST-FACTS.json`.
3. Forged self-declared PASS cannot be used as independently verified proof; source: `delivery/audits/GOV-CASE-T006-REBIND-001-R4-BOOTSTRAP-DECISION-PACKET.md`.
4. A narrow native GH attestation bootstrap only establishes issuer provenance, not product correctness or durable replay prevention; source: `delivery/audits/GOV-CASE-T006-REBIND-001-R4-PHASE-A-DECISION-REQUEST.md`.
5. Protected workflow installation requires five independently signed Human constitutional decisions and changed-file digest; source: `harness/scripts/validate-constitutional-change.mjs`.

## Independent BCE and risks

Verify PR paths/base/content digest, five signed Human approvals, real GitHub public key, constitutional docket, pinned external action commits, governance CI and negative tests. Phase A review has NO real GitHub native product attestation, NO real nine T006 executable tests and NO PostgreSQL/RLS/Worker security PASS; synthetic model positives must never be promoted to production claims. Privilege bypass, forgery, tamper, replay or duplicate execution must remain fail-closed. Phase B security connections truly required to prevent these attacks are mandatory product safety work, not deferrable administrative polish.

Rollback before merge: discard unmerged protected PR; after merge, modifying or disabling protected workflow requires separate independent Human authorization. Preserve T001–T005/T007 CLOSED history; BS025 stays LOCKED, Sprint HOLD, T006 BLOCKED. R5 must be independently approved/signed later and then requires distinct Human merge and Cursor/Activation approvals.
