# SP-P1-003 / BD-025 — Human-approved Design source Freeze audit (no runtime test claim)

**Human approval:** 2026-10-11 expressly approved Design PR #39 Merge, BS-P1-025 Build Freeze, and governance through immediately before Cursor execution. Previously approved hash-only read prohibition; prior Design PR #37 merge approved. No actual Cursor lease permitted in this round.

## Exact sources
- Canonical Design PR #37 merged: `2e74ea19623c81261bf408856543717e943f6f51`.
- Canonical Design PR #39 merged: `17a3a57f15c17a6240b887ee55a6ded64cdf7106`.
- Previous locked Design derived source `736c757e72734f46407f8c9afcd81580ae75f0ef` (BS-P1-024).
- New exact scoped source `fda9045d0fc1b2b718d56ed49fa09abdce343a5c`, derived in Draft Design PR #38+#40 and two recorded Human-approved Registry audit-marker commits on scoped branch (NOT merged to historical frozen branch).
- GitHub compare old locked source→new source: `ahead_by=15`, `behind_by=0`, **nine** changed Working source paths (not 43 unrelated main drift).
- Stage A excludes F05 Share Restore implementation; the F05 amended Acceptance mappings are Stage B evidence obligations, not automatic T006 implementation scope.

## Independent deterministic projection audit
- Old BS-P1-024 Projection Map: 64 entries: 44 FULL_COPY, 7 SECTION_FILTERED, 13 REFERENCE_ONLY, 51 outputs.
- New source: only 9 FULL_COPY outputs changed, and 42 output blob identities retained directly; all 7 SECTION_FILTERED + 13 REFERENCE_ONLY preserve previous selection and exact SHA identities.
- Source acceptance registry: **307/307 unique IDs**; exactly 10 existing AC↔Test IDs strengthened with same stable Test ID, explicit Human-approved registry structural Freeze marker PASS.
- Source recovery registry: **135/135 unique error IDs**, new E01/E08 error mapping, structural Freeze marker PASS.
- `BS-P1-025` Human-approved Build PR #355: 51 projected output files + Projection Map + Manifest (53), 52-entry inventory, `content_sha256=f46e8ecdb9f183baf82d4a53e40fb61eaed9d340838373d515d10e7a73d342c5`. Exact pinned source: `fda9045d0fc1b2b718d56ed49fa09abdce343a5c`.
- On initial pre-HOLD PR #353: Projection Map Gate PASS, Baseline Gate PASS, all structural gates PASS; only change-scope rejected baseline writes while Sprint BLOCKED. After Human-approved control PR #354, canonical Build main is HOLD at `d01092c5403870e34508535f42840b523263b4ba`, 4/4 GitHub workflows PASS. PR #355 reruns gate on HOLD before promotion.

## Non-waivable implementation boundary
- **T006 nine executable mapped tests remain missing**, no fake PASS. Actual Playwright/PostgreSQL, P-256 positive/negative, RLS least-privilege, Share/Intent read and F03 READY proof cannot be inferred from Design structural audit.
- No PG #347 protected merge, production DB mutation, deployment or Cursor lease; explicit user instructed execution must STOP immediately before Cursor command.
- No reopening CLOSED tasks T001–T005/T007, no Stage B F05 implementation bundled into T006.
- New frozen baseline must not be activated until independent Sprint/Backlog/Activation, evidence and CI/BCE checks are satisfied. T006 remains BLOCKED until legitimate rebind.

**Audit verdict:** Design source provenance/selection/registry uniqueness + Human Freeze permission VERIFIED. Product behavior/test/CI proof NOT RUN, must remain open.