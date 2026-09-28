# appf2 Canonical Data Model

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：Working Current Truth — Shared Data Model Index / Invariants。本文只保留跨 Phase 不應重複的資料原則；Phase-specific schema / tables / migration additions 拆到 `working/detailed-design/data-model/`。
> Build Freeze / delivery governance：`working/common-core/DESIGN-TO-DELIVERY.md`。
>
> Delivery / Traceability 規則以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準；Infrastructure boundary 以 `working/common-core/INFRA-ARCHITECTURE.md` 為準。

# 1. Purpose

這份文件回答：

~~~text
什麼資料是 appf2 的 durable truth？
哪些只存在 Browser？
哪些資料 immutable？
Share / Remix / Correct 怎麼關聯？
哪些資料可進 PostgreSQL？
哪些資料不能被無限制收集？
未來 Identity / Reuse / pgvector 怎麼接而不推翻 Phase 1？
~~~

它不是：

- F01 的 Intent payload schema；
- F02 的完整 LegoSpec schema；
- F03 的 Runtime state machine；
- F07 的完整 telemetry event catalog；
- Database migration script。

上述內容由各 Function / Spec 承接，但不得違反本文。

---

# 2. Canonical Data Principles

## DM-P01 — PostgreSQL = Durable Truth

Phase 1 的 durable truth 存 PostgreSQL。

~~~text
Browser
= fast / local / ephemeral runtime state

PostgreSQL
= durable artifact / lineage / share / evidence truth
~~~

Browser local state 不能成為 ownership、share lineage、validated Blueprint 或 correction history 的唯一真相。

## DM-P02 — Blueprint Immutable

Validated Blueprint content 一旦以 content hash 保存，不得原地修改。

~~~text
Blueprint A
→ Refine / Remix / Correct
→ Blueprint B
~~~

B 是新 content；A 保留。

## DM-P03 — Blueprint / Instance / Result / Context / Delta 分離

~~~text
Blueprint
= immutable app definition

Instance
= current browser runtime state

Result Snapshot
= 特定 Blueprint + 特定 inputs 的可比較結果

Context
= approved cross-app / external context；Phase 1 不建立 durable Context store

Delta
= controlled semantic change；記錄在 Remix / Correction flow，不直接 mutation Blueprint
~~~

## DM-P04 — Durable Only When Product Value Requires It

Phase 1 不把每一次 button click、timer tick、render state 寫進 DB。

只有下列資料預設 durable：

- anonymous continuity；
- Intent / compile lifecycle 的必要記錄；
- validated Blueprint；
- Blueprint lineage；
- durable share reference；
- semantic correction / mismatch evidence；
- meaningful product events。

## DM-P05 — User Content ≠ Telemetry

Raw Intent、Result、User Input 可能含敏感內容。

Telemetry 只能收完成產品判斷所需的最小資料；不得因 debug 方便把 user content 全量複製到 event payload。

## DM-P06 — Vendor Neutral

LegoSpec / Function Contract 不得依賴 Supabase table API。

Application 透過 appf2-owned repository / service interface 使用資料層。

---

# 3. Detailed Data Model Owner / Phase Applicability

Shared invariants 只在本文定義一次；所有 detailed schema 由單一 canonical owner 管理：

~~~text
working/detailed-design/data-model/DATA-MODEL-DETAILED.md
~~~

該檔內以 section 區分：
- Phase 1 Detailed Contract：目前 Build Freeze candidate。
- Phase 2 Extensions：deferred。
- Phase 3 Extensions：deferred。
- Phase 4+ Extensions：deferred。

Phase 是 applicability / activation metadata，不再形成平行 phase files。

> Build Freeze 只包含該次 Human-approved Phase scope；同一 detailed file 中的 future sections 不會因「同檔存在」自動進 implementation scope。
