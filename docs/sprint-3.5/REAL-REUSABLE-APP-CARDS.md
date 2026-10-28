# APPf2 Sprint 3.5 — Real Reusable App Cards (PRODUCT DELTA, 2026-10-28)

Status: **Sprint 3.5 implementation addendum / NOT a new BS baseline or Sprint 4**.
Scope: PR #419 only. Product priority; no 16P / governance workflows in the product critical path.
Source boundaries: Phase 1 F05 Share / Restore and EXECUTION-ADMISSION §8.1; F10 semantic retrieval remains DEFERRED.
This document is product acceptance truth for this change, **not** authorization to weaken grants, ownership, branch protection, or production release.

## Outcome and two distinct products

**A. My Apps (original holder).** A successful F01→F02→F03 READY app becomes a saved card on this browser.
Click **Open** must fetch the **original canonical Blueprint** using existing original-holder PoP+scoped cookie and fresh server ExecutionAdmission, hydrate a new real F03 instance, and restore legitimate local runtime state.
- Never POST `/api/v1/intents`, never run F01 analysis/compile, never call a model from the open-card code.
- Refresh, Home, reopen and a second tab in the **same browser profile** must retain visible cards. The card is metadata, not a bearer token.
- Never store a plaintext model answer, Blueprint JSON, PoP private-key export, secret, auth token or grant in localStorage. The private CryptoKey remains nonextractable in IndexedDB. Fresh server access is mandatory every open.
- **Important bounded limit**: current original-holder cookie and PoP persist **at most 24 hours**. Do not advertise forever, cross-device, sharing, or offline use. Do not silently create a replacement F01 intent when access expires. Card becomes unavailable with plain-language reason and an option to remove it.
- Persisted state must be scoped to exact `intentId + contentHash`, bounded, and respect `DO_NOT_PERSIST`.
- Clicking Open must never reanalyze on any failure path.

**B. Published Starter Apps (recipient, no prior F01).** A LifePilot/moving-house card that **anyone** can open is a *separate* publishing feature, not My Apps. Such cards require a genuinely validated immutable Blueprint plus creator-authorized F05 published ACTIVE share reference, actual DB/share implementation, recipient safe delivery, and **fresh** execution admission.
- No hash-only read, unsigned share creation, arbitrary publishing of CI private content, fake share IDs or bypassing F05. A passed GitHub E2E run **does not by itself authorize public publication**.
- Recipient opens the same immutable Blueprint in their own new F03 instance; no generator call, no shared mutable user data.
- Until publishing+recipient browser E2E pass, homepage must **not** label inspiration prompt-prefill cards as ready-to-run or claim LifePilot/moving demo cards already public.
- Never use a paid F01 test run just to validate a new UI/reopen iteration. Authorize any truly new paid generation separately.

## Implementation boundary for this PR

1. Convert currently per-tab-only My Apps metadata to same-browser saved cards, with no dangerous authority expansion. Keep legacy tab recovery for active tab; use browser-wide saved catalog for cards.
2. Recover the **same original-holder** nonextractable PoP key via IDB across browser tabs, using a per-browser key namespace. Preserve old same-tab nonce/key namespaces for pre-migration apps when recoverable. A new browser without the original key always denies.
3. Retain original short-lived server cookie, 24h key expiry and fresh admission; do not alter server trust contract.
4. Persist browser runtime mutable state across tabs only if not marked DO_NOT_PERSIST. Use the exact identity+hash and a bounded JSON payload; fail closed for malformed/oversized values and browsers without storage.
5. Correct App state machine so reopening an old card does not show stale F01 creation results and navigating Home never starts F01.
6. Keep **My Apps** and *Inspiration* visually distinct. A saved card label must state “existing app / no AI generation”, and failure text must not imply auto-retry.
7. Do not merge or deploy Production without permitted authorization.

## Acceptance / proof matrix

| Gate | What proves it | No false PASS |
| --- | --- | --- |
| A1 | Headless browser: App previously F03 READY -> Home -> saved card -> genuine App interaction | Unit mock alone insufficient |
| A2 | Browser second tab, same profile: card visible; open -> same immutable App | SessionStorage-only not sufficient |
| A3 | Browser reload after real task/expense/habit: exact committed values restored | No fake static labels |
| A4 | Instrument actual network: all reopen steps have **0 model provider invocations and 0 F01 POST** | Merely missing request listener not proof |
| A5 | Original key missing / expired / cookie invalid / revoked / cross-user -> no hydrated App, no fallback AI | Fail closed |
| A6 | Secret/privacy and bounds tests, TypeScript, lint, existing API tests | Must pass |
| B1 | Actual curated authorized share published, new browser without original key opens real interactive App | Pending F05 build |
| B2 | Real LifePilot and moving demo references independently approved, recipient operations tested | Pending publishing |

**Status accounting**: A and B reported independently; the word “REAL PASS” requires matching real evidence. No assertion that any arbitrary language or generated App is universally validated.
