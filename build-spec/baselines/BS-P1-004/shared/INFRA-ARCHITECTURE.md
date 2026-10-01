# appf2 Infrastructure Architecture

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：Current Working Baseline / POC。本文是 appf2 Infrastructure 的設計方案，不是討論紀錄。目標是在 **短期最低成本驗證核心循環** 的同時，不阻斷中期 Reuse / Identity / Creator Value 與長期 Intent Commerce / Capability Network。

# 1. Architecture Decision

appf2 採用：

> **Browser Runtime + Global Edge Control Plane + PostgreSQL System of Record + Pluggable External Capability Plane**

Phase 1 建議實作組合：

| Layer | Phase 1 Baseline |
|---|---|
| Web / CDN | Cloudflare Pages / Static Assets |
| Edge / Serverless API | Cloudflare Workers |
| Runtime | Browser-side React Universal Runtime |
| Durable Database | Supabase PostgreSQL |
| LLM | Provider Adapter，僅由 Serverless Compiler 呼叫 |
| Capability Registry | Versioned code/build artifact |
| Blueprint Cache | Content-hash URL + CDN immutable cache |
| Identity | First-party anonymous ID |
| Telemetry | Batched meaningful events → Postgres |
| Auth / Realtime / Storage | 先不啟用；需要時沿用 Supabase 能力 |
| Queue / Worker / Vector DB | Phase 1 不建立 |

這不是因為 Cloudflare 或 Supabase 是產品核心，而是目前這個組合最符合：

- No install；
- Client-first；
- Compile Once → Reuse Many → Execute Locally；
- Anonymous-first；
- Share / Remix；
- 低固定成本；
- 小團隊低維運；
- 未來可逐層擴張；
- 不把 Protocol 綁死在單一 Vendor。

---

# 2. 設計原則

## 2.1 Runtime 與 Control Plane 分離

appf2 最大量的互動應發生在 Browser：

~~~text
Button
Dice
Wheel
Timer
Form
Rule
Animation
State Transition
        ↓
Browser Runtime
~~~

Server 不應成為每次互動的中介。

Server / Edge 只處理：

~~~text
Compile
Validate
Resolve
Share
Identity
Telemetry
External Capability
Durable State
~~~

核心原則：

> **Serverless 不是把傳統 Server 換個名字；真正省成本的是讓大部分 Runtime 根本不需要 Server。**

---

## 2.2 Expensive Path 與 Cheap Path 分離

### Cold Path

~~~text
Intent
 → Edge Gate
 → Reuse Lookup
 → Semantic Compiler
 → Validation
 → Blueprint
 → Store
 → Browser Runtime
~~~

主要成本：
- LLM；
- validation；
- durable write。

### Warm Path

~~~text
Blueprint Hash / Share Reference
 → CDN / Edge
 → Blueprint
 → Browser Hydration
 → Local Execution
~~~

主要目標：

> **0 runtime LLM call for normal deterministic interaction**

### Heavy Capability Path

~~~text
Runtime Action
 → Capability Gateway
 → External Provider / Worker
 → Result
 → Validated State Update
~~~

只有真的需要 AI、media、booking、payment、specialized compute 才進這條路。

---

# 3. 整體架構圖

~~~mermaid
flowchart TB
    USER[User / Shared Recipient]

    subgraph RUNTIME["Browser Runtime Plane"]
        WEB[React Web App]
        PLAYER[Universal Runtime]
        CAP[Capability Runtime]
        RULE[Rule VM]
        STATE[Instance State]
        LOCAL[Local Cache / Recovery]
    end

    subgraph EDGE["Global Edge Control Plane - Cloudflare"]
        CDN[Static Assets / CDN]
        ROUTER[Edge Router / Policy / Quota]
        COMPILER[Compiler API]
        VALIDATOR[Blueprint Validation]
        RESOLVER[Blueprint / Share Resolver]
        EVENTS[Telemetry Intake]
        GATEWAY[External Capability Gateway - later]
    end

    subgraph DATA["Durable State Plane - Supabase"]
        PG[(PostgreSQL)]
        AUTH[Auth - activate later]
        REALTIME[Realtime - activate later]
        STORAGE[Object Storage - activate later]
        VECTOR[pgvector - activate later]
    end

    subgraph EXT["External Capability Plane"]
        LLM[LLM Provider]
        EXTAPI[AI / Search / Booking / Payment / Media / Other API]
    end

    USER --> CDN
    CDN --> WEB
    WEB --> PLAYER
    PLAYER --> CAP
    PLAYER --> RULE
    PLAYER --> STATE
    PLAYER --> LOCAL

    WEB --> ROUTER
    ROUTER --> COMPILER
    COMPILER --> LLM
    COMPILER --> VALIDATOR
    VALIDATOR --> PG

    WEB --> RESOLVER
    RESOLVER --> PG

    WEB --> EVENTS
    EVENTS --> PG

    PLAYER -. only when required .-> GATEWAY
    GATEWAY -. later .-> EXTAPI

    PG -. middle term .-> AUTH
    PG -. middle term .-> REALTIME
    PG -. middle term .-> STORAGE
    PG -. reuse evidence .-> VECTOR
~~~

重點：

> **Phase 1 實際必須運行的只有 Browser + Cloudflare Edge/Serverless + PostgreSQL + LLM。**

圖中的 Auth、Realtime、Storage、Vector、External Gateway 是相同架構的擴張點，不是 Phase 1 dependency。

---

# 4. Detailed Infrastructure Owner / Phase Applicability

Shared topology、plane separation、vendor boundary 與 anti-patterns 只在本文定義一次。

所有 detailed infrastructure baseline 由單一 canonical owner 管理：

~~~text
working/detailed-design/infrastructure/INFRASTRUCTURE-DETAILED.md
~~~

該檔內以 section 區分：
- Phase 1：目前 Build Freeze candidate。
- Phase 2：deferred。
- Phase 3：deferred。
- Phase 4+：deferred。

Phase 不再形成平行 infrastructure files；future provider / storage / scaling content 只有在 Evidence + Human approval + Build Freeze inclusion 後才成為 implementation scope。

# 5. Vendor Lock-in Boundary

以下不能出現在 LegoSpec 核心語意中：

- Cloudflare Worker；
- Supabase table/API；
- specific LLM vendor；
- realtime vendor；
- payment vendor；
- object-storage vendor。

必須經過 appf2-owned interfaces：

~~~text
CompilerAdapter
BlueprintRepository
IdentityProvider
RealtimeProvider
ObjectStore
CapabilityProvider
PaymentProvider
WorkflowEngineAdapter
ProviderRegistry
TelemetrySink
~~~

所以 Phase 1 可以選成本最低、開發最快的 Vendor，中長期需要更換時不用重寫 Blueprint / Runtime。

---

# 6. 不建議的架構

Phase 1 不建議：

## 全部 Server-side Rendering / Server Runtime

會讓每個互動都變成 backend cost，與 appf2 核心相反。

## Kubernetes / Microservices

目前沒有 traffic / team / isolation 證據支持這個 operational cost。

## 一開始使用多種 Database

Postgres 已足以支援 POC、中期 identity/reuse 與早期 commerce metadata。

## 一開始建 Dedicated Vector DB

沒有 Blueprint corpus 與 reuse evidence 前是 premature optimization。

## 一開始建 Edge KV as source of truth

KV 適合 cache，不適合 ownership / lineage / commerce truth。

Phase 1 mutation idempotency也不以 Edge KV作 canonical truth；使用 PostgreSQL bounded `idempotency_operation`，Edge未來只可作 acceleration。

## 一開始把所有 Capability 做成 Remote Service

會犧牲成本、latency、offline-ish local interaction 與 composability。

---

# 8. 最終 Architecture Thesis

appf2 最成本有效的架構，不是找到一個「最便宜的 Cloud」。

真正的成本優勢來自：

> **把 Semantic Intelligence 集中在 Compile，把大量 Interaction 留在 Browser，把 Durable Truth 集中在 Postgres，把 Heavy / Paid Work 明確切成 Capability。**

因此目前推薦基準：

> **Cloudflare Edge/Serverless + Supabase Postgres + Browser Runtime**

是 Phase 1 很適合的組合。

更重要的是，真正需要保護的不是 Vendor choice，而是這四個邊界：

1. **Runtime Plane** — 本地、安全、便宜。
2. **Edge Control Plane** — 無狀態、按需、全球。
3. **Durable State Plane** — PostgreSQL 為真實來源。
4. **External Capability Plane** — Heavy / Paid / Commerce 可插拔。
5. **Orchestration Plane** — 多步、非同步、跨 Provider 工作流可恢復、可替換、可治理。

只要這四個邊界保持穩定，appf2 可以從 POC 走到 Reuse / Creator，再走到 Intent Commerce / Capability Network / Heterogeneous Orchestration，而不需要中途推翻整套 Infrastructure。
