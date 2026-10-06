# SP-P1-003 — BS-P1-020 BF-049 Rebind / Activation Audit

## Result

**PASS — READY FOR ATOMIC REBIND TO PRE-CURSOR BOUNDARY**

Human approval envelope:
> Human 2026-10-06: continue BF-049 BCE through Design remediation, replacement Build Spec and T001 rebind; stop before Cursor execution.

## Canonical inputs

- Previous active baseline before BF-049: `BS-P1-019`
- Replacement locked baseline: `BS-P1-020`
- BF-049: `SPEC_AMBIGUITY`
- Design delta: `BD-020`
- Sprint: `SP-P1-003`
- Task: `T001`
- Cursor RESULT: Issue #245 comment `6012821241`
- Independent gap audit: Issue #245 comment `6013292757`

## BCE contract-closure audit

### SG-1 CapabilityRequirement derivation — PASS
BS-P1-020 defines `CapabilityHintV1`, exact validation rules, `CapabilityRequirementExtractor` canonical inputs, deterministic projection, canonical hash identity, dedupe, ordering and F04 handoff. No third LLM operation is introduced.

### SG-2 ResolvedIntent exact projection — PASS
BS-P1-020 defines exact entry shapes for inputs, semantic items, assumptions, unresolved non-material items and provenance, plus deterministic projection and stable ordering. `DO_NOT_PERSIST` remains request-scoped only via EphemeralResolvedContext.

### SG-3 F02 rejection classification — PASS
BS-P1-020 adds authoritative per-F02-error F01 rejection mapping. `F02-ERR-012 PERMISSION_NOT_ALLOWED` is consistently SECURITY_TERMINAL / no retry across F01, F12 and recovery-registry.

### SG-4 Compile failure lifecycle / retry — PASS
F01-API-003 now distinguishes normal READY entry from retry entry for eligible COMPOSITION_FAILED / VALIDATION_REJECTED states and defines atomic transition to COMPOSING. Incompatible/security/resource/cancelled cases cannot same-body direct retry.

### SG-5 Mutation idempotency — PASS
Shared API + DATA-MODEL add `FAILED_RETRYABLE`, attempt_no, lease_expires_at, CAS retry/takeover, stale-attempt guards, stable logical result_ref and route-budget-backed leases. POST /intents retries reuse the same intent identity.

### SG-6 Anonymous identity binding — PASS
F01-API-ID-001 defines canonical request_anonymous_id, body-vs-trusted-context rules, answers/compile trusted-context binding, non-disclosing 404 on mismatch, missing-context rejection and explicit non-authentication semantics. F07 aligns continuity equality with the same boundary.

## Backlog / acceptance rebind audit

BD-020 affects 15 Acceptance IDs. All affected claims belong only to unfinished Sprint 3 backlog:
- BL-P1-009
- BL-P1-010
- BL-P1-011

No DONE backlog item requires historical revalidation for BD-020.

All 35 unfinished backlog items may therefore rebind from BS-P1-019 to BS-P1-020 without rewriting DONE history.

## Atomic governance transition

This activation/rebind performs only control-state changes:
- append `build-spec/activations/BS-P1-020.json`;
- CURRENT baseline BS-P1-019 → BS-P1-020;
- implementation_enabled false → true;
- CURRENT-SPRINT HOLD → SP-P1-003 / BS-P1-020 / T001 ACTIVE;
- 35 unfinished backlog items → BS-P1-020;
- BF-049 BLOCKED → RESOLVED;
- BD-020 APPROVED → IMPLEMENTING;
- SP-P1-003 BLOCKED → ACTIVE / BS-P1-020;
- T001 BLOCKED → IN_PROGRESS / BS-P1-020;
- T002-T006 remain PLANNED, rebound to BS-P1-020.

## Hard stop

This governance transition does **not**:
- write Product implementation;
- accept any previous T001 candidate;
- post `[APPF2-EXECUTE][APPROVED]`;
- start Cursor;
- start T002;
- merge dependency PRs.

After merge, the exact state is **pre-Cursor boundary**. Fresh T001 Cursor execution remains a separate Human gate.
