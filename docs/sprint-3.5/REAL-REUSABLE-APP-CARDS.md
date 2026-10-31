# APPf2 Sprint 3.5 — Real Reusable App Cards (historical implementation notes, 2026-10-28)

> **2026-10-31 最新 Sprint 3.5 範圍／交接**：執行唯一計畫 [Sprint 3.5 五核產品閉環收尾計畫](./SP35-FIVE-CORE-PRODUCT-CLOSEOUT.md)（`SP35-FIVE-CORE-PRODUCT-CLOSEOUT`）；其 Product Design authority 只在 Design PR #45 H-001 §0（commit `6ed57015d340b1863da5ecb5d586b28263b012d0`）。使用者要求**五核＋基本 v2 可操作、保存、重開、分享、0 新生成**屬 Sprint 3.5；Phase 2 帳號級永久收藏／完整歷史／所有權／語意重用仍 deferred。以下原 10/28 文本僅作歷史或子功能證據，與最新 §0 衝突時不得據此縮成私人 Demo 或擴成未授權 Phase 2 功能。

> **2026-10-31 SCOPE CORRECTION — NOT SPRINT 3.5 DELIVERY AUTHORITY**
> 本檔為 10/28 的既有功能實驗、驗收紀錄和候選提案，不是 Product Design SSOT，也不是新功能授權；不得以本檔 B／Public Gallery／永久保存要求擴張 Sprint 3.5。當前唯一 Design 範圍判準：
> `NFF98/appf2-design/working/architecture-evolution/BLUEPRINT-CODE-ARTIFACT-HYBRID.md (Design PR #45, commit ee5f58fd672386f0b8542bda2066d5af471a9352, §0)`。
> Sprint 3.5 只做真實 AI 多檔案 → PostgreSQL Agent Job 恢復 → 私有 Sandbox 建置 → 獨立 Browser QA／修復 → 私有可操作 Stage A 預覽。Phase 1 F05 **基本** Share／Restore 仍屬原 Phase 1 Core Loop，但新 **v2** 公開 Gallery／正式發布不是本次 Stage A Gate；Phase 2 才涉及帳號級 Save、History、Owner、F10 語意重用。
> **既有 v1／單檔卡片相容性和已實作安全性不可移除；保留本檔舊段落僅供追蹤實作與歷史測試，不代表本 Sprint 必交付。**

Status: **Sprint 3.5 implementation addendum / NOT a new BS baseline or Sprint 4**.
Scope: PR #419 only. Product priority; no 16P / governance workflows in the product critical path.
Source boundaries: Phase 1 F05 Share / Restore and EXECUTION-ADMISSION §8.1; F10 semantic retrieval remains DEFERRED.
This document is historical implementation evidence; Product Design scope is owned exclusively by the Design PR #45 Working §0. It never authorizes expanding Sprint 3.5, weakening grants, or releasing Production.

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


## B — Historical public gallery proposal / existing implementation record (NOT Sprint 3.5 Stage A gate)

**Publishing is an explicit original-holder action, NEVER implicit because a test passed.** The S03 creator presses `公開分享` and confirms that the reusable App **definition/initial data**, but **not their private runtime state**, will be visible to anonymous visitors. The creator must hold the exact scoped cookie + original nonextractable PoP + fresh `share:create` grant, from the *same* immutable compiled hash. The server independently verifies exact original lineage + **fresh executable F02 admission before insertion**. No third party may publish a known hash, even if they know an intent or anonymous UUID.

**Persistence**: the staging PostgreSQL `appf2_published_app` table has UUID v4 random share ID, exact source intent/anonymous/hash, sanitized title, ACTIVE/REVOKED/EXPIRED, creation timestamp and idempotency key; no prompt or runtime data. Worker login gets explicit minimal GRANT + RLS, with no Data API privileges for `anon`/`authenticated`. A narrowly scoped `SECURITY DEFINER` function (empty search_path, explicit argument validation, EXECUTE only `appf2_worker`) returns the canonical body/admission metadata **only for one currently ACTIVE, nonexpired share of that exact hash**; no hash-only / guessed ID access. Never cache authorization. Other users get a newly hydrated F03 instance, initial state only.

**Wire**:
- `POST /api/v1/shares`: same-origin, `Idempotency-Key`, JSON `{source_intent_id,blueprint_hash,title}`, `Authorization: Bearer <fresh original-holder share:create grant>`; 201 `{data:{share_id,share_url,status}}`, or fail closed; no public access without user action.
- `GET /api/v1/published-apps`: privacy-sanitized list of currently ACTIVE explicitly listed shares; **not** all compiled apps and **not** scripted inspiration cards.
- `GET /api/v1/shares/{share_id}`: live reference with hash; no owner/user detail.
- `GET /b/{hash}` and `GET /api/v1/blueprints/{hash}/execution-admission` with `X-Appf2-Share-Id`: verify live ACTIVE reference + exact hash **on every request**, then current trust/registry/capability checks. Never use original-holder grant for a recipient.
- All share/published calls are **0 F01** and **0 model-provider** calls.
- `/share/{share_id}` direct URL is handled client-side; it fetches live share metadata then authorized delivery/hydration, not user re-creation.
- No fake curated LifePilot/moving cards until an authorized share of those exact Blueprints actually exists; CI private intent proof cannot be exported.
- Homepage cards only appear for LIVE published shares, show `直接使用（不用 AI）`, and their click hydrates F03. 404/410/503 show clear unavailable message, **never** fallback to paid model.

**B acceptance gate**: (B1) stranger browser retrieves one legitimately published share by card and by URL, runs registered mutable controls, 0 F01/AI; (B2) unknown/revoked/foreign hash/unsigned creator requests deny; (B3) original owner state not copied; (B4) real PostgreSQL RLS/grants and typed/contract/browser tests PASS; (B5) LifePilot and moving-specific cards require separate lawful published references and independent E2E. Report each independently.


## B2 — Explicit first-party showcase publication (Staging only, 2026-10-28)

**Authorization and origin:** Product owner explicitly requested that the *existing CI-tested LifePilot and Moving App* be selectable as real no-AI public cards. The underlying Apps were generated by this product's own E2E automation, not imported from an unrelated user's private session. This is a **separate first-party operator-curation action**, NOT F05 creator self-publish, not a hash-only anonymous API, and never automatic merely because a run was PASS. Operator uses privileged staging database maintenance access after verifying exact run provenance, validated content, and non-sensitive demonstration-only Blueprint; user-facing original-holder API and all RLS stay unchanged.

**Exact allowlist:** only LifePilot `sha256:45d53fe47ecb52a6864b86bf0bef979e312fc67733ae0a9e20207cc6d505d8f3` (the 2026-10-27 23:44 UTC run `40603935791`) and Moving `sha256:ad73e31a5fc79f9b8ef5ac6ce029ed582d712bb91a9e02c671550dcf5f07a0cc` (the 22:22 UTC run `40594073419`). Revalidate F02 `PASSED` lineage, content trust `VALIDATED`, exact original Intent/anonymous identity, and check demo content for secrets/PII before insertion. Neither original raw prompt nor model output except the immutable canonical admitted Blueprint, nor any mutable Runtime data, is published. No other Blueprint qualifies.

**Operator action:** run audited, idempotent, staging-only fixed-hash SQL under database owner; insert just the F05 public share reference, random UUID v4, exact original source intent + anonymous identity from verified DB joins, sanitized public title, ACTIVE/listed. Never place this maintenance operation in production migrations; never give the browser/operator credentials, privileged publish API, or arbitrary hash publication to anon users. Revoke by setting status REVOKED. The existing recipient endpoint must still recheck ACTIVE reference and fresh F02 admission per request. Public users obtain separate F03 instances with local states.

**Real proof:** from a *new browser context on deployed Staging*, click BOTH live DB-backed cards, operate real controls (LifePilot five functions and Moving tasks/shopping/budget), verify reload and no F01/AI network requests; independently load each `/share/{uuid}`; on revoked/foreign/unknown share, fail closed. If any fails, report precise failure; never call this completed solely because DB returned 200 or a fixture browser passed.

**Boundary:** first-party operator-curated CI demos and private original-holder F05 publishing have different consent proofs; product code must never treat the curated entry as permission for a third-party to publish another Blueprint.


## S03 result button truth — F16 entry vs F03 input editing (2026-10-28)

**Bug report:** live published LifePilot/Moving apps currently show `「調整結果」目前還不能使用`. This is real product incompleteness; previously reported public-card E2E intentionally did not prove F16.

**Phase 3.5 immediate, no-model correction entry UX (strictly scoped):**
1. `調整結果` must be interactive and open an accessible correction-choice dialog, showing the **actual current canonical F03 output** without altering it. No generic `UNAVAILABLE` banner for opening the entry.
2. Explain two distinct intents, not interchangeable: **modify existing input/data** versus **semantic rule/logic is wrong** (the full F16).
3. For existing input/data: click **調整輸入（不用 AI）** and move focus to a genuine editable control belonging to the currently hydrated App; user edits with the *existing F03 capabilities*, triggers canonical output recalculation and normal persistence. No result DOM override, no mutation of immutable Blueprint, no AI/F01 POST. If no editable control exists, do not claim an edit occurred. Preserve original App and committed data on cancel.
4. For semantic rule/logic: offer a bounded, in-memory correction draft and the real before-value context; **do not fabricate a new F02-validated child, fake comparison, or mark result corrected**. The full F16 correction (POST /corrections, F01 CORRECT, F02 full validation, new immutable child + CORRECT lineage, trusted input replay, compare/accept/keep/revert) remains NOT IMPLEMENTED. Clearly state that it requires a new validated version and may incur AI fees only after user consent; never send automatically.
5. Accessibility: native dialog keyboard focus, Cancel/Escape, no hidden paid action, privacy-safe state, visible before output. The dialog cannot block or corrupt normal App operations.
6. Verification: genuine no-cost browser E2E against the already-published Staging App, click Result → adjust existing input → change displayed output via F03 action, reload and see changed value, F01 requests=0; separate unit/UX test that semantic correction is not falsely passed.

**Truthful signoff:** local-input edit PASS is **not** F16 CORRECT PASS. Report these independently; do not claim that `調整結果` fully repairs wrong formulas until F16 full contract and real E2E exist.
