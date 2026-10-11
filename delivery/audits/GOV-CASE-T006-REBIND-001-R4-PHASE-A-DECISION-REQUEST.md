# GOV-CASE-T006-REBIND-001 / R4 — Phase A decision proposal (Human PENDING)

**Governance status (2026-10-11):** R1/R2/R3 direct Human approvals preserved; Ed25519 signatures **independently verified 3/3**, with authentic Ed25519 signature chain, SHA256 dossier binding, signature chronology and the CI-observed GitHub trust key fingerprint. Full independent result: `delivery/audits/GOV-CASE-T006-REBIND-001-R1-R3-CRYPTOGRAPHIC-BCE.json`. User-supplied full receipts are NOT published in this Draft PR. This is **not** constitutional docket materialization.

**R4 HUMAN DECISION: PENDING. R5: NOT AUTHORIZED.**

## One exact question for the Human

Should **R4** accept the minimal *Phase A only* protected trust-bootstrap **as the next R5 review subject**, **without approving its installation or any other protected code**?

- **Option A (recommended for scoped review):** Review exactly one protected workflow path `.github/workflows/revalidation-trust-bootstrap.yml` that emits `TRUST_BOOTSTRAP_ONLY`, `product_ci_mode=NOT_EXECUTED`, no Acceptance/Test ID, never Product PASS or Task closure. Propose **R5 review only**, conditional on five independently signed Human decisions and the exact constitutional changed-path candidate digest. This scope does **not** authorize Stage B ledger/Gate implementation, actual Main merge, activation, Cursor, or T006.
- **Option B:** Reject Phase A and keep R4 blocked; require an alternate trust-bootstrap design without touching `main`.
- **Option C:** Return R4 to deeper technical review of Phase B (main-anchored ledger + three-Gate integrations), with no protected merge or R5 progression.

## Exact source / integrity / constitutional route

- Canonical `main` frozen for current review: `7bf5c9466e681719463560c2676ccb82ab097f0e`.
- Proposed standalone protected workflow **source Git blob**: `f5fa3125a65eb4f5044b6543888a92d46afcc15e`.
- **Source file SHA256**: `f5186b085b7e02a3e8faca28c6c2032518e067ad54ed70b4a53f4c08a8234ade`.
- Exact new-file review-only patch: `delivery/audits/R4-BOOTSTRAP-ONE-FILE-EXACT-CANDIDATE.patch`, Git blob `38af563878488be9c8f0d22d7120bf2472efea5f`, `git apply --check` and byte comparison passed in disposable environment.
- Isolated Phase B three-Gate source patch + protected module candidate remain in `delivery/audits/` and are explicitly NOT part of Phase A's merge scope.
- R1/R2/R3 original approved immutable Git blobs (recovered into PR #364): `1373d7611225436358339fab954a474f719045ad`, `828215d0e889563e30726b0e1573123eb00e2475`, `022acf7b87fa0cdc01954c478b9ad98dc4875db9`; receipts' signature SHA256 chain HEAD `02c4aa57d8bf270429341b136bf53e6f6c807d2613b24c1ee065c337eaf21b74`.
- Existing canonical constitutional validator requires **one exact `delivery/constitutional-cases/GOV-CASE-T006-REBIND-001.json` docket + all five canonical `R1..R5.md` stage dossiers**, including separate Human-origin Ed25519 signatures in chronological chain. R4 Human message approval does not by itself satisfy R4 cryptographic signature. R5 requires the SHA256 of **all** exact changed paths `path + NUL + bytes + NUL` in the **distinct protected PR**. No AI-created signature or shadow docket.
- Current R4 canonical `delivery/constitutional-dossiers/GOV-CASE-T006-REBIND-001-R4.md` remains unchanged, as it has not been Human approved. **This is a supplementary R4 decision request, not replacement/canonical ratification of R4.md.**
- PR #364 is audit-only DRAFT; no protected workflow installed. The production verifier still rejects unsigned new-round closure and the nine T006 Product tests have NOT been executed.

## BCE verdict

**R1–R3 identity/signed-chain: PASS (independent 3/3).**  
**Review-only Phase A source: patch applicability demonstrated.**  
**R4 Human decision: PENDING; R4 Ed25519: MISSING; R5: UNAUTHORIZED.**  
**T006: BLOCKED; BS025: LOCKED not active; Sprint: HOLD.**

**ACTION OWNER:** Human, only to decide R4 Phase A scope; after a separate Human R4 direct decision, ChatGPT Governance may prepare independent R4 cryptographic receipt and distinct exact R5 candidate. No merges, no activation or Cursor implied.
