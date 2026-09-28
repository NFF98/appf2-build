# appf2 App Architecture

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：Working Architecture Baseline。本文只回答四件事：**appf2 有哪些系統、每個系統負責什麼結果、核心流程怎麼跑、1／3／6 個月怎麼長。** Function 詳細 Product Design 由 `working/detailed-design/APP-DETAILED-DESIGN-OVERVIEW.md` 與 `working/detailed-design/functions/` 承接。

# 1. Architecture Thesis

appf2 是一個 **Intent-to-App Runtime Platform**。

> **意圖就是 App。**

~~~text
Intent
→ Understand
→ Clarification / Assumption Gate
→ Resolve Intent
→ Select Capabilities
→ Validate Blueprint
→ Run in Browser
→ Inspect Result
→ Use / Share / Remix / Correct
→ Learn from Evidence
~~~

appf2 不為每個 Micro-App 生成、部署一套新程式。

它部署的是一個穩定平台：

~~~text
Experience Shell
+ Intent-to-App Engine
+ Capability Fabric
+ Model Gateway
+ Trusted LegoSpec
+ Universal Runtime
+ State / Identity / Evidence
+ Humanized Recovery
~~~

不同 App 只是不同的 validated Blueprint。

---

# 2. 一張圖看懂整體 App

~~~mermaid
flowchart LR
    U[User]

    subgraph UX["Experience Shell / 靈感精靈"]
        INS[Inspiration / Ghost Text]
        REF[Progressive Refinement]
        REM[Remix]
        REC[Humanized Recovery]
    end

    subgraph ENGINE["Intent-to-App Engine"]
        L1["L1<br/>Ingestion & Routing"]
        L2["L2<br/>Semantic Compiler"]
        L3["L3<br/>LegoSpec Validation"]
        L4["L4<br/>Universal Runtime"]
    end

    MODEL["Model Gateway<br/>LLM Router"]
    FABRIC["Capability Fabric<br/>Trusted Capability Registry"]
    DATA["State / Identity / Evidence"]
    APP["Interactive Micro-App"]
    EXT["External / Paid Capability<br/>later"]

    U --> UX
    UX --> L1 --> L2 --> L3 --> L4 --> APP

    L2 <--> MODEL
    L2 <--> FABRIC
    L3 <--> FABRIC
    L4 <--> FABRIC

    APP --> DATA
    UX --> DATA
    DATA -. improve .-> L2
    DATA -. capability gap .-> FABRIC

    L4 -. only when required .-> EXT
~~~

核心關係：

> **Compiler 決定怎麼組；Capability Fabric 決定能不能做；Validator 決定能不能信；Runtime 決定怎麼跑；Experience Shell 決定 User 是否能理解與繼續。**

---

# 3. appf2 有什麼？各自負責什麼結果？

| 系統 | 主要責任 | 必須產生的結果 |
|---|---|---|
| **Experience Shell / 靈感精靈** | Inspiration、Ghost Text、Refine、Remix、Recovery | User 容易開始、容易修正、失敗也知道下一步 |
| **L1 Ingestion & Routing** | safety、policy、quota、reuse lookup、routing | 合法請求進正確路徑，原始 Intent 被保存 |
| **L2 Semantic Compiler** | 理解 Intent、列出不確定性、Clarification Policy、Capability selection、composition | 先得到 Resolved Intent，再產生正確 Blueprint Candidate |
| **Model Gateway** | LLM routing / adapter / fallback | 可依能力、成本、速度切模型而不改核心 |
| **Capability Fabric** | 定義 appf2 可執行能力 | Compiler、Validator、Runtime 共用同一能力真相 |
| **L3 LegoSpec Validation** | schema、semantic boundary、security、compatibility | 只有可信任 Blueprint 可進 Runtime |
| **L4 Universal Runtime** | state、rules、actions、views、effects | Browser 端低成本、可重播的互動 App |
| **State / Identity / Evidence** | Blueprint、Instance、result、lineage、anonymous/account evidence | Share、Remix、Reuse、Ownership 與改善證據 |
| **Result Quality Loop** | User 對執行結果提出「邏輯不對／結果差太多」的修正 | 保留舊版，只修相關語意，產生可比較、可回退的新 Blueprint |
| **Recovery System** | error classification、context preservation、next action | 不 White Screen、不丟工程碼、不讓 User 全部重來 |
| **External Capability Plane** | AI / API / payment / booking / heavy compute | 只有需要時才離開 local Runtime |

---

# 4. 核心系統邊界

## 4.1 Experience Shell / 靈感精靈

它不是另一個 Semantic Engine，而是 **Creation + Recovery Experience Layer**。

~~~text
Inspiration Capsules
+ Ghost Text
+ Fork & Remix
+ Progressive Refinement
+ Humanized Recovery
~~~

核心學習循環：

~~~text
Copy
→ Modify
→ Generate
→ Use
→ Remix
→ Create
~~~

原則：

> **先完成，再學會；不是先學會，才能完成。**

---

## 4.2 四層 Intent-to-App Engine

~~~mermaid
flowchart LR
    A["L1<br/>接住需求"] --> B["L2<br/>理解需求"] --> C["L3<br/>確認可安全執行"] --> D["L4<br/>把 App 跑起來"]
~~~

### L1 — Ingestion & Routing

~~~text
Intent
→ Safety / Policy / Quota
→ Trusted Reuse Lookup
→ Route
~~~

不理解自由文字業務語意。

結果：

> **把請求送到正確地方，並保留 Recovery Context。**

### L2 — Semantic Compiler

L2 不允許直接把模糊 Prompt 一步生成 Blueprint。

正式路徑：

~~~text
Raw Intent
→ Intent Analysis
→ Structured Intent Envelope
→ Clarification Policy
   ├─ READY
   ├─ READY_WITH_VISIBLE_ASSUMPTIONS
   └─ NEEDS_CLARIFICATION
→ Resolved Intent
→ Capability Resolution
→ Compose State / Rule / Action / Event
→ Blueprint Candidate
~~~

分工：
- LLM 負責理解 Intent、列出 missing / ambiguity / assumption。
- appf2 Clarification Policy 負責決定「直接做、顯示假設、還是必須追問」。
- Experience Shell 負責把問題與 Visible Assumptions 用可修改 UI 呈現。
- material assumption 必須有來源，不可把 LLM 建議冒充 User 事實。

結果：

> **先得到可信任的 Resolved Intent，再產生 Blueprint。**

Clarification Gate 每次都執行，但只有關鍵資訊不足時才打斷 User。

### L3 — LegoSpec Contract + Validation

驗證：

- schema
- capability reference
- state / binding / rules
- resource bounds
- permission
- compatibility
- degradation honesty
- security

結果：

> **不可信的 Candidate 絕不進 Runtime。**

### L4 — Universal Runtime

~~~text
Hydrate
→ State
→ Action
→ Rule / Capability
→ View
→ Effect
~~~

正常 deterministic interaction：

> **預設 0 LLM call。**

Runtime 不猜 Intent、不選模型、不發明 Capability、不執行 arbitrary generated code。

# 5. Model Gateway：LLM 可自由切換

Model Gateway 屬於 L2。

~~~mermaid
flowchart LR
    C[Semantic Compiler] --> R[Model Router]
    R --> I[appf2 Model Interface]
    I --> A[Provider A]
    I --> B[Provider B]
    I --> C2[Provider C]
~~~

Model Router 可依：

- model capability
- structured output support
- latency
- cost
- quota
- availability
- fallback policy

選擇模型。

架構規則：

> **LegoSpec、Capability Fabric、Runtime 永遠不依賴特定 LLM Vendor。**

Provider failure 可以切模型，但新輸出仍必須重新通過 L3 Validation。

---

# 6. Capability Fabric：appf2 真正會做什麼

Capability Fabric 不是第五層，而是 L2／L3／L4 共用的能力真相。

~~~mermaid
flowchart TB
    F[Capability Fabric]
    F --> C["L2<br/>何時該用"]
    F --> V["L3<br/>是否合法"]
    F --> R["L4<br/>如何執行"]
~~~

同一份 canonical source 應產生：

~~~text
Compiler Metadata
+ Validation Contract
+ Runtime Registration
+ Compatibility Metadata
~~~

詳細能力 Contract、Maturity、1／3／6 個月發展：

- working/common-core/CAPABILITY-FABRIC.md

---

# 7. User 要的東西 appf2 不會怎麼辦？

任何 Intent 必須先得到 Capability Coverage 結論：

~~~text
FULLY_SUPPORTED
PARTIALLY_SUPPORTED
EXTERNAL_OR_HEAVY_REQUIRED
UNSUPPORTED
~~~

~~~mermaid
flowchart TD
    I[Intent] --> C{Capability Coverage}
    C -->|Full| F[Generate Correct App]
    C -->|Partial| P["保留核心語意<br/>明確標示降級"]
    C -->|External / Heavy| E["說明 Cost / Time / Permission<br/>User 選擇"]
    C -->|Unsupported| U["不亂做<br/>解釋缺口 + Refine / Alternative"]
    U --> G[Capability Gap Evidence]
    G --> N[Future Capability POC]
~~~

核心規則：

> **做不到可以承認；不能解錯問題還假裝成功。**

Capability Gap 是 Product / Capability Roadmap 的 Evidence。

---

# 8. 六條核心產品流程

## Create

~~~text
Inspiration / Intent
→ Route
→ Analyze Intent
→ Clarification / Visible Assumptions if needed
→ Resolve Intent
→ Compile
→ Capability Resolution
→ Validate
→ Blueprint
→ Runtime
~~~

結果：**Intent → Correct App**

## Use

~~~text
Existing Blueprint
→ Resolve
→ Trust / Compatibility Check
→ Browser Runtime
→ Local Interaction
~~~

結果：**既有 App 不重新 Compile。**

## Share

~~~text
Blueprint / Share Reference
→ Recipient Open
→ Restore
→ Execute
~~~

結果：**No install，且 First Value 前盡量 No login。**

## Remix / Refine

~~~text
Existing Blueprint
+ User Change
→ Semantic Delta
→ Compile / Validate
→ New Immutable Blueprint
~~~

結果：**每個 App 都能成為下一個創作起點。**

## Result Feedback / Logic Correction

這條路徑處理一種特別重要的情況：

> **App 可以正常執行，但邏輯、假設或結果和 User 想要的差很多。**

這不是 Runtime Error，也不能當成「既然有畫面就算成功」。

~~~mermaid
flowchart LR
    A["Current Blueprint<br/>+ Current Result"]
    B["User: 調整邏輯 / 結果不對"]
    C["Preserve Current App<br/>+ Inputs + Result"]
    D["Correction Intent"]
    E["L2 Semantic Delta<br/>only affected logic"]
    F["L3 Full Revalidation"]
    G["New Immutable Blueprint"]
    H["Re-run / Compare"]
    I{"User satisfied?"}

    A --> B --> C --> D --> E --> F --> G --> H --> I
    I -->|Yes| J[Continue / Share / Remix]
    I -->|No| D
    H --> K[Return to Previous Version]
~~~

Architecture rules：

1. **舊 Blueprint 不直接修改**；修正會產生新的 immutable revision。
2. **保留目前輸入與結果**，User 不需要重新填一次。
3. User feedback 先變成 **Correction Intent**，再由 L2 產生受控 Semantic Delta。
4. 只修改相關邏輯，但新 Blueprint 仍必須完整經過 L3 Validation。
5. 新舊結果要能比較，並保留返回舊版的能力。
6. User 說「結果不對」屬於 Semantic / Product feedback，不應被誤分類成 500 error。
7. Correction outcome 要成為 Evidence，用來改善 Compiler、Blueprint Family 與 Capability selection。

結果：

> **appf2 不只負責「App 能跑」，還要負責讓 User 能低摩擦地把 App 修到符合意圖。**

## Error / Recovery

~~~text
Technical Failure
→ Classify
→ Recovery Policy
→ Preserve Context
→ Humanized Message
→ Useful Next Action
~~~

結果：**失敗不等於流程終止。**

---

# 9. Humanized Recovery

內部可以有：

~~~text
401 / 402 / 404 / 500
timeout
provider failure
validation failure
runtime exception
~~~

一般 User 不應直接看到工程語言。

Recovery UX 必須回答：

> **發生什麼？我們保留了什麼？你現在可以做什麼？**

| Internal | User Experience |
|---|---|
| 401 | 需要登入才能繼續 + Sign in |
| 402 / entitlement | 此能力需要額外額度 + Alternative / Continue |
| 404 | 此 App 連結失效或找不到 + Back / Recreate |
| Compiler timeout | 需求已保留 + Retry |
| Capability Gap | 哪部分目前做不到 + Refine / Alternative |
| Component crash | 隔離壞區塊，其他 App 繼續 |

Recovery Guardrails：

~~~text
Never White Screen
Never Raw Error as Consumer UX
Preserve Input
Always Offer a Next Action
Bounded Retry
No Fake Success
~~~

---

# 10. State Model

必須分離：

~~~text
Blueprint
= immutable App definition

Instance
= current runtime state

Context
= approved cross-App data

Delta
= controlled change

Result Snapshot
= 某個 Blueprint + Instance 在特定輸入下產生的結果快照

Correction Intent
= User 對「哪裡不對、希望怎麼改」的語意回饋

Recovery Context
= original Intent / input / partial progress
~~~

Identity 路徑：

~~~text
Phase 1
anonymous_id + evidence

Month 2–3
anonymous_id
→ authenticate
→ ownership claim
→ user_id
~~~

Blueprint content、ownership、Instance state 不混成一個 object。

Result Correction 的關係：

~~~text
Blueprint Revision A
+ Instance Inputs
→ Result Snapshot A
→ User Correction Intent
→ Semantic Delta
→ Blueprint Revision B
→ Same / Preserved Inputs
→ Result Snapshot B
→ Compare / Accept / Revert
~~~

因此「Runtime 算出的結果」與「User 認為結果正確」是兩件不同的事。

---

# 11. Architecture Evolution Index

Phase 是本 canonical architecture 的 **applicability / activation metadata**，不是另一組檔案或第二份 SSOT。

本檔後段保留四個 evolution sections：
- `appf2 Architecture Evolution — Phase 1`：Core Proof。
- `appf2 Architecture Evolution — Phase 2`：Reuse / Identity / Creator。
- `appf2 Architecture Evolution — Phase 3`：Scale Readiness。
- `appf2 Architecture Evolution — Phase 4+`：Intent Commerce / Capability Network / Orchestration。

共用 architecture invariants 只在前段定義一次；Phase section 只能描述新增 / 啟用 / defer 的 architecture delta，不複製 shared core。

> 日期本身不啟用 implementation scope；實際 inclusion 由 Evidence + Human approval + Build Freeze 決定。

# 12. 什麼保持不變？什麼可以演進？

## 必須保持不變的核心

~~~text
Intent → Blueprint → Runtime
Capability allowlist
No arbitrary code
Blueprint / Instance separation
Share / Remix first-class
Humanized Recovery
Vendor abstraction
~~~

## 可以隨 Evidence 演進

~~~text
LLM provider
Capability catalog
Cache strategy
Realtime provider
Storage provider
Retrieval method
Paid model
External providers
Orchestration backend
Provider discovery / routing
Commerce mechanics
~~~

這個分法是避免未來每三個月重寫一次 appf2 的關鍵。

---

# 13. Architecture Guardrails

1. LLM 不得把模糊 Intent 直接腦補成 Blueprint。
2. Clarification Policy 是 appf2-owned quality gate，LLM 不得 bypass。
3. Material assumption 必須可見、可修改、有 provenance。
4. LLM 只在 Resolved Intent 後產生受控 Blueprint。
5. Runtime 不做 free-form Intent inference。
6. Capability Fabric 是唯一可執行能力邊界。
7. Schema Valid ≠ Semantic Correct。
8. Unsupported Intent 不得 fake success。
9. LLM Vendor 必須藏在 Model Gateway 後。
10. Blueprint / Instance / Context / Delta / Recovery Context 分離。
11. Existing Blueprint 正常 interaction 預設 0 LLM。
12. Share / Remix / Result Correction 都是核心產品路徑。
13. Runtime Success 不等於 Semantic Success；User 必須能修正邏輯並比較／回退結果。
14. Error code 不是 Consumer UX。
15. Component failure 不得造成整頁 White Screen。
16. Heavy / Paid / External Work 必須經 Capability Boundary。
17. 中長期只能擴張核心，不能繞過核心另建第二套 Runtime。
18. Multi-capability workflow 必須經 appf2-owned Orchestration Contract；workflow vendor 不得成為核心語意。
19. Async / external step 必須有 timeout、retry、idempotency、compensation 或明確 failure policy。
20. Provider Network 必須建立在 certification、compatibility、evidence 與可治理 routing 上，不以 API 數量當可用供給。
21. Product Evidence 決定何時解鎖下一階段。

---

# 14. 文件責任

~~~text
APP-ARCHITECTURE.md
→ 系統、責任、流程、演進

core/BUSINESS-PLAN.md
→ 商業假設、價值、Evidence Gate、時間軸

core/CAPABILITY-FABRIC.md
→ 能力 Contract、Coverage、Maturity、能力演進

INFRA-ARCHITECTURE.md
→ Browser / Edge / Serverless / DB / External Service

APP-DETAILED-DESIGN-OVERVIEW.md
→ Function Map、依賴、Acceptance、Release Plan

working/detailed-design/functions/
→ 單一 Function 的可實作規格
~~~

# 結論

appf2 的 App Architecture 應該讓團隊永遠能回答：

~~~text
appf2 有什麼？
→ Experience + Engine + Fabric + Runtime + Evidence + Recovery

誰負責什麼？
→ Compiler 理解，Fabric 限制，Validator 信任，Runtime 執行

結果不對怎麼辦？
→ 保留舊版與輸入 → Correction Intent → Semantic Delta → 新版比較 / 回退

出錯怎麼辦？
→ 誠實降級、保留 Context、人話 Recovery

怎麼成長？
→ 1 月證明核心
→ 3 月建立 Reuse / Identity / Creator
→ 6 月證明 Scale / External Paid Capability
→ 6 月後持續建立 Commerce / Network / Orchestration
~~~

> **核心架構穩定，能力與商業層逐步長大。**


---

# Architecture Evolution Sections

> Consolidated canonical content。Phase 1 = current Build Freeze candidate；later Phase sections remain deferred until Evidence + Human approval.

# appf2 Architecture Evolution — Phase 1

> Canonical Role：Phase 1 architecture additions / activation only. Shared architecture invariants remain in `working/common-core/APP-ARCHITECTURE.md`.

## 0–1 個月：Core Proof

必須穩定：

- Experience Shell
- L1–L4
- Model Gateway basic adapter
- core Capability Fabric
- Blueprint / Instance
- Share / Restore
- Remix
- Result Feedback / Logic Correction
- Anonymous Evidence
- Humanized Recovery

架構 Gate：

> **能做的 Intent 做對；結果不對時能低摩擦修正；不能做的誠實處理；正常 Interaction 不依賴 LLM。**

不先做：
- Marketplace
- dedicated vector DB
- large realtime infrastructure
- complex provider network


---
