# PFR-06 — Product Proof Stage A / Playable App Detailed Sprint Planning Candidate

> **Status: PLANNING PASS CANDIDATE — HUMAN REVIEW REQUIRED**
>
> Program: PFR-2026
>
> Build authority: BS-P1-019 LOCKED
>
> Sprint ID: NOT ALLOCATED
>
> Cursor authority: NONE

## 1. Product proof

Stage A closure 必須證明：

one natural-language request → F01 generate → F02 validate/admit → F03 READY → S03 render → real local interaction changes committed Runtime state/result.

不是把 F00 / F01 / F03 各自做一些，也不是用 isolated unit tests 代替 Product proof。

## 2. Canonical control state

- Build main: 431f532cc6425eb88fe924b83b1af9da4c3ce206
- BS-P1-019 = LOCKED / active
- implementation_enabled = false
- CURRENT-SPRINT = HOLD
- active_sprint = null
- active_task = null

本 planning change 不修改上述 control state。

## 3. Exact Sprint scope

Stage A 精確選入 12 個既有 QUEUED backlog：

- F01: BL-P1-009, BL-P1-010, BL-P1-011
- F03: BL-P1-012, BL-P1-013, BL-P1-014, BL-P1-015, BL-P1-016
- F00: BL-P1-017, BL-P1-018, BL-P1-020, BL-P1-022

Acceptance / Test = 84：F00 24、F01 22、F03 38。

Proof scopes：BEHAVIOR 41、CONTRACT 31、END_TO_END 2、RUNTIME_EVIDENCE 10。

三個 Sprint 外 dependency BL-P1-002 / 005 / 008 均已 DONE；沒有 unfinished dependency 被留在 Sprint 外。

## 4. Task graph

本候選使用 planning slot A1–A6，不是 canonical TNNN。Sprint / Task numeric IDs 只在 Human 批准 Sprint creation 時分配。

A1 Compiler 與 A2 Runtime Core 可平行；A3 依賴 A2；A4 依賴 A1 並可與 A3 平行；A5 等 A1–A4；A6 最後做整體可玩 vertical proof。

### A1 — Compiler gate, API lifecycle & truthful creation progress

Backlog: BL-P1-009 / 010 / 011；22 AC。

Outcome：Intent 走 deterministic policy → F04 coverage → Prompt B → mandatory F02；API / idempotency / timeout / compiler_run / creation progress 全部成為可測 contract。

Write scope：src/platform/compiler/、src/platform/intent/、src/edge/intent-api.ts、supabase/migrations/、contract/behavior/API/regression tests。

### A2 — Deterministic Runtime core & atomic interaction engine

Backlog: BL-P1-012 / 013；17 AC。

Outcome：admitted Blueprint deterministic hydrate 到 READY；state / derived rules / expression / RNG / monotonic time / FIFO event / atomic Action transaction 真正可跑。

Write scope：src/platform/runtime/ + contract/behavior/runtime/unit/regression tests。

### A3 — Runtime trust, lifecycle, operation token & hard-timeout safety

Backlog: BL-P1-014 / 016；19 AC；blocked by A2。

Outcome：Runtime 不繞過 F02/F04 safety；每次 interaction 有唯一 token、truthful checkpoint、hard deadline、late completion reject、fail-closed integrity。

### A4 — Discover/Create React shell, clarification & visible assumptions

Backlog: BL-P1-017；7 AC；blocked by A1；可與 A3 平行。

Outcome：blank prompt / Inspiration Capsule / clarification / visible assumptions 忠實消費 F01，不把 LLM proposal 冒充 User fact。

Write scope：src/app/ + behavior/E2E/visual/responsive tests。

### A5 — Shell persistence, authority boundary & truthful processing presentation

Backlog: BL-P1-020 / 022；10 AC；blocked by A1–A4。

Outcome：DO_NOT_PERSIST、duplicate logical create、Shell/Runtime authority boundary、F01 六 checkpoint + F03 APP_READY composite progress 都 truthful。

### A6 — Result contract, S03 App surface & Playable App vertical proof

Backlog: BL-P1-015 / 018；9 AC；blocked by A1–A5。

Outcome：canonical result 不讀 DOM；Generated App 是 S03 主體；完成自然語言 → validated Blueprint → READY render → real local interaction 的 real-browser proof。

A6 closure 不接受只有 mocked service/unit green。

## 5. Explicit non-scope

- Stage B Share / F19 Shared Ranking
- Stage C F06 Remix / Lineage implementation
- F16 full Correction / Revert implementation
- Phase 4 T004/T005/T006 hardening carry-forward
- Production Release / deployment
- Dependabot PR #1/#2/#4/#94/#261

S03 可以呈現 locked design 已要求的入口 boundary，但不得藉此提前實作 Stage B/C。

## 6. Pre-activation readiness blockers

### RDY-01 — React Browser Toolchain

BS-P1-019 Infrastructure 已鎖定 Browser → React → Universal Runtime；tsconfig 也已啟用 DOM + react-jsx。

但 package.json / package-lock 尚未直接宣告 React / ReactDOM；Vite 只有 transitive copy。package.json / tooling config 又屬 governance path，Active Task 不能自己補。

因此 Activation 前需要 Human-approved governance-only readiness PR：

1. pin React + ReactDOM；
2. pin matching React type packages；
3. browser build/preview tool 改成 direct dependency；
4. 建立 exact npm browser build / preview scripts；
5. 不包含 Product src/app implementation。

### RDY-02 — Real-browser Product runner

Playwright 已有 baseURL，但正式 Product web server / app runner 尚未建立。

Activation 前要把 deterministic browser runner / webServer config 準備好；之後跑的是正式 src/app Product surface，不能拿 SP2 test-only harness 冒充 Stage A Product proof。

## 7. Open PR / Finding readiness

完整 open PR inventory：#1, #2, #4, #94, #207, #261。全部不阻擋 Stage A planning / Sprint creation，但不得混入 Stage A implementation。

Unresolved Build Findings：OPEN 0 / ASSESSING 0 / BLOCKED 0。

## 8. Verdict

DETAILED SPRINT PLAN = COHERENT / PASS CANDIDATE。

SPRINT ACTIVATION = NOT READY，唯一原因是 RDY-01 + RDY-02 Build Machine readiness。

這兩項不需要改 Product semantics，也不需要新 Build Spec。

## 9. Next Human Gate

建議下一個決策：批准這份 Stage A detailed plan，並批准先做 governance-only pre-activation React/browser toolchain readiness。

這個批准仍然不建立 Sprint、不分配 Sprint ID、不 activation、不啟動 Task、不授權 Cursor Product implementation。

Readiness PASS 後，再建立 Sprint creation candidate；那時才配置下一個 canonical SP-P1-NNN 與 T001...。
