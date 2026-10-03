# F06 — Remix / Refine

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Existing Blueprint → Semantic Change → New Immutable Blueprint 的 Working Current Truth。
>
> 上游：F00 Experience Shell、F01 Intent Compilation、F02 Blueprint Validation、F03 Runtime、F05 Share / Restore、DATA-MODEL、DESIGN-TO-DELIVERY。
>
> 下游 / collaborators：F07 Evidence、F12 Recovery、F16 Result Correction。
>
> F06 的核心不是修改現有 Blueprint，而是用現有 Blueprint 當 base，將 User 的語意變更重新編譯成新的 immutable Blueprint，並建立可追蹤 lineage。

# 1. Purpose / User Outcome

User Outcome：

> User 不需要從空白重新開始，就能把現在的 App 改成更符合自己的版本；修改失敗時，原本可用的 App 永遠還在。

Canonical flow：

~~~text
Existing Validated Blueprint
+ User Semantic Change
→ F06 Change Context
→ F01 Intent Analysis / Clarification
→ Semantic Delta
→ Resolved Change Intent
→ F04 Capability Coverage
→ F01 Compose Full New Blueprint Candidate
→ F02 Full Validation
→ New Immutable Blueprint
→ blueprint_lineage
→ fresh F03 Runtime Instance
~~~

# 2. Refine vs Remix

## F06-POL-001 — REFINE

REFINE 表示：

> User 想延續目前 active App 的產品意圖，修改其內容、規則、UI、輸入或輸出，並把新版本視為同一條創作脈絡的下一個 derivative。

常見例子：

- 多一個輸入欄位
- 改計算規則
- 調整顯示方式
- 加一個 timer
- 把選項改成另一組

lineage relation：

~~~text
REFINE
~~~

## F06-POL-002 — REMIX

REMIX 表示：

> User 明確以既有 App 為起點，做出自己的衍生版本；通常來自 Shared App，但不要求一定如此。

常見例子：

- 把朋友的聚會轉盤改成公司抽獎
- 把別人的分帳工具改成旅行版
- Fork Capsule / Shared App 再修改

lineage relation：

~~~text
REMIX
~~~

## F06-POL-003 — No Ownership Claim

Phase 1 沒有 durable ownership，因此：

- REFINE 不等於帳戶 owner 修改。
- REMIX 不等於非 owner 才能用。
- 兩者是產品語意與 lineage relation，不是 authorization model。
- F08 才加入 durable ownership / attribution authorization。

# 3. F06 vs F16 Boundary

## F06-POL-004

F06 處理一般「我想改這個 App」。

F16 處理：

> App 技術上能跑，但 User 認為目前結果 / 邏輯不符合原先意圖。

Examples：

~~~text
「加一個參加人數欄位」
→ F06 REFINE

「把這個分享的抽獎器改成部門抽獎」
→ F06 REMIX

「這個分帳結果算錯了，主管應該出兩倍」
→ F16 CORRECT
~~~

若 User 從 F06 入口輸入明確「結果錯了」，F00 可以導向 F16，但不可讓 F06 自己偷偷變成 Correction semantics。

# 4. Preconditions

## F06-RQ-001

Refine / Remix base 必須：

~~~text
blueprint_content exists
AND trust_status = VALIDATED
AND source content_hash known
~~~

如果 base 已 REVOKED / INCOMPATIBLE：

- 不直接以 unsafe Blueprint 作 executable base。
- F12 提供 recovery。
- 「只取 semantic inspiration」的特殊 flow 不在 Phase 1。

# 5. Source Context

## F06-DATA-001

~~~text
ChangeSourceContext
├─ change_kind: REFINE | REMIX
├─ source_blueprint_hash
├─ source_blueprint
├─ source_result_summary?
├─ source_share_id?
├─ source_runtime_inputs?
├─ source_intent_context?
└─ user_change_request
~~~

Rules：

1. source_blueprint = immutable admitted Blueprint。
2. source_runtime_inputs 預設不送。
3. 若 User 明確要基於目前 input state 修改，可傳 approved minimal context，但不是 default。
4. source_share_id 只作 provenance/evidence，不進新 Blueprint body。
5. source Intent 若不存在，不是 blocker；Blueprint 本身仍可作 base。
6. sensitive / DO_NOT_PERSIST input 不可因 Refine/Remix 自動送給 Model。

# 6. Entry UX

## F06-UX-001

F00 APP surface提供兩條明確 consumer path：

~~~text
Refine / 修改這個 App
→ S05A

Remix / 改成我的版本
→ S05B
~~~

Entry：

~~~text
Current App
→ User明確選 Refine 或 Remix
→ 對應 Change Composer
→ User describes desired change
→ submit
~~~

UI rules：
- 不得用 ownership / Shared App來源自行替 User決定 Refine 或 Remix。
- S05B不是 zero-change copy；必須有至少一個有效 change request。
- 若 User從既有 S05 session點 `查看原版`暫時進 S03，該 S03屬 returnable inspection context；任何 Modify / Remix action都不得建立第二個 S05 session，必須回原 S05 context。

Change Composer minimum：

- source App title
- relation label：Refine / Remix
- natural-language change input
- optional visible current assumptions / relevant inputs
- Cancel
- Continue

原 App仍可返回。

# 7. Change Composer State Machine

## F06-STATE-001

~~~text
CLOSED
→ EDITING
→ ANALYZING
→ CLARIFICATION_REQUIRED
→ ASSUMPTION_REVIEW
→ READY_TO_COMPOSE
→ COMPOSING
→ VALIDATING
→ PREVIEW_READY
→ ACCEPTED
~~~

Failure：

~~~text
ANALYZING → RECOVERABLE_FAILURE
COMPOSING → RECOVERABLE_FAILURE
VALIDATING → RECOVERABLE_FAILURE
PREVIEW_READY → REJECTED_BY_USER
~~~

任何 failure：

> 保留原 Blueprint / 原 Runtime Instance。

# 8. Fast Path

## F06-UX-002

如果 change request 清楚且沒有 material ambiguity：

~~~text
submit change
→ analyze
→ compose
→ validate
→ preview new App
~~~

不要強制多一個確認頁。

需要 material clarification 時才停下來。

# 9. Semantic Delta

## F06-DATA-002

Semantic Delta 是 F06 的 shared semantic contract。

它不是 Blueprint patch。

~~~text
SemanticDelta
├─ delta_version
├─ source_blueprint_hash
├─ relation_type: REFINE | REMIX
├─ summary
├─ change_items[]
├─ preservation_requirements[]
├─ removal_intents[]
├─ new_requirements[]
└─ provenance_map
~~~

change_item：

~~~text
id
semantic_scope
operation:
  ADD
  MODIFY
  REMOVE
description
user_source
impact_level
material
~~~

preservation_requirement：

~~~text
id
description
source:
  USER_EXPLICIT
  SOURCE_BLUEPRINT
  NFF_INVARIANT
priority:
  MUST_PRESERVE
  SHOULD_PRESERVE
~~~

# 10. Semantic Delta Rules

## F06-RQ-002

1. Delta 描述 meaning，不描述 JSON path。
2. Delta 不可指定 executable JS。
3. Delta 不可直接修改 content_hash。
4. Delta 不可直接寫 state/node/action array index。
5. Delta 必須包含 source_blueprint_hash。
6. User明確要求保留的功能 = MUST_PRESERVE。
7. 未被要求改動的 material source behavior，預設 SHOULD_PRESERVE。
8. 新要求與 MUST_PRESERVE 衝突 → clarification。
9. F01 Prompt B可用 Delta 作 composition guidance，但最終輸出是完整 Blueprint Candidate。
10. F02 對完整新 Blueprint 做全量 Validation。

# 11. No JSON Patch

## F06-POL-005

Phase 1 禁止：

~~~text
User / LLM
→ JSON Patch
→ mutate validated Blueprint
→ execute
~~~

原因：

- 破壞 immutable content model
- 容易繞過 F02 full validation
- 把 schema path變成 product API
- 跨 schema version fragile
- 讓 LLM耦合 Runtime internal structure

Canonical：

~~~text
Semantic Delta
→ full recomposition
→ full validation
→ new hash
~~~

# 12. F01 Integration

## F06-RQ-003

REFINE：

~~~text
intent_kind = REFINE
source_blueprint_hash = base hash
raw_intent = User change request
~~~

REMIX：

~~~text
intent_kind = REMIX
source_blueprint_hash = base hash
raw_intent = User change request
~~~

F01 Prompt A：

- 解析 change request
- 建 Semantic Delta proposal
- 找出與 base semantic behavior 的衝突
- 必要時走 Clarification Policy

F01 Prompt B：

- 使用 source Blueprint + Resolved Change Intent + Semantic Delta
- 產生完整 Blueprint Candidate

# 13. Clarification During Change

## F06-RQ-004

需要 clarification 的例子：

- 「改簡單一點」有多個 material interpretation
- 修改會破壞 source 核心 invariant
- 移除其他規則依賴的 input
- 新功能缺 material value
- 涉及 money / permission / cost / irreversible behavior

F06沿用 F01 Policy，不建立第二套 Clarification Policy。

# 14. Preservation Semantics

## F06-POL-006

Default：

> 未被 User Change Request 觸及的 material semantic behavior，應盡量保留。

這不是 byte-level preservation。

可合法改變：

- node IDs
- layout structure
- internal derived state organization
- equivalent expression structure

只要 User-visible / business semantics符合 preservation requirements。

# 15. Capability Changes

F06 可因新需求改用不同 Capability，但：

- 必須重新跑 F04 Coverage。
- Unknown capability不可由 LLM創造。
- degradation依 F01/F04規則 visible。
- 新需求 unsupported時，不得破壞 base App後假裝完成。

# 16. New Blueprint Identity

## F06-RQ-005

Validated new Blueprint：

~~~text
canonical new Blueprint
→ new content_hash
~~~

若新 canonical content與 source相同：

~~~text
new content_hash == source content_hash
→ no self-lineage
→ no_effective_change
~~~

若內容不同：

~~~text
parent_hash = source
child_hash = new
relation_type = REFINE | REMIX
~~~

# 17. Lineage Write

## F06-DATA-003

成功 admission後建立：

~~~text
blueprint_lineage
├─ parent_hash
├─ child_hash
├─ relation_type
├─ intent_id
├─ created_by_anonymous_id?
└─ created_at
~~~

沿用 DATA-MODEL：

- parent != child
- unique(parent, child, relation_type)
- immutable edge

F06不建立 mutable revision row。

# 18. Revision Semantics

Phase 1：

> 「新版」是 UX語言；Data truth是新 immutable content hash + lineage。

不建立 mutable revision body。

未來若 F08/F10 需要 stable family identity，再新增 metadata layer。

F06不提前建立 BlueprintFamily。

# 19. Preview Semantics

## F06-UX-003

New Blueprint VALIDATED後，不立即銷毀 source App。

~~~text
source App remains safe
→ hydrate child in fresh Instance
→ PREVIEW_READY
→ User chooses:
   Use New Version
   Keep Previous
   Adjust Again
~~~

REFINE / REMIX都使用此 safety pattern。

# 20. Use New Version

## F06-RQ-006

User選 Use New Version：

- active Blueprint切到 child_hash
- active Runtime切到 child Instance
- source Blueprint仍存在
- lineage保留
- F00 APP surface更新
- 可再 Refine / Share / Correct

這不是 mutation source。

# 21. Keep Previous

User選 Keep Previous：

- source Blueprint / Instance仍active
- child Blueprint仍是已產生 immutable artifact
- child不成為 active App
- lineage若已建立，不需刪除

Evidence區分：

~~~text
generated
accepted
kept_previous
~~~

# 22. Adjust Again

## F06-UX-004

~~~text
current comparison context
+ new User change
→ new intent
~~~

Phase 1 default base：

~~~text
latest preview child
~~~

UI 必須讓 User知道目前調整哪一版。

若 User選「從原版重來」：

~~~text
base = original source Blueprint
~~~

每次修改建立新 intent_record。

# 23. Runtime Input Carryover

## F06-POL-007

一般 Refine / Remix：

> 預設不 carry current Runtime input state 到新 App。

原因：

- App structure可能改變
- input schema可能不相容
- privacy
- 避免把使用資料誤當 App definition

child Runtime使用 child Blueprint initial state。

例外：

- F16 Correction需要 preserve inputs做 old/new result比較，由 F16專門定義。
- 未來若需要 Refine input carryover，必須有 explicit mapping contract。

# 24. API Strategy

Common transport / idempotency / error / versioning由 `working/common-core/API-CONVENTIONS.md` 擁有。

F06 Phase 1 不新增平行 Compiler endpoint。

重用 F01：

~~~text
POST /api/v1/intents
POST /api/v1/intents/{intent_id}/answers
POST /api/v1/intents/{intent_id}/compile
~~~

避免長出第二套：

~~~text
/remix
/refine
/compile-remix
~~~

compiler lifecycle。

# 25. API — Start Refine / Remix

## F06-API-001

REFINE request：

~~~json
{
  "anonymous_id": "uuid",
  "intent_kind": "REFINE",
  "raw_intent": "再加一個可以選幣別的欄位",
  "source": {
    "type": "APP_REFINE"
  },
  "context": {
    "source_blueprint_hash": "sha256:..."
  }
}
~~~

REMIX request：

~~~json
{
  "anonymous_id": "uuid",
  "intent_kind": "REMIX",
  "raw_intent": "把這個抽獎器改成公司尾牙版",
  "source": {
    "type": "SHARED_APP_REMIX",
    "share_id": "uuid"
  },
  "context": {
    "source_blueprint_hash": "sha256:..."
  }
}
~~~

Server：

1. verify source hash exists/trusted。
2. share_id存在時驗證 share → source hash一致。
3. create new intent_record。
4. run F01 lifecycle。

# 26. API — Compile Child

## F06-API-002

使用：

~~~text
POST /api/v1/intents/{intent_id}/compile
~~~

Preconditions：

~~~text
intent_kind = REFINE | REMIX
resolved intent ready
source_blueprint_hash still valid
~~~

Success additional semantics：

~~~json
{
  "request_id": "req_...",
  "data": {
    "intent_id": "uuid",
    "status": "VALIDATED",
    "content_hash": "sha256:new",
    "source_blueprint_hash": "sha256:base",
    "relation_type": "REFINE",
    "lineage_created": true
  }
}
~~~

No effective change：

~~~json
{
  "relation_type": "REFINE",
  "lineage_created": false,
  "no_effective_change": true
}
~~~

# 27. Idempotency

F06沿用 F01 Idempotency。

- same logical change retry → same Idempotency-Key
- 不 duplicate intent
- compile retry不 duplicate lineage
- lineage unique constraint是第二層防重
- User修改 change request → 新 logical operation / 新 key

# 28. Data / DB Read-Write

F06 讀：

- source blueprint_content
- source trust status
- share mapping when REMIX from share
- F01 intent lifecycle
- F02 validation result

F06 寫 / triggers：

- intent_record，kind REFINE / REMIX
- compiler_run via F01
- validation_run / blueprint_content via F02
- blueprint_lineage after child admission

F06 不寫：

- source Blueprint body
- source Runtime Instance
- result_snapshot
- correction_record
- ownership

# 29. Lineage Write Ordering

## F06-RQ-007

~~~text
child F02 admission PASS
→ child blueprint_content durable
→ lineage insert
→ child hydrate
→ preview
~~~

若 lineage insert temporary failure：

- child Blueprint仍是 valid durable artifact
- operation不能回完整成功
- idempotently retry lineage write
- 不重新 Compile child

# 30. Failure / Recovery

Analysis / clarification failure：

~~~text
keep source App
+ keep change draft
→ retry / edit
~~~

Composition / validation failure：

~~~text
keep source App
+ keep resolved change intent
→ bounded retry / clarification
~~~

Unsupported capability：

~~~text
keep source App
→ explain unsupported
→ simplify change / cancel
~~~

Child hydration failure：

~~~text
keep source App active
→ preserve child hash
→ retry hydrate / keep previous
~~~

Lineage write failure：

~~~text
do not claim full completion
→ retry metadata write
→ source remains safe
~~~

# 31. Error Taxonomy

| ID | Meaning | Retry | Preserve |
|---|---|---|---|
| F06-ERR-001 | SOURCE_BLUEPRINT_NOT_FOUND | NO | change draft |
| F06-ERR-002 | SOURCE_BLUEPRINT_UNTRUSTED | NO | change draft |
| F06-ERR-003 | SOURCE_SHARE_MISMATCH | NO | safe context |
| F06-ERR-004 | CHANGE_REQUEST_INVALID | NO | source App |
| F06-ERR-005 | CHANGE_CLARIFICATION_REQUIRED | USER_ACTION | source + draft |
| F06-ERR-006 | CHANGE_COMPOSITION_FAILED | CONDITIONAL | source + resolved change |
| F06-ERR-007 | CHANGE_VALIDATION_REJECTED | CONDITIONAL | source + resolved change |
| F06-ERR-008 | CHANGE_UNSUPPORTED | NO | source App |
| F06-ERR-009 | CHILD_HYDRATION_FAILED | CONDITIONAL | source + child hash |
| F06-ERR-010 | LINEAGE_WRITE_FAILED | YES | source + child hash |
| F06-ERR-011 | IDEMPOTENCY_CONFLICT | NO | existing operation |
| F06-ERR-012 | NO_EFFECTIVE_CHANGE | NO | source App |
| F06-ERR-013 | INTERNAL_INVARIANT | NO | trace context |

NO_EFFECTIVE_CHANGE 是 product outcome，不一定呈現成 technical error。

# 32. Security / Permission

- F06-SEC-001 source Blueprint必須是 admitted durable content。
- F06-SEC-002 Client不能用 arbitrary source Blueprint body取代 durable hash lookup。
- F06-SEC-003 REMIX share_id必須與 source hash一致。
- F06-SEC-004 Semantic Delta不是 executable patch。
- F06-SEC-005 child Candidate必須完整經 F02。
- F06-SEC-006 Runtime input預設不送 Model。
- F06-SEC-007 sensitive / DO_NOT_PERSIST context不可自動帶入。
- F06-SEC-008 source Blueprint不可 mutation。
- F06-SEC-009 Phase 1不做虛假的 owner authorization claim。
- F06-SEC-010 lineage provenance不得包含 raw Prompt / sensitive result。

# 33. Frontend State

## F06-DATA-004

~~~text
ChangeUIState
├─ mode: REFINE | REMIX
├─ status
├─ source_blueprint_hash
├─ source_share_id?
├─ change_draft
├─ intent_id?
├─ intent_version?
├─ clarification?
├─ assumptions?
├─ semantic_delta_summary?
├─ child_blueprint_hash?
├─ preview_instance_id?
└─ error_code?
~~~

這是 Browser UI state，不是 durable semantic truth。

# 34. Evidence Seed

正式 Event Envelope由 F07定義。

~~~text
F06-EVT-001 refine_opened
F06-EVT-002 remix_opened
F06-EVT-003 change_submitted
F06-EVT-004 change_clarification_required
F06-EVT-005 semantic_delta_resolved
F06-EVT-006 child_blueprint_validated
F06-EVT-007 child_preview_ready
F06-EVT-008 child_accepted
F06-EVT-009 child_kept_previous
F06-EVT-010 adjust_again
F06-EVT-011 no_effective_change
F06-EVT-012 change_failed
~~~

Minimum dimensions：

~~~text
function_id = F06
relation_type
source_blueprint_hash
child_blueprint_hash when available
intent_id
share_id when applicable
coverage_status
error_code
trace_id
~~~

不記 raw change prompt by default。

# 35. Product Metrics

~~~text
Refine Entry Rate
Remix Entry Rate
Change Submit → Validated Child Rate
Change Clarification Rate
Child Preview → Accept Rate
Keep Previous Rate
Adjust Again Rate
No Effective Change Rate
Shared App → Remix Rate
Refine / Remix Failure Recovery Rate
~~~

重要指標：

> User是否能在不從頭開始的情況下得到有用的新版本。

# 36. Acceptance Criteria

Core：

- F06-AC-001 REFINE / REMIX都必須有 source Blueprint hash。
- F06-AC-002 source Blueprint永遠不被 mutation。
- F06-AC-003 Runtime state change不建立 lineage。
- F06-AC-004 Semantic Delta不能作 executable Blueprint patch。
- F06-AC-005 child永遠完整經 F02 Validation。
- F06-AC-006 validated child內容不同時產生新 content_hash。
- F06-AC-007 REFINE / REMIX建立正確 relation_type lineage。
- F06-AC-008 same source/new hash不建立 self-lineage。

Preservation / UX：

- F06-AC-009 MUST_PRESERVE requirement衝突時必須 clarification。
- F06-AC-010 failure不破壞 source App。
- F06-AC-011 child preview前 source App仍可返回。
- F06-AC-012 Keep Previous不 mutation/delete source。
- F06-AC-013 Adjust Again保留 change context。
- F06-AC-014一般 Refine/Remix不自動 carry Runtime input。

API / Security：

- F06-AC-015 F06重用 F01 lifecycle，不建立第二套 compiler endpoint。
- F06-AC-016 Remix share_id與 source hash不一致時拒絕。
- F06-AC-017 Client不能用 arbitrary Blueprint body當 source。
- F06-AC-018 retry不重複建立 logical intent / lineage。
- F06-AC-019 sensitive Runtime input不因 change flow自動送 Model。

Evidence：

- F06-AC-020 Refine與Remix可分開量測。
- F06-AC-021 child generated與User accepted可分開量測。
- F06-AC-022 no_effective_change可辨識。
- F06-AC-023 Shared App → Remix lineage / evidence可追蹤。
- F06-AC-024 REFINE / REMIX intent必須由 User明確選擇；ownership、Shared來源或目前頁面不得自動決定 relation_type。
- F06-AC-025 S05 `查看原版`的 returnable inspection不得建立第二個 F06/S05 change session；返回後必須續用原 session / draft / Preview context。

# 37. Test Mapping Seed

~~~text
F06-AC-002 → TEST-F06-002 source immutability
F06-AC-003 → TEST-F06-003 runtime state not revision
F06-AC-004 → TEST-F06-004 no executable delta patch
F06-AC-005 → TEST-F06-005 mandatory F02
F06-AC-007 → TEST-F06-007 lineage relation
F06-AC-008 → TEST-F06-008 no self-lineage
F06-AC-009 → TEST-F06-009 preservation conflict clarification
F06-AC-010 → TEST-F06-010 source survives failure
F06-AC-014 → TEST-F06-014 no input carryover
F06-AC-015 → TEST-F06-015 shared F01 lifecycle
F06-AC-016 → TEST-F06-016 share/source consistency
F06-AC-018 → TEST-F06-018 idempotent lineage
F06-AC-019 → TEST-F06-019 sensitive context exclusion
F06-AC-024 → TEST-F06-024 explicit relation selection
F06-AC-025 → TEST-F06-025 inspection does not create nested change session
~~~

# 38. Dependencies

Upstream：

- F00 change entry / preview shell
- F01 clarification / composition lifecycle
- F02 validation
- F03 child Runtime
- F05 Shared App restore
- DATA-MODEL immutable content / lineage

Downstream：

- F07 Evidence
- F12 Recovery
- F16 Correction uses related immutable revision pattern

# 39. Release / Migration

Release 1：

~~~text
REFINE
+ REMIX
+ semantic change request
+ F01 lifecycle reuse
+ Semantic Delta
+ full child validation
+ immutable lineage
+ preview / accept / keep previous
~~~

Phase 1 不建立：

- BlueprintFamily
- mutable revision rows
- runtime-state cloning
- ownership authorization
- JSON Patch API

Future F08/F10可在 lineage上加 attribution / family / retrieval metadata，不改 F06 immutable core。

# 40. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F00 Refine / Remix entry與preview UX。
- F07 generated / accepted child evidence contract。
- F12 F06 recovery mapping與machine-readable registry。
- F16 input-preserving Correction與F06 general semantic change邊界。

非 blocker、可後續迭代：

1. Refine vs Remix wording A/B。
2. F08 durable creator attribution。
3. F10 family/reuse metadata，不得改 immutable lineage truth。

# Conclusion

F06 Current Truth：

~~~text
Existing immutable Blueprint
+ User semantic change
→ REFINE or REMIX Intent
→ deterministic clarification
→ Semantic Delta
→ full new Blueprint composition
→ full F02 Validation
→ new immutable content hash
→ lineage
→ fresh child Runtime
→ preview
→ accept / keep previous / adjust again
~~~

> Remix / Refine 的本質不是「改 JSON」，而是「保留有價值的語意，重新產生一個完整、可驗證的新 App」。
