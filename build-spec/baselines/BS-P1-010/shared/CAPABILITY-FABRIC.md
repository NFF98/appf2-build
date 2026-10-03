# appf2 Capability Fabric

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：Working Architecture Baseline。本文定義 appf2 的原子能力模型、Capability Card Contract、成熟度、Coverage Resolution 與 1／3／6 個月發展策略。Capability Fabric 是產品能力邊界，不是 Component 清單。

# 1. Capability Fabric 是什麼

Capability 是 appf2 可以被 Compiler 理解、被 Blueprint 引用、被 Validator 驗證、被 Runtime 安全執行的原子能力。

~~~text
Intent
→ Capability Selection
→ Composition
→ State / Rule / Event Wiring
→ Blueprint
→ Runtime
→ Use / Share / Remix
→ Evidence
~~~

Capability Fabric 要同時回答：

1. **appf2 理論上想會什麼？**
2. **appf2 現在真的可靠會什麼？**
3. **哪些能力值得繼續投資？**
4. **哪些能力未來可以變成 Creator / Paid / External Capability？**

核心原則：

> **考慮未來，不等於現在實作未來。**

---

# 2. Capability Card Contract

每張 Capability Card 從 Day 1 都用同一個概念模型：

~~~text
Capability Card
├─ Identity / Semantic
├─ Technical Contract
├─ Product Contract
├─ Identity / Ownership Hooks
├─ Reuse / Creator Hooks
├─ Commerce / Network Hooks
├─ Evidence
└─ Maturity
~~~

Phase 1 只實作當下需要的欄位，但 Contract 不能把中長期鎖死。

---

## 2.1 Identity / Semantic

每張 Card 必須定義：

- Capability ID
- Name / Type
- Family
- Semantic Meaning
- Intended Intent Classes
- Compiler Selection Hints
- Version
- Compatibility

目的：

> Compiler 必須知道「什麼時候該用」，而不是只知道有哪些 props。

---

## 2.2 Technical Contract

定義 Runtime 真正可以做什麼：

- Inputs / Outputs
- State Contract
- Actions
- Events
- Rules / Operators
- Bindings
- Dependencies
- Runtime Support
- Fallback / Degradation
- Permission
- Security Class
- Resource Budget
- Cost Class
- Determinism / Replay
- Tests

任何 Capability 都不能提供 arbitrary code escape hatch。

---

# 3. Product Contract：五個產品原則進入原子層

每張 Capability 都要回答五組問題。

## No install setup

- Browser 是否直接可用？
- 是否需要 permission？
- 是否依賴 native install？
- permission 拒絕後怎麼 degrade？
- recipient 是否能直接打開使用？

## Everyone is the creator

- Compiler 能否理解何時選它？
- 哪些參數對使用者有意義？
- 是否支援 Remix？
- 是否可以安全複製與重新組合？
- 是否需要專業設定？

## Sharable, linkable

- 哪些 config / state 可 serialization？
- 哪些資料禁止分享？
- 是否可 portable restore？
- 是否 deterministic restore？
- 是否有 sensitive field？

## Intent Commerce

Day 1 Contract 要能表達，但 Phase 1 不一定啟用：

- Cost Class
- Entitlement Class
- External Provider
- Transaction Capability
- Metering Hook
- Provider Identity
- Policy / Quota

## Fun and socialable

Card 應知道自己是否能參與：

- animation / motion
- shared state
- vote / reaction
- score / progression
- room / multiplayer
- collaborative input
- playful presentation

並標註：

- Social Composition Potential
- Realtime Requirement
- Feedback / Motion Hooks

目的：

> Capability Fabric 不能最後只剩 Input + Form + Chart。

---

# 4. Identity / Ownership Hooks

中期目標明確包含 Identity，因此 Capability Card 必須從原子層保留：

- anonymous allowed
- account required
- ownership required
- creator attribution
- recipient permission
- entitlement scope
- persistence class
- private / public eligibility

這不代表 Phase 1 要做 Account System。

它代表：

> Phase 1 做出的 Capability，不應在第 2–3 個月加入 Ownership 時被迫重寫 Contract。

---

# 5. Reuse / Creator Hooks

為 3 個月內的 Reuse / Creator Value 預留：

- Remixability
- Parameterization Surface
- Version Stability
- Backward Compatibility
- Attribution
- Creator-facing Configuration
- Ownership / License Class
- Reuse Telemetry
- Blueprint Lineage Compatibility

目標：

> 一張好 Capability 可以被不同 Blueprint 重複組合，而不是只服務單一 App Template。

---

# 6. Commerce / Network Hooks

為 6 個月後的 Intent Commerce / Capability Network 預留：

- Provider Identity
- Provider Version
- Execution Location
- Auth Requirement
- Pricing / Cost Metadata
- Metering
- Transaction Lifecycle
- SLA / Availability
- Trust / Certification
- Settlement / Revenue Share
- Data Residency / Privacy
- Orchestration Role / Step Type
- Async / Long-running Support
- Retry / Timeout Policy Class
- Compensation / Rollback Support
- Idempotency Requirement
- Dependency / Precondition Metadata

核心原則：

> 未來 Internal、Paid、External Capability 必須共用同一套 Blueprint / Registry / Runtime 語意。

不能為 Commerce 再建立第二套 App Runtime。

---

# 7. Evidence Contract

每張 Capability 從 POC 就要留下最小必要 Evidence：

- selected / rejected
- execution success / failure
- validation failure
- semantic mismatch
- user correction
- share
- recipient use
- remix
- reuse
- latency
- resource cost
- external cost
- recovery outcome

Evidence 要回答：

> **這個 Capability 是否真的讓 appf2 更能把 Intent 變成正確、有用、可分享、可 Remix 的 App？**

---

# 8. Capability Maturity

所有 Capability 都必須有成熟度：

~~~text
PROPOSED
↓
POC
↓
BUILT
↓
TESTED
↓
VALIDATED
↓
RELEASED
~~~

## PROPOSED
設計概念，沒有執行證據。

## POC
最小可行實驗，證明技術與組合方式可能成立。

## BUILT
已有 Runtime implementation。

## TESTED
已通過：
- contract
- runtime
- security
- resource
- composition tests

## VALIDATED
除了技術測試，真實產品 Evidence 也顯示：
- Compiler 能合理選它
- semantic outcome 正確
- use case 有用
- share / remix 行為成立

## RELEASED
已進正式 Capability Registry：
- stable version
- compatibility policy
- telemetry
- production acceptance

核心規則：

> **Build ≠ Validated。**
>
> **Render ≠ Intent Success。**

---

# 9. Capability Coverage Resolution

Layer 2 對任何 Intent 都必須得到明確 Coverage 結論：

~~~text
FULLY_SUPPORTED
PARTIALLY_SUPPORTED
EXTERNAL_OR_HEAVY_REQUIRED
UNSUPPORTED
~~~

## FULLY_SUPPORTED
現有 Capability 足以保持核心語意。

## PARTIALLY_SUPPORTED
只有在核心語意仍成立時才能降級。

例如：
- 3D 視覺降成 2D，但遊戲規則完全保留。

不能：
- 把完全不同的計算器冒充原需求。

## EXTERNAL_OR_HEAVY_REQUIRED
需要 external API、AI、media、payment、booking、heavy compute 等。

必須先表達：
- permission
- latency
- cost
- entitlement

再由使用者選擇。

## UNSUPPORTED
沒有 Capability 能保持核心意圖時：

- 不亂做
- 保留原 Intent
- 解釋缺口
- 提供合理 refinement / alternative
- 記錄 Capability Gap

~~~text
Capability Gap
→ Evidence
→ Product Review
→ PROPOSED
→ POC
→ Build / Test
→ Validated
~~~

真實 Intent 反過來決定 Fabric 怎麼長。

---

# 10. Capability Families

這是 Target Capability Space，不代表目前已完成。

## A. Interface / Layout
Text、Button、Card、Container、Grid、Tabs、Modal、List、Form Controls、Navigation。

## B. Data / Visualization
Stat、Table、Chart、Timeline、Progress、Ranking、Comparison、Map、Calendar、Graph。

## C. Game / Interaction
Random、Dice、Wheel、Card、Player、Team、Turn、Round、Score、Timer、Progression。

## D. Animation / Motion
Transition、Lottie、Particle、Confetti、State-driven Motion、Gesture。

## E. Audio / Video
Image、Audio、Video、Camera、Recorder、Playlist、Subtitle、Media Cue。

## F. 2D / 3D Spatial
Controlled 2D Canvas、3D Scene / Model、Camera、Lighting、Hotspot、Object Interaction。

## G. Device / Sensor
Camera、Microphone、Location、Motion、Orientation、File、Clipboard、QR / Barcode、Haptic。

## H. Realtime / Social
Room、Presence、Shared State、Vote、Shared Score、Turn Sync、Collaborative Input、Broadcast。

## I. AI / External
Text / Image / Speech AI、Search、Translation、External API、Data Provider、Specialized Compute。

## J. Future Spatial / XR
WebXR、Immersive Scene、Spatial Anchor、Gaze、Controller、Shared Spatial State。

---

# 11. Capability Phase Roadmap Index

Capability Card Contract、Maturity、Coverage、Families 與 Registry Architecture 只在本檔定義一次。

本檔後段的 Phase sections只描述 capability portfolio 的新增 / maturity target / defer：

- `appf2 Capability Roadmap — Phase 1`：Core Capability Set。
- `appf2 Capability Roadmap — Phase 2`：Reuse / Identity / Creator。
- `appf2 Capability Roadmap — Phase 3`：Scale Readiness / External Capability Pilot。
- `appf2 Capability Roadmap — Phase 4+`：Capability Network + Orchestration。

> Phase 不是第二份 registry；Capability 是否可進 release 由 maturity evidence、compatibility與 Human-approved Build Freeze inclusion共同決定。

# 12. Capability Portfolio 管理

Capability 不以「想到就加入」管理。

每張 Card 至少有：

| 欄位 | 用途 |
|---|---|
| Capability ID | 穩定身份 |
| Family | 能力分類 |
| Target Horizon | 1m / 3m / 6m / 6m+ |
| Maturity | PROPOSED → RELEASED |
| Product Fit | 支援哪些 Intent / 五原則 |
| Runtime Cost | local / server / external |
| Evidence | 使用與錯誤證據 |
| Compatibility | Blueprint / Runtime 版本 |
| Owner / Status | 後續 execution 管理 |

Portfolio Review 優先順序：

~~~text
Real Intent Demand
× Composition Density
× Semantic Reliability
× Share / Remix Value
× Cost Efficiency
÷ Complexity / Risk
~~~

不以「Capability 數量」當進度 KPI。

---

# 13. Registry Architecture

Phase 1 Registry 應是：

> **Versioned canonical source → generated artifacts**

同一來源產生：

~~~text
Compiler Semantic Metadata
Validator Schema
Runtime Registration
Docs / Tests
Compatibility Metadata
~~~

不能讓 Compiler、Validator、Runtime 各有一份手工能力清單。

3 個月內仍以這個 static trusted registry 為主。

6 個月後如果第三方 provider 成立，再演進為：

~~~text
Static Trusted Registry
+
Dynamic Certified Provider Registry
+
Orchestration Metadata / Compatibility Graph
~~~

---

# 14. Capability Guardrails

1. Capability ≠ UI Component。
2. Capability 必須有 semantic meaning。
3. 不允許 arbitrary generated JS / eval / new Function。
4. Runtime 只執行 Registry 允許能力。
5. Capability 必須能被版本化與測試。
6. Share / Remix 邊界從 Card Contract 定義。
7. Identity / Ownership Hooks 從 Day 1 預留。
8. Paid / External Hooks 從 Day 1 可表達，但不要提前實作。
9. Unsupported Intent 不能 fake success。
10. Capability Gap 是 roadmap input。
11. Realtime / AI / Media / Commerce 都是 Capability，不是繞開 Runtime 的特例。
12. Capability Network 只有 6 個月後、供需成立時才升級成主要平台能力。
13. Multi-step workflow 必須由 appf2 Orchestration Contract 描述，不能依賴某個 workflow vendor 的私有 DSL。
14. n8n / Temporal / Queue / Worker 類工具只能是可替換 execution backend。
15. Provider 數量不是護城河；可被 Compiler 發現、可驗證、可組合、可觀測、可結算才算有效供給。

# 結論

Capability Fabric 的發展順序：

~~~text
1 個月
少量高密度、安全、可組合 Capability

3 個月
讓它們可 Reuse / Remix / Own / Publish

6 個月
證明 External / Paid Capability 可安全加入

6 個月後
逐步建立 Capability Network + Heterogeneous Orchestration
~~~

> **appf2 的能力壁壘不在「有多少元件」，而在「可靠能力能否被 Compiler 正確發現、組合、編排並交付可驗證 Outcome」。**


---

# Capability Roadmap Sections

> Consolidated canonical roadmap。Future capability maturity / release activation仍需 Evidence + Human approval.

# appf2 Capability Roadmap — Phase 1

> Shared capability contract：`working/common-core/CAPABILITY-FABRIC.md`

# 11. 0–1 個月：Core Capability Set

第 1 個月不追求能力數量，而追求高組合密度。

優先候選：

~~~text
Layout / Container
Text / Card / List
Button
Number / Text / Select / Toggle
Stat / Basic Table / Basic Chart
Random / Dice / Wheel
Timer / Score / Simple Turn
Basic Image / Audio / Video playback
Basic Animation / Confetti
Shareable State
Recovery / Notice presentation
~~~

選擇標準：

1. 能服務多種 Intent
2. Semantic Meaning 清楚
3. 容易安全組合
4. Browser 可低成本執行
5. Compiler 能合理選擇
6. Share / Remix 有意義
7. 可測試、可版本化

第 1 個月目標不是全部 RELEASED。

合理目標是：

> **少量核心 Capability 至少到 TESTED，關鍵 Capability 開始累積 VALIDATED Evidence。**

---


---
