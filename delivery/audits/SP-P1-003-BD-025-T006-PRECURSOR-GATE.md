# SP-P1-003 / T006 — BS-P1-025 Pre-Cursor Rebind independent gate

## Verified canonical truth

- Human expressly approved Design PR #39 Merge, Build Freeze and governance **up to but not including** actual Cursor execution (2026-10-11).
- Design PR #37 merge `2e74ea19623c81261bf408856543717e943f6f51`; Design PR #39 merge `17a3a57f15c17a6240b887ee55a6ded64cdf7106`.
- Human-approved scope-clean Design source `fda9045d0fc1b2b718d56ed49fa09abdce343a5c`, **9 files** changed vs BS-P1-024 frozen source `736c757e72734f46407f8c9afcd81580ae75f0ef`, no unrelated main drift.
- Canonical Build main `80753af5f67c90bc8ff90c6689f21a26e295ea3b` contains BS-P1-025 LOCKED (PR355 SHA `f7eb2c451d7a6c8a0755981e00d29ba64b063111`), plus BF-054/BD-025 APPROVED delta (PR357, merge SHA `80753af5f67c90bc8ff90c6689f21a26e295ea3b`).
- Freeze / Delta / HOLD control PRs have **four required workflows PASS** on each canonical candidate before each merge. Product Test execution for T006 has NOT been claimed.
- Current `delivery/CURRENT-SPRINT.json`: `status=HOLD`, `active_task=null`, `active_build_spec=null`; `build-spec/CURRENT.json`: `active_baseline=BS-P1-024`, `implementation_enabled=false`. T006 remains `BLOCKED`; closed tasks T001–T005 and T007 remain immutable.

## Independent machine-readable Acceptance semantics diff

Comparing full BS-P1-024 versus BS-P1-025 Acceptance Registry entries yields exactly TEN semantically changed entries:
`F01-AC-013`, `F01-AC-016`, `F01-AC-017`, `F05-AC-001`, `F05-AC-002`, `F05-AC-008`, `F05-AC-011`, `F05-AC-014`, `F07-AC-004`, `F12-AC-004`.

The **closed T001 (BS-P1-021)** owns `F01-AC-013` / `F01-AC-016` and cannot truthfully carry these unchanged into the stronger `BS-P1-025` semantics. Legacy DONE Backlog `BL-P1-010` owns the same two; `BL-P1-008` (historical revalidation) owns `F01-AC-017`; `BL-P1-031` owns `F07-AC-004` outside the selected Stage A Sprint.

The repository's existing exact `harness/scripts/baseline-lineage.mjs` requires **full semantic object equality** for `canPreserveCompletedBaseline` from old to new. `harness/scripts/validate-sprint.mjs` rejects any CLOSED Task with a different selected Sprint baseline whose Acceptance changes, with **no existing exception** for revalidated legacy claims in that branch. Therefore naive `SP-P1-003.manifest.build_spec_id: BS-P1-024→BS-P1-025` yields a baseline-mismatch error for CLOSED T001. **Do not rewrite T001's old Build Spec, counterfeit closure evidence, delete strengthened Acceptance or silently broaden T006 F01/Stage B F05 scope.**

## Separate implementation evidence gap

T006 exactly nine preexisting mapped executable tests remain missing as evidenced by GitHub Product CI https://github.com/NFF98/appf2-build/actions/runs/38088567310:

`TEST-F03-009`, `TEST-F03-AC-024`, `TEST-F00-007`, `TEST-F00-AC-009`, `TEST-F00-010`, `TEST-F00-011`, `TEST-F00-AC-012`, `TEST-F00-036`, `TEST-F00-037`.

They are Cursor implementation/test deliverables only after a properly locked/rebound Task and fresh one-use execution lease. No fake placeholder tests, no relaxing integrity gate. Least-privilege PostgreSQL/RLS positive proof and protected PG R4/R5 new signature remain separate; don't access production DB.

## Pre-Cursor hard gates / required distinct future authority

1. **Governance validator path (Human-approval required if protected semantics changed):** design a bounded, independently audited historical revalidation/roll-forward that preserves T001 CLOSED evidence and demands fresh independent exact-F01 security tests. Do not self-amend `harness/` or grant an unexplained exception.
2. **Ownership/scope:** assign new per-Intent P-256 PoP, signed original-holder read grant, and test/PG L3 wiring to a specifically Human-reviewed allowed-path owner; do not silently add Stage B F05 to T006.
3. **Task/Sprint rebind:** only after (1)/(2) proofs, rebind to BS-P1-025, preserve historical T001–T005/T007 closure, run independent Sprint/Activation/CI/BCE on exact main.
4. **Cursor:** original Human execution intent retained, but no executable `[APPF2-EXECUTE][APPROVED]` lease or Cursor implementation may start **this turn** because user explicitly stopped approval immediately before actual execution.

**Audit verdict: DESIGN MERGES = PASS; BUILD FREEZE + BD-025 = MERGED/LOCKED; PRE-CURSOR REBIND = HARD STOP; PRODUCT TEST/PG R4-R5 = NOT PASS; CURSOR EXECUTED = NO.**
