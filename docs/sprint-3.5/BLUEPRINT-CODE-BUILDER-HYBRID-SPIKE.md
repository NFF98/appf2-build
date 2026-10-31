# APPf2 Sprint 3.5 — Hybrid Blueprint / Code Artifact implementation slice

> **2026-10-31 最新 Sprint 3.5 範圍／交接**：執行唯一計畫 [Sprint 3.5 五核產品閉環收尾計畫](./SP35-FIVE-CORE-PRODUCT-CLOSEOUT.md)（`SP35-FIVE-CORE-PRODUCT-CLOSEOUT`）；其 Product Design authority 只在 Design PR #45 H-001 §0（commit `6ed57015d340b1863da5ecb5d586b28263b012d0`）。使用者要求**五核＋基本 v2 可操作、保存、重開、分享、0 新生成**屬 Sprint 3.5；Phase 2 帳號級永久收藏／完整歷史／所有權／語意重用仍 deferred。以下原 10/28 文本僅作歷史或子功能證據，與最新 §0 衝突時不得據此縮成私人 Demo 或擴成未授權 Phase 2 功能。


Source: [APPf2 Design PR #45](https://github.com/NFF98/appf2-design/pull/45), revised Working architecture at commit `f45517f97950d3e78aee20694adefbcefd1ed653` (final code-first single-generator decision).
Status: **Design-first experimental Build slice on PR #419, now Stage A scope-locked to Design PR #45 Working §0**. Not a production user-facing Code Builder, not a version promotion of F02 v1. Sprint 4 not started.

## Long-term product direction (2026-10-28 user decision; NOT a Sprint 3.5 release checklist)

**One natural-language request → one general AI Code Builder → Blueprint v2 → automatic compile/security/real browser tests → one shareable App card.**

- New App creation is **code-first by default**, regardless of whether the user requests a game, list, form, financial tool or animation. Never route new requests to a fixed Blueprint component generator solely based on App category.
- Blueprint v2 is **the packaging/identity/permissions/state-reference/version/share contract**, not a restricted menu of UI primitives that limits generated code. The exact built code artifact/manifest is pinned by hash. Mutable personal state is kept separately and is never placed in public shared bundles.
- Frontend uses only execution profiles approved by sandbox policy; initially isolated static Web Apps. Code requiring a backend, payments, camera or network is not automatically enabled. Technical profile is NOT a second AI generation method.
- A provisional Blueprint may be prepared before build, but **final immutable published Blueprint is sealed only after** independent build, test and artifact hash admission. Never publish an unbuilt draft or count a model's text as a working App.
- Existing v1 Native Blueprint F02/F03 is retained **only for backward compatibility with prior App cards**. It is not a competing new-product engine.
- Once a version is admitted and published, F05/My Apps can reopen that exact code/version without a new paid model generation. Approved platform hosting/network/runtime costs are separate.

**Implementation truth:** current H1/H3a prototype demonstrates integrity/opaque-frame isolation and generic execution using deterministic prewritten scripts. The real AI-generated project → isolated compiler → immutable R2 object → F02 v2 admission → F05 shared v2 card → F03 state bridge pipeline is **not** implemented yet. No production enablement and no claimed full E2E.

## Technical decisions

- **v1 remains immutable**: the existing F01–F02–F03 original Blueprint and current LifePilot/Moving public cards are untouched.
- `CodeArtifactEnvelopeV2` is a separate strict type; never feed it to the existing F02 v1 validator or silently rename `schema_version=1.0.0`.
- A `WEB_STATIC_V1` prototype uses an immutable **JS asset plus exact manifest**, with independent SHA-256 bytes, manifest, and canonical envelope checks. Strict fixed-size resource ceilings and unknown-key rejection, no external URL or import, no raw bundle grants from only knowing a hash.
- Frontend **cannot mount code into the APPf2 origin**. A sandboxed iframe (without `allow-same-origin`) receives *already hash-validated* JS and an integrity-bound CSP with `default-src 'none'`, no network/form/frame/object/worker. No host cookie, token, appf2 database access or parent DOM access.
- First implementation is *only* standalone executable contract + isolated-frame demonstration and security tests (Design H1/H3a), **not yet Code Builder full backend**. File metadata + JS bytes are supplied by explicit trusted test harness; there is no public artifact-write/read endpoint, no R2 upload, no share-card route for v2, no AI source generation, and no F02 production admission or F03 runtime integration.
- HTML/CSS framework bundles, React dependencies, image/game assets, server workloads and dedicated storage/bridge integration are **future format/permission profiles**, not “supported” by the prototype.
- Host controls the frame lifecycle and can tear it down on navigation; any runtime state inside stays temporary unless a future *typed, authenticated bridge* is implemented. No localStorage or parent-to-child API at this stage.

## Acceptance (must be verified, not simply claimed)

1. Valid bytes + strict manifest + v2 envelope round-trip; mutated script/manifest, unknown fields, bad path or execution profile fail.
2. Browser executes arbitrary simple JS inside isolated iframe with **zero Code Builder AI calls**.
3. Browser cannot read parent document/session/local storage/cookies and cannot make outgoing `fetch` through restricted CSP.
4. Existing v1 tests, published cards and Staging Worker remain intact.
5. **NOT yet passed:** real AI source→Sandbox build→R2 artifact→F02 v2 admission→F05 new published card→F03 isolated runtime→F16 new version. That end-to-end is separately required and must not be marked complete by (1)–(4).

## Next bounded increments

- H4: controlled Cloudflare Sandbox build, compiled output + SBOM + verified immutable R2 persistence (consent/billing controls).
- H3b/H5: authenticated restricted F03 state bridge, actual v2 F02 admission + F05 recipient delivery, real stranger browser.
- H6/H7: adversarial runtime containment plus two unrelated AI-generated styles from the **same generic code path**, no per-game case handling.

No automatic paid AI test, no release merge, no blanket statement that “any game works”.
