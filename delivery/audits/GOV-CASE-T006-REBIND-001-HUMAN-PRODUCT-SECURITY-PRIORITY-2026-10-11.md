# GOV-CASE-T006-REBIND-001 — Human priority decision: mandatory product security now, optional governance hardening after Phase 4

**Recorded:** 2026-10-11 JST. **Decision origin:** direct Human chat: "批准A"; clarified: "產品安全：防止假證據、權限繞過、資料竄改、重複執行。必需！治理安全 Phase4 之後".

## Binding priority / scope

- **PRODUCT SECURITY — MUST NOW, NOT DEFERRED:** independently credible evidence authenticity / reject forged self-asserted PASS; authorization and privilege-boundary enforcement; immutable integrity, tamper/replay resistance; idempotency and concurrency safety against duplicate execution. Fail closed where trusted proof is missing. These invariants require production-grade implementation, actual executable negative/positive tests and independent CI/BCE before any affected product path may be treated as PASS. Synthetic PoC alone does NOT satisfy them.
- **NON-BLOCKING GOVERNANCE HARDENING — DEFER UNTIL AFTER PHASE 4:** enhanced paperwork, richer audit/reporting formats, optional workflow polish, broader governance redesign. Track as future enhancement, not T006 acceptance.
- **NON-DEFERABLE EXISTING GOVERNANCE/SECURITY GATES:** keep the currently effective constitutional five-stage Human signature chain (R1–R5) for any protected-path change, exact immutable source and target digests, repository PR/CI gates and mandatory Human approvals. This administrative minimum is not a new governance-hardening feature; deferring it would bypass the existing constitution.
- **A is a sequencing decision, not a permission to skip product security.** A previously proposed `TRUST_BOOTSTRAP_ONLY` can establish provenance only; by its own design it is NOT proof of production product security, cannot close any T006 test or permit Product PASS. Phase B security wiring that is technically necessary to enforce product invariants is NOT classified as optional governance polish.
- **No new Sprint, Task, protected implementation, merge, or product status activation** is authorized by this record. Human R4 path preference is A, but an exact stage-bound R4 Ed25519 approval receipt and R5 exact candidate review remain required under existing rules.

## Acceptance questions before T006 can be unblocked

1. Does actual protected product code reject forged `PASS`, replay, untrusted locators and invalid provenance? Evidence is an executable production-wired security test, not a test double.
2. Do authorization, service roles and DB constraints/RLS reject privilege escalation or unauthorized mutations?
3. Do integrity constraints, append-only ancestry and source/target binding reject tampering?
4. Do idempotency and concurrent/retry tests reject duplicate execution and duplicate accepted evidence?
5. Are the real T006 nine executable tests, associated PostgreSQL/Worker/RLS behavior and CI/BCE separately verified where in-scope, without conflating them with synthetic PoC or Human-signature validation?

**ACTION OWNER:** ChatGPT Governance: minimize overhead while preserving mandatory gates and prepare exact signed R4/R5 next action; Cursor only upon a separate Human execution approval. `BS-P1-025` still locked/not active, `Sprint HOLD`, `T006 BLOCKED`.
