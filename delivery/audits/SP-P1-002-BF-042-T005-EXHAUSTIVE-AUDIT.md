# SP-P1-002 / BF-042 — T005 Exhaustive Evidence & Trust Transition Audit

## Verdict

T005 candidate `8b72c9af76a5ead3799314523dcce2d5254e8188` is **NOT MERGEABLE**.

Two blockers remain:

1. **AC-019 canonical trace loss** — invalid upstream `traceId` is persisted to `validation_run`, while F07 rejects the Evidence event. A healthy evidence sink therefore still loses validation↔evidence correlation.
2. **AC-022 transition proof is fake-only** — the test directly mutates the fake row trust_status and observes a later execution denial. There is no trusted CAS transition boundary and no transition event for INCOMPATIBLE.

## Same-class sweep

Re-audited:
- REJECTED/INCOMPATIBLE validator-issued provenance;
- raw Blueprint/raw Intent telemetry exclusion;
- admission lineage and same-hash reuse;
- execution denial evidence;
- Evidence registry grammar;
- DATA-MODEL trust mutability;
- hostile wrapper/proxy/copy cases;
- POI-005/T009 boundaries.

No additional blocker was found in these classes.

## Canonical resolution

Design BF-042 commit `1330ea523a943ccd5aa3a4ff6727b9be71dea14e` already freezes the missing semantics:
- canonical trace fallback;
- trusted server-only trust transition authority;
- compare-and-set `VALIDATED → REVOKED | INCOMPATIBLE`;
- no in-place terminal→VALIDATED;
- immutable body/admission lineage;
- F02-EVT-008 revoke evidence;
- F02-EVT-014 incompatible evidence.

The replacement Build Spec must **not** freeze current Design main wholesale. It must derive a scope-clean source from BS-P1-012 source `41a1227f2669eff54ca3c2ca84ed4a90bcdedf3f` and apply only the three BF-042 canonical artifact changes.

## Exit gate

1. BF-042 governance block merged.
2. Scope-clean Design source created from 41a1227.
3. BD-013 + BS-P1-013 frozen and all gates PASS.
4. BF-042 normalized to RESOLVED and SP-P1-002/T005 reactivated under BS-P1-013.
5. **STOP before fresh Cursor EXECUTE.**
