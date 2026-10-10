# GOV-CASE-T006-REBIND-001 — R1 review preparation (NOT HUMAN APPROVED)

- **Candidate version:** v0.1 (AI-prepared). **Stage state:** R1–R5 = 0/5 Human signatures. This is NOT an R1 approval, Design authorization, constitutional amendment, Product test evidence or permission to execute Cursor.
- **As-of canonical Build main:** `9ead15a20537a92f6b09d76042b069eccc89169c`.
- **Approved prior governance:** Design PR37/#39 MERGED; BS-P1-025 LOCKED/MERGED (PR355, digest `f46e8ecdb9f183baf82d4a53e40fb61eaed9d340838373d515d10e7a73d342c5`); BD-025 APPROVED/MERGED, BF-054 BLOCKED; T006 BLOCKED; `delivery/CURRENT-SPRINT.status=HOLD`, `implementation_enabled=false`.
- **Human approval scope currently held:** governance through immediately before Cursor execution; no approval for any specific **L3 change to harness/CI/test-integrity rules**, and no independent R1–R5 signed record for this case.
- **Constitutional basis:** `harness/policy/APPF2-CONSTITUTION.md` §§1, 1A, 2–5 and `harness/scripts/validate-constitutional-change.mjs`. Any alteration of `harness/`, CI, activation or test-security gates requires 5 sequential independently signed Human stages and separate Human merge approval. GitHub comments from ChatGPT are not Human signatures.

## R1: five evidence-linked WHYs (review draft)

**W1 — Visible failure:** New frozen BS-P1-025 requires 10 changed security Acceptance entries (F01-AC-013/016/017; F05-AC-001/002/008/011/014; F07-AC-004; F12-AC-004). The CLOSED T001 in Sprint SP-P1-003 remains legally bound to BS-P1-021 and had proven only earlier semantics for F01-AC-013/016. The Sprint remains HOLD; T006 cannot be naively re-bound. Evidence: baseline SHA comparison and `delivery/audits/SP-P1-003-BD-025-T006-PRECURSOR-GATE.json` (merged PR358).

**W2 — Direct code reason:** `harness/scripts/validate-sprint.mjs` on every CLOSED Task with `task.build_spec_id!==manifest.build_spec_id` invokes `canPreserveCompletedBaseline` and rejects any changed Acceptance object. `harness/scripts/baseline-lineage.mjs` compares whole acceptance entries, deliberately detecting stronger F01 proof semantics. Rewriting old T001 Build Spec or relabeling it to BS-P1-025 would falsely inflate old closure and is FORBIDDEN.

**W3 — Missing capability:** A verifiable *append-only cross-baseline revalidation lineage*, which preserves original T001/T007 closures and recognizes a **new explicitly owned, still-unproved** security revalidation while the new Sprint remains blocked. Current `validate-backlog.mjs` accepts only one `item.revalidation` pointer, but BL-P1-008 already contains T007 CLOSED for F01-AC-004 at BS-P1-024. Replacing it would erase the record. BL-P1-010 F01-AC-013/016 and BL-P1-031 F07-AC-004 also need explicit new proof ownership.

**W4 — Historical origin:** WHY the older single-revalidation/closed-Task rules were originally designed without future multiple semantic-drift cycles is **UNKNOWN**; we have code/current data and existing legitimate T007 evidence, not a reliable original design decision record. Do not invent historical Human intent or an older test run.

**W5 — Why normal rebaseline cannot resolve safely:** `validate-sprint.mjs` and `validate-backlog.mjs` reject the historical mismatches; `validate-change-scope.mjs` only permits a narrowly defined, Human-approved baseline transition after HOLD and distinct Activation controls; `validate-test-integrity.mjs` with `REQUIRE_ACTIVE_TASK_TESTS=1` requires nine T006 executable `test()` declarations **before** activation, although production/task source writes are forbidden while HOLD and the necessary independent T006 Cursor execution has not happened. This sequencing deadlock must NOT be “fixed” by stub tests, an unsigned harness patch, changing historical DONE/CLOSED evidence, or bypassing CI.

## R2: canonical fact check to be independently repeated at its future Human review

1. Confirm Design PR37/#39 exact main SHAs and the derivative source SHA `fda9045d0fc1b2b718d56ed49fa09abdce343a5c`.
2. Recalculate **all 10** semantic drift IDs from exact immutable BS-P1-024 and BS-P1-025 registries. Confirm T001's two affected links, BL-P1-008's T007 record, BL-P1-010 and BL-P1-031 DONE records.
3. Confirm `build-spec/CURRENT.active_baseline=BS-P1-024`, `implementation_enabled=false`, Sprint `HOLD`, T006 `BLOCKED`, all earlier Tasks CLOSED, no PG production authority.
4. Read exact protected validators and GitHub CI settings at the new current main SHA. R2 approval must be a distinct Human message **after** the completed R2 dossier.
5. Validate no assumption of T006 nine tests, real RLS positive proof, PG R4/R5 security signoff or executable lease.

## R3: alternatives (NO HUMAN CHOICE RECORDED)

**A — Preferred candidate subject to independent R3 Human decision:** an exact audit-bound revalidation ledger preserving immutable legacy snapshots; fail closed for any unowned semantic drift; explicitly plan a separate bounded F01/F07 original-holder security revalidation (not automatically started), keep F05 Stage B separate; allow HOLD-only baseline rebind without invoking runtime implementation, and preserve a **strict** active-task test-integrity requirement for actual implementation. Any staged test-authoring window must have new explicit Human-approved least-privilege authorization, separate from a Cursor implementation lease, with no fake executable bodies. This necessarily proposes tightly scoped L3 gate changes and requires 5 Human-signed R1–R5 and fresh CI/BCE.
   
**B — New Sprint without editing protected validator:** risks duplicating T006 execution identity, losing T001 historical dependency/coverage and tampering with Backlog revalidation; existing Backlog checks still reject BL-P1-008's second drift. **Not an independently proven workaround.**

**C — No change:** keep BS-P1-025 locked while CURRENT stays BS-P1-024 and Sprint HOLD, preserving all truth, but T006 remains blocked indefinitely. Legally safe fallback.

**D — Forbidden shortcuts:** relabel T001 to BS-P1-025, overwrite BL-P1-008's T007 result, suppress changed F01 acceptance, add fake tests, change `REQUIRE_ACTIVE_TASK_TESTS` without signature, issue an executable Watcher lease, or treat public `content_hash` as secret. Explicit reject.

## Candidate invariants for protected implementation (not authorized yet)

1. Closed historical Task/Backlog retains its exact old baseline, completed test results, and immutable evidence. Any security delta is a NEW evidence claim, never an in-place upgrade.
2. Revalidation must bind **exact old/new immutable baseline SHA**, complete sorted changed Acceptance/Test pairs, independently named new proof owner, new evidence IDs, and immutable previous revalidation history; old T007 completion is append-only.
3. PENDING/PLANNED revalidation does not count as PASS or completed current coverage. A new current baseline may be selected in nonexecutable HOLD only if status/ownership is explicit and all historic drifts are accounted for; activation cannot call those proofs satisfied.
4. Current tests require actual separately run positive and negative proofs. T001's old `TEST-F01-API-001/003` cannot be used to assert signed P-256 per-intent PoP correctness under new semantics.
5. No `POST /api/v1/shares` Stage B implementation under T006. Any original Intent grant, server-side live Share check or PG RLS/Worker scope requires reviewed owner, correct L2/PG L3 permissions and real database tests.
6. Active T006 retains its **nine** mapped test IDs and test integrity; missing declarations remain a real missing work item, not made PASS by synthetic `test()` or deleting scanners.
7. Before any modification to `harness/`, require independent case docket with exact paths, 5 evidence-bound Why answers, R1–R5 Human signatures for exact candidate base and SHA256, CI/BCE, and another Human merge approval. No cross-case reuse of PG001 signatures.
8. New Candidate PR must pass malicious-case regression matrix in the companion JSON audit (at least one positive plus negative wrong hash/owner/identity/history/status/source SHA scenarios), without relaxing any existing regression.

## R4/R5 proof boundary — STOP

No R4 code diff, candidate digest/signature, Human public-key trust, case docket or R5 signed approval exists yet. These cannot be inferred from the user's general “MOVE” or previous Build Freeze approval. Candidate review may proceed; **protected change / Sprint rebind / Cursor lease MUST NOT**.

**R1 dossier requested decision (future distinct Human turn):** accept investigating GOV-CASE-T006-REBIND-001 v0.1 with the five Why findings and no code mutation. This would be R1 only, not R2–R5, merge or Cursor execution.
