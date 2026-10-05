# SP-P1-002 / BF-046 — BS-P1-017 Freeze Candidate Audit

- Source Design repo: NFF98/appf2-design
- Canonical Working commit: `3f006181e626c062561872e8a9dff4f47bd86740`
- Scope-clean derived freeze source: `6b5babe6e7ccc44b8f83731367aa8eece9c96364`
- Freeze base: `336cc979e8645af6dfb04f72e07d4daf741d22c4`
- Previous baseline: `BS-P1-016`
- Replacement baseline: `BS-P1-017`
- Human decision: Option A approved; centralized sender reviewed in Phase 4, default Phase 5 implementation.
- Design provenance: PR #24, merge `3f006181e626c062561872e8a9dff4f47bd86740`.

## Scope check

Design main differs from the prior F07 source only in the Human-approved terminal lifecycle precedence and future Phase 4/5 architecture note. The replacement baseline copies all unchanged BS-P1-016 projected artifacts byte-for-byte and replaces only F07 plus projection/manifest metadata.

## Frozen semantics

1. pagehide / terminal lifecycle establishes synchronous browser-safe handoff without waiting for a fresh IndexedDB cross-tab check.
2. Only locally held, TTL-live, privacy-valid immutable snapshots are eligible.
3. A narrow stale-copy race is permitted only at terminal lifecycle handoff.
4. Normal flush/retry keeps shared durable membership reconciliation.
5. TTL / queue bounds / overflow priority / event_id dedupe / Evidence-not-Product-truth remain unchanged.
6. Centralized browser Evidence delivery coordination is deferred: mandatory Phase 4 architecture review, Phase 5 default implementation if not promoted earlier.

## Verdict

PASS — eligible for Human-approved replacement Build Spec activation/rebind under the current BCE envelope. No Cursor execution authority is contained in this freeze.
