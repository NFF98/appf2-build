# F16 — Result Feedback / Logic Correction

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Semantic Mismatch Detection、Correction Intent、Input Replay、Before/After Result Comparison、CORRECT Lineage 與 Accept / Reject / Revert 的 Working Current Truth。
>
> 上游：F00 Experience Shell、F01 Intent Compilation、F02 Blueprint Validation、F03 Runtime、F06 Remix / Refine、F07 Evidence、F12 Recovery、DATA-MODEL、DESIGN-TO-DELIVERY。
>
> F16 處理「App 技術上能執行，但 User 認為結果、規則、假設或邏輯不符合原 Intent」。
>
> Semantic mismatch 不是 technical error。F12只處理 correction flow 中真正發生的技術失敗。

# 1. Purpose / User Outcome

User Outcome：

> User 發現結果不對時，不需要從頭重做 App，也不用重新輸入原本資料；可以直接說哪裡不對，appf2 保留原版本與輸入，產生修正版，用相同可重播 inputs 跑一次，讓 User 比較新舊結果，再決定接受、繼續修或回上一版。

Canonical flow：

~~~text
Current Validated Blueprint
+ Current Committed Inputs
+ Current Result
→ User says logic/result is wrong
→ Capture Before Snapshot
→ Correction Intent
→ Clarification only if needed
→ Correction Delta
→ F01 compose full new Blueprint Candidate
→ F02 full validation
→ new immutable Blueprint
→ lineage = CORRECT
→ fresh F03 Runtime
→ replay same eligible inputs/context
→ After Result
→ Compare Old / New
→ Accept New | Keep Previous | Adjust Again | Revert
~~~

核心原則：

1. Runtime success 不代表 semantic success。
2. 原 Blueprint 永遠不 mutation。
3. Correction 不是 JSON patch。
4. Correction child永遠完整走 F02。
5. Before / After comparison必須有明確 replay truth。
6. User selection不等於修改 Blueprint body。
7. semantic mismatch與 correction outcome必須成為 Evidence。

# 2. Scope / Non-Scope

F16 Phase 1 負責：

- semantic mismatch entry
- correction-specific UX state machine
- before snapshot capture
- replay-eligible input selection
- protected value handling
- correction intent
- correction delta
- minimal semantic correction policy
- F01 / F02 integration
- CORRECT lineage
- child runtime replay
- comparison mode
- before / after result comparison
- accept / keep previous / adjust again / revert
- correction_record lifecycle
- correction API
- error / F12 recovery mapping
- evidence / metrics
- acceptance / tests

F16 不負責：

- technical Runtime recovery
- general feature addition unrelated to wrong result
- arbitrary UI redesign
- mutable Blueprint editing
- ownership
- automated self-correction without User signal
- LLM-based grading of correctness as final truth
- external provider execution
- every Runtime result persistence

# 3. F16 vs F06 Boundary

## F16-POL-001

Use F16 when User meaning is：

~~~text
the current App is producing the wrong result
the current rule is wrong
an assumption is wrong
the calculation logic does not match what I meant
~~~

Use F06 REFINE / REMIX when User meaning is：

~~~text
add a feature
change the UI
add/remove an input
turn this App into a different use case
make a derivative version
~~~

Examples：

~~~text
「主管應該付兩倍，但現在沒有」
→ F16 CORRECT

「再加一個幣別選擇」
→ F06 REFINE

「把朋友的分帳器改成旅行版」
→ F06 REMIX
~~~

如果 feedback混合「邏輯修正 + 新功能」，F01先拆解；若新功能會改 replay input contract，Phase 1預設轉 F06 Refine，不在 F16偷偷擴張 scope。

# 4. Correction Preconditions

## F16-RQ-001

Correction可以開始的條件：

~~~text
base Blueprint exists
AND trust_status = VALIDATED
AND current Runtime Instance has committed state
AND canonical result surface can be evaluated
~~~

Result可以是：

~~~text
AVAILABLE
or
partially AVAILABLE with explicit failed outputs
~~~

若沒有 result.outputs：

- F00不顯示主 Correction entry。
- User仍可走 F06 Refine。
- 未來可支援「behavior correction」但不在 Phase 1 Release 1 blocker。

# 5. Correction UX Entry

## F16-UX-001

F00 Result Surface提供：

~~~text
調整結果
邏輯不對
結果不是我想要的
~~~

不要寫：

~~~text
Report hallucination
Runtime error
Validation failed
~~~

Entry minimum：

- current result摘要
- natural-language correction input
- optional expected result / rule hint
- Cancel
- Continue

原 App保持可用。

# 6. Correction State Machine

## F16-STATE-001

~~~text
CLOSED
→ EDITING
→ CAPTURING_BEFORE
→ ANALYZING
→ CLARIFICATION_REQUIRED
→ ASSUMPTION_REVIEW
→ READY_TO_COMPOSE
→ COMPOSING
→ VALIDATING
→ CHILD_READY
→ REPLAYING
→ COMPARE_READY
→ ACCEPTED
or KEPT_PREVIOUS
or ADJUST_AGAIN
or REVERTED
~~~

Failure branches：

~~~text
CAPTURING_BEFORE → RECOVERABLE_FAILURE
ANALYZING → RECOVERABLE_FAILURE
COMPOSING → RECOVERABLE_FAILURE
VALIDATING → RECOVERABLE_FAILURE
REPLAYING → RECOVERABLE_FAILURE
COMPARE_READY → TECHNICAL_FAILURE
~~~

任何 failure都保留 last-known-good base App。

# 7. Before Snapshot Contract

## F16-DATA-001

F03 captureRuntimeSnapshot 提供 runtime source；F16只選 correction需要的 subset。

Logical correction snapshot：

~~~text
CorrectionResultSnapshot
├─ snapshot_version
├─ blueprint_hash
├─ replay_inputs[]
├─ result_outputs[]
├─ replay_context
├─ captured_at_local
└─ persistence_summary
~~~

replay_input：

~~~text
state_key
value_type
value?
sensitivity
persistence:
  PERSIST_VALUE
  REDACTED
  MEMORY_ONLY
source_node_ids[]
~~~

result_output：

~~~text
output_id
value_type
value?
status
sensitivity
persistence:
  PERSIST_VALUE
  REDACTED
  MEMORY_ONLY
~~~

# 8. Replay-Eligible Input Selection

## F16-RQ-002

Phase 1 replay input set由 admitted Blueprint + F04 Registry deterministic derive。

Include：

> 所有被 user-editable input Capability 綁定到 MUTABLE state 的 typed state key。

Phase 1 Core user-editable input Capability：

~~~text
input.number
input.text
input.select
input.toggle
~~~

Derivation：

~~~text
for each admitted node:
  if Capability semantic kind = editable input
  and declared value binding points to MUTABLE state
  → include that state key
~~~

Rules：

1. 同一 state key被多個 input nodes引用，只保存一次。
2. DERIVED state不進 replay input。
3. capability-local state不當 user input。
4. action.button不是 value input。
5. internal mutable state若沒有 user-editable input binding，不預設 durable snapshot。
6. future Registry若加入新的 user-editable input capability，必須明確宣告 replay/input role後才加入。

# 9. Snapshot Privacy

## F16-POL-002

Phase 1 durable result_snapshot遵守最小保存。

NORMAL：

~~~text
value may persist when correction needs it
~~~

SENSITIVE：

~~~text
default REDACTED in durable snapshot
actual value may remain MEMORY_ONLY for current correction session
~~~

DO_NOT_PERSIST：

~~~text
never persist value
MEMORY_ONLY only
durable snapshot stores redaction descriptor, not value
~~~

因此 result_snapshot的 jsonb可以保存：

~~~text
field identity
type
sensitivity
redacted = true
~~~

但不保存 protected value。

如果 User reload後 MEMORY_ONLY context消失：

- correction可以保留 durable metadata。
- 不能假裝仍能做 same-input replay。
- F12須披露需要重新輸入哪些 material values。

# 10. Result Output Snapshot

## F16-RQ-003

F16只讀 F03 evaluateResult() / Blueprint result.outputs。

禁止：

- 從 React DOM抓顯示文字當 canonical result
- snapshot整個 component tree
- 任意掃描 state猜哪個是 result

Result sensitivity沿用 F02：

~~~text
NORMAL
SENSITIVE
DO_NOT_PERSIST
~~~

Persistence與第9節一致。

# 11. Replay Context

## F16-DATA-002

~~~text
ReplayContext
├─ comparison_mode
├─ rng_metadata?
├─ timer_metadata?
├─ runtime_version
├─ schema_version
└─ registry_version
~~~

comparison_mode：

~~~text
DETERMINISTIC_REPLAY
SEEDED_REPLAY
TIME_CONTEXT_REPLAY
LIMITED_COMPARISON
~~~

# 12. Comparison Mode Rules

## F16-POL-003

DETERMINISTIC_REPLAY：

- App result只依 deterministic state/rules。
- 同 inputs可直接比較。

SEEDED_REPLAY：

- result涉及 SEEDED Capability。
- 只有 F03-RQ-012 判定所有 result-affecting SEEDED context可安全重建時成立。
- seed + counter本身不等於可重建完整歷史；不足時必須降級 LIMITED_COMPARISON。

TIME_CONTEXT_REPLAY：

- result依賴 timer/time-dependent local semantics。
- 只有 F03-RQ-012 能用 duration/elapsed等bounded monotonic context重建且不重放歷史event時成立。
- 不可重建歷史 timing sequence時必須降級 LIMITED_COMPARISON。

LIMITED_COMPARISON：

- exact runtime context不可安全重播。
- F16仍可比較 Blueprint semantic change與可用 outputs。
- UI不得宣稱數值是完全 apples-to-apples replay。
- 若 meaningful correction需要 exact replay而做不到，要求 User重新建立可比較狀態或改走 F06。

# 13. Replay Safety

## F16-RQ-004

F16不允許為了 replay：

- bypass permission
- replay irreversible external effect
-重新送外部 transaction
- 自動播放需要 User gesture的 media
- 重新執行未來 F11 external action

Phase 1 Core主要是 local deterministic / seeded / timer App。

Future external capability correction必須新增 effect-safe replay contract。

# 14. Correction Intent

## F16-DATA-003

F16建立 F01 intent_kind：

~~~text
CORRECT
~~~

CorrectionIntent semantic context：

~~~text
correction_id
base_blueprint_hash
user_feedback
before_result_summary
expected_behavior?
expected_result?
replay_input_schema
protected_value_summary
source_intent_id?
~~~

Rules：

1. raw protected input value不塞進 prompt context，除非 User明確提供且policy允許。
2. current result可用 sanitized semantic summary給 Prompt A。
3. User feedback是 correction semantic source。
4. expected result若 User明確提供，source = USER_EXPLICIT。
5. LLM不能把自己的 expected result當 User fact。

# 15. Correction Scope Classification

## F16-RQ-005

Prompt A / deterministic routing將 feedback分類：

~~~text
RULE_LOGIC
ASSUMPTION
RESULT_INTERPRETATION
RESULT_FORMAT_SEMANTIC
INPUT_INTERPRETATION
MIXED_CHANGE
UNKNOWN
~~~

MIXED_CHANGE如果包含新增/刪除 input或大幅產品功能變更：

~~~text
→ route / propose F06 REFINE
~~~

UNKNOWN且 material：

~~~text
→ F01 Clarification
~~~

# 16. Correction Delta

## F16-DATA-004

CorrectionDelta 是 semantic change，不是 JSON patch。

~~~text
CorrectionDelta
├─ delta_version
├─ base_blueprint_hash
├─ relation_type = CORRECT
├─ correction_scope
├─ issue_statement
├─ expected_behavior?
├─ change_items[]
├─ preservation_requirements[]
├─ replay_contract
└─ provenance_map
~~~

change_item：

~~~text
id
semantic_scope
operation:
  MODIFY
  REMOVE
  ADD
description
reason
source
material
~~~

Phase 1 CORRECT通常以 MODIFY為主。

# 17. Minimal Semantic Correction

## F16-POL-004

Correction目標：

> 改 User指出的 semantic problem，盡量不改無關 material behavior。

Automatic preservation requirements：

~~~text
base App overall purpose
replay input keys and types
unaffected material rules
unaffected outputs
permission class
shareability
security constraints
~~~

若 correction需要破壞 replay input keys/types：

~~~text
not comparable under F16 default
→ clarification
→ usually route to F06 REFINE
~~~

Minimal semantic correction ≠ minimal JSON diff。

Node IDs / expression structure / layout internals可以改，只要 semantic preservation成立。

# 18. No Direct Patch

## F16-POL-005

禁止：

~~~text
feedback
→ LLM JSON Patch
→ mutate base Blueprint
→ execute
~~~

Canonical：

~~~text
Correction Intent
→ Correction Delta
→ full new Blueprint Candidate
→ F02 full validation
→ new immutable child
~~~

# 19. F01 Integration

## F16-RQ-006

F16使用 F01 lifecycle。

Correction initiation後：

~~~text
intent_kind = CORRECT
source_blueprint_hash = base
raw_intent = correction feedback
context = sanitized before result + replay schema
~~~

Prompt A：

- 理解 semantic mismatch
- 產生 correction scope / delta proposal
- 找出缺失或衝突
- 需要時 Clarification

Prompt B：

- base Blueprint
- Resolved Correction Intent
- Correction Delta
- F04 coverage
- F02 schema
→ full child Blueprint Candidate

# 20. F02 / Lineage Integration

## F16-RQ-007

Child Candidate必須完整走 F02。

PASS後：

~~~text
new blueprint_content
→ blueprint_lineage
   parent_hash = base
   child_hash = corrected
   relation_type = CORRECT
~~~

如果 child hash == base hash：

- 不建立 self-lineage。
- correction outcome不標 GENERATED成功修正。
- 回 NO_EFFECTIVE_CORRECTION。
- User可以 Adjust Again / Keep Previous。

# 21. Correction Record Lifecycle

## F16-DATA-005

沿用 DATA-MODEL correction_record。

Outcome：

~~~text
REQUESTED
GENERATED
ACCEPTED
REJECTED
REVERTED
FAILED
~~~

Semantics：

REQUESTED：
- before snapshot + correction intent已建立。

GENERATED：
- child Blueprint已 validated。
- replay已產生可比較 after result，或 LIMITED_COMPARISON已建立明確限制。

ACCEPTED：
- User選 Use New Result / New Version。

REJECTED：
- User明確 Keep Previous。

REVERTED：
- User曾 ACCEPTED後，明確回到 base / previous correction ancestor。

FAILED：
- correction operation終止且未產生可比較 child。

Adjust Again：

- 不必強制改舊 correction outcome。
- 可從目前 preview child建立新的 correction_record。
- 舊 record可以保持 GENERATED，作為中間版本歷史。

# 22. Before Snapshot Persistence Ordering

## F16-RQ-008

Correction開始：

~~~text
capture sanitized before snapshot
→ create result_snapshot BEFORE
→ create CORRECT intent_record
→ create correction_record outcome=REQUESTED
→ analyze
~~~

這三個 durable records的建立必須由同一 F16 application operation協調。

若分析 LLM失敗：

- correction_record保持 REQUESTED。
- 可 retry analysis。
- 不需要重新capture before snapshot。

Idempotency避免 duplicate before snapshots / correction records。

# 23. Child Generation Ordering

## F16-RQ-009

~~~text
F01 correction intent READY
→ compile
→ F02 PASS
→ child blueprint_content durable
→ CORRECT lineage insert
→ correction_record.new_blueprint_hash
→ fresh child Runtime
→ replay
→ after snapshot
→ outcome GENERATED
~~~

若 lineage metadata temporary failure：

- child Blueprint仍valid。
- 不重新compile。
- retry lineage write。
- 不宣稱 Compare Ready直到 correction metadata一致。

# 24. Input Replay Contract

## F16-RQ-010

Child replay前檢查：

~~~text
for each replay input:
  child has same mutable state key
  compatible value type
  value satisfies child constraints
~~~

Pass：

~~~text
initialize child Instance
→ apply replay inputs through trusted replay initialization path
→ recompute derived/rules
→ establish replay context
→ evaluate result
~~~

Fail：

- 不偷偷丟掉不相容 input。
- 不 silent coerce business value。
- 進 clarification / F12 recovery。
- 若 input contract確實需要改，轉 F06 Refine。

# 25. Replay Initialization Boundary

Replay不是一般 User Action，也不是直接亂寫 Runtime store。

Canonical Runtime interface由 F03-RQ-012 擁有：

~~~text
createCorrectionReplayInstance(request)
→ CorrectionReplayResult
~~~

Requirements：

- child已 F02 VALIDATED，且有 fresh ExecutionAdmission。
- replay inputs先 type/constraint validation。
- only replay-eligible state keys。
- protected MEMORY_ONLY values只留 Browser memory。
- apply完成後依 F03重新計算 derived/rules。
- requested comparison mode可被 F03降級為 LIMITED_COMPARISON；F16不得自行升級。
- Runtime normal semantics不被繞過。

# 26. After Snapshot

## F16-DATA-006

After result使用同一 CorrectionResultSnapshot shape。

Durable after snapshot：

- NORMAL values可保存。
- SENSITIVE default redacted。
- DO_NOT_PERSIST value永不保存。
- replay metadata只保存必要 deterministic context。

After snapshot的 blueprint_hash必須等於 correction_record.new_blueprint_hash。

# 27. Compare UX

## F16-UX-002

COMPARE surface minimum：

~~~text
What you said was wrong
Previous Result
New Result
What changed
Comparison quality
Actions:
  Use New Result
  Keep Previous
  Adjust Again
~~~

如果 comparison_mode = LIMITED_COMPARISON：

- 必須顯示限制。
- 不把不同 random/time context產生的數值差異誤稱為 correction效果。

Consumer default不顯示：

- raw JSON diff
- AST diff
- state key diff
- model reasoning

# 28. What Changed Summary

## F16-RQ-011

User-visible change explanation來源：

1. Resolved Correction Intent。
2. Correction Delta。
3. deterministic semantic diff metadata where available。

可以用模板或 LLM生成易讀摘要，但：

- 不能引入未發生的 change。
- 不能宣稱 correctness已被系統證明。
- 必須可追溯到 Correction Delta items。
- User explicit expected behavior優先。

# 29. Decision — Accept New

## F16-RQ-012

Use New Result / Accept New：

- correction_record outcome → ACCEPTED。
- active Browser App切到 child Blueprint / child Instance。
- base Blueprint不刪除。
- before / after snapshot value-bearing payload依 F07 shared retention matrix最多30 days；之後redact values但保留 bounded correction metadata。
- future Share使用當前 active child。
- future Correction以 active child作 base。

Phase 1沒有 durable account-level active pointer。

因此：

> ACCEPTED 是 User selection evidence，不是 mutation一個 global blueprint.current_id。

# 30. Decision — Keep Previous

## F16-RQ-013

Keep Previous：

- correction_record outcome → REJECTED。
- base Blueprint / base Instance保持 active。
- child Blueprint仍是 immutable validated artifact。
- lineage仍是歷史事實，不刪除。
- future correction可重新從 base開始。

# 31. Decision — Adjust Again

## F16-RQ-014

Adjust Again：

- 保留 current comparison。
- correction draft prefill previous feedback + latest change summary。
- Phase 1 default base = latest generated child。
- replay input set沿用同一 logical inputs，重新驗證 compatible。
- 建立新的 correction_id / intent_id。
- 前一 correction可保持 GENERATED。

User可選「從原版重來」：

~~~text
base = original pre-correction Blueprint
~~~

# 32. Decision — Revert

## F16-RQ-015

Revert只在：

~~~text
a correction was previously ACCEPTED
AND previous/base Blueprint still trusted/compatible
~~~

User從 F00 current-session Previous Version / Revert entry選 Revert：

- active Browser App切回 base / chosen previous correction ancestor。
- target建立 fresh Runtime Instance。
- same-session original before snapshot存在且compatible時，F00預設使用該 correction前 inputs；若只有current compatible inputs，必須 User explicit opt-in；否則用 base initial state。
- correction_record outcome → REVERTED。
- child Blueprint不刪除。
- lineage不刪除。

若 previous Blueprint已 REVOKED / INCOMPATIBLE：

- 不允許 unsafe revert。
- F12說明不能安全回到該版本。

# 33. Correction API Strategy

Common transport / idempotency / concurrency / error envelope / versioning由 `working/common-core/API-CONVENTIONS.md` 擁有。

F16新增 correction lifecycle API，但重用 F01 compiler lifecycle。

Public：

~~~text
POST /api/v1/corrections
POST /api/v1/corrections/{correction_id}/comparison
POST /api/v1/corrections/{correction_id}/decision
~~~

Reuse：

~~~text
POST /api/v1/intents/{intent_id}/answers
POST /api/v1/intents/{intent_id}/compile
~~~

不建立第二套：

~~~text
/corrections/{id}/compile-ai
/correct-blueprint-directly
~~~

# 34. API 1 — Start Correction

## F16-API-001

~~~text
POST /api/v1/corrections
~~~

Header：

~~~text
Idempotency-Key: required
~~~

Request：

~~~json
{
  "anonymous_id": "uuid",
  "base_blueprint_hash": "sha256:...",
  "feedback": "主管應該出兩倍，但現在沒有",
  "expected_result": null,
  "before_snapshot": {
    "snapshot_version": "1.0.0",
    "replay_inputs": [],
    "result_outputs": [],
    "replay_context": {
      "comparison_mode": "DETERMINISTIC_REPLAY"
    }
  }
}
~~~

Server：

1. verify base Blueprint trusted。
2. validate snapshot shape against base Blueprint / F03 result contract。
3. redact / reject protected values according to policy。
4. create before result_snapshot。
5. create F01 intent_record with intent_kind = CORRECT。
6. create correction_record outcome = REQUESTED。
7. run F01 analysis / Clarification Policy。
8. return correction + intent state。

Response：

~~~json
{
  "request_id": "req_...",
  "data": {
    "correction_id": "uuid",
    "intent_id": "uuid",
    "status": "NEEDS_CLARIFICATION",
    "intent_version": 1,
    "questions": [],
    "visible_assumptions": []
  }
}
~~~

status沿用 F01：

~~~text
NEEDS_CLARIFICATION
READY_WITH_VISIBLE_ASSUMPTIONS
READY
~~~

# 35. API 2 — Correction Clarification / Compile

## F16-API-002

Clarification重用：

~~~text
POST /api/v1/intents/{intent_id}/answers
~~~

Compile重用：

~~~text
POST /api/v1/intents/{intent_id}/compile
~~~

For CORRECT intent，compile success response additional fields：

~~~json
{
  "correction_id": "uuid",
  "source_blueprint_hash": "sha256:base",
  "content_hash": "sha256:child",
  "relation_type": "CORRECT",
  "lineage_created": true
}
~~~

Server side：

- update correction_record.new_blueprint_hash。
- create CORRECT lineage idempotently。
- outcome仍不變成 GENERATED，直到 comparison完成。

# 36. API 3 — Submit Comparison

## F16-API-003

~~~text
POST /api/v1/corrections/{correction_id}/comparison
~~~

Purpose：

> Child已在 Browser用 F03 replay完成後，提交 sanitized after snapshot與 comparison metadata。

Header：

~~~text
Idempotency-Key: required
~~~

Request：

~~~json
{
  "new_blueprint_hash": "sha256:child",
  "comparison_mode": "DETERMINISTIC_REPLAY",
  "after_snapshot": {
    "snapshot_version": "1.0.0",
    "replay_inputs": [],
    "result_outputs": [],
    "replay_context": {
      "comparison_mode": "DETERMINISTIC_REPLAY"
    }
  }
}
~~~

Server validate：

- correction exists。
- new hash == correction_record.new_blueprint_hash。
- after snapshot blueprint hash / output IDs合法。
- protected values符合 persistence policy。
- correction outcome允許 GENERATED transition。

Success：

~~~json
{
  "request_id": "req_...",
  "data": {
    "correction_id": "uuid",
    "outcome": "GENERATED",
    "comparison_mode": "DETERMINISTIC_REPLAY",
    "before_result_snapshot_id": "uuid",
    "after_result_snapshot_id": "uuid"
  }
}
~~~

# 37. API 4 — Decision

## F16-API-004

~~~text
POST /api/v1/corrections/{correction_id}/decision
~~~

Header：

~~~text
Idempotency-Key: required
~~~

Request：

~~~json
{
  "decision": "ACCEPT_NEW",
  "expected_outcome": "GENERATED"
}
~~~

decision：

~~~text
ACCEPT_NEW
KEEP_PREVIOUS
REVERT_TO_BASE
~~~

Transitions：

~~~text
GENERATED + ACCEPT_NEW
→ ACCEPTED

GENERATED + KEEP_PREVIOUS
→ REJECTED

ACCEPTED + REVERT_TO_BASE
→ REVERTED
~~~

Invalid transition → 409 CORRECTION_STATE_CONFLICT。

Response：

~~~json
{
  "request_id": "req_...",
  "data": {
    "correction_id": "uuid",
    "outcome": "ACCEPTED",
    "active_blueprint_hash": "sha256:child"
  }
}
~~~

active_blueprint_hash是 client continuation hint，不是 durable ownership pointer。

# 38. Idempotency / Concurrency

## F16-POL-006

Start / comparison / decision都是 mutation operations。

Rules：

1. same Idempotency-Key + same request → same logical result。
2. same key + different request → 409。
3. correction create retry不 duplicate before snapshot / intent / correction_record。
4. compile retry不 duplicate CORRECT lineage。
5. comparison retry不 duplicate after snapshot。
6. decision用 expected_outcome作 optimistic transition guard。
7. stale decision不能覆蓋較新的 outcome。

# 39. Data / DB Read-Write

F16 讀：

- base blueprint_content
- trust / compatibility
- F03 runtime snapshot source via client
- intent_record / compiler_run
- validation result
- correction_record
- result_snapshot
- lineage

F16 寫：

- result_snapshot before
- intent_record kind CORRECT via F01
- correction_record
- compiler_run via F01
- validation_run / child blueprint via F02
- blueprint_lineage relation CORRECT
- result_snapshot after
- correction outcome

F16 不寫：

- base Blueprint body
- mutable Runtime Instance to DB
- account ownership
- arbitrary raw correction prompt into product_event

# 40. Result Snapshot Persistence Shape

## F16-DATA-007

DATA-MODEL result_snapshot欄位保持：

~~~text
input_snapshot jsonb
output_snapshot jsonb
runtime_metadata jsonb
~~~

F16 canonical json payload：

input_snapshot：

~~~json
{
  "snapshot_version": "1.0.0",
  "fields": [
    {
      "state_key": "people",
      "type": "NUMBER",
      "value": 5,
      "sensitivity": "NORMAL",
      "redacted": false
    }
  ]
}
~~~

Protected：

~~~json
{
  "state_key": "secret_value",
  "type": "STRING",
  "sensitivity": "DO_NOT_PERSIST",
  "redacted": true
}
~~~

output_snapshot同樣以 result output ID為 key identity，不以 DOM label作 primary identity。

# 41. Correction Record Consistency

## F16-RQ-016

Invariant：

~~~text
base_blueprint_hash
= before_result_snapshot.blueprint_hash

new_blueprint_hash
= after_result_snapshot.blueprint_hash when after exists

relation CORRECT:
parent = base
child = new
~~~

若不一致：

~~~text
F16-ERR-012 CORRECTION_INTEGRITY_MISMATCH
→ F12 SECURITY / INTEGRITY handling
~~~

# 42. Failure / Recovery

Snapshot capture invalid：

~~~text
keep current App
→ retry capture
→ if protected context unavailable, disclose lost context
~~~

Analysis / clarification failure：

~~~text
keep base App + before snapshot + correction draft
→ retry / edit
~~~

Composition / validation failure：

~~~text
keep base App
→ preserve correction intent
→ bounded retry / clarification
~~~

Replay incompatible：

~~~text
keep base App + child hash
→ explain input contract mismatch
→ Adjust / route F06
~~~

After snapshot persistence failure：

~~~text
keep base App + child preview in memory
→ retry metadata persistence
→ do not mark GENERATED durable yet
~~~

Decision failure：

~~~text
keep both Blueprint references
→ reload correction state
→ retry valid decision
~~~

# 43. F16 Error Taxonomy

| ID | Meaning | Retry | Preserve |
|---|---|---|---|
| F16-ERR-001 | BASE_BLUEPRINT_NOT_FOUND | NO | correction draft |
| F16-ERR-002 | BASE_BLUEPRINT_UNTRUSTED | NO | correction draft |
| F16-ERR-003 | BEFORE_SNAPSHOT_INVALID | USER_ACTION | current App |
| F16-ERR-004 | PROTECTED_REPLAY_CONTEXT_LOST | USER_ACTION | durable metadata |
| F16-ERR-005 | CORRECTION_CLARIFICATION_REQUIRED | USER_ACTION | base + before + draft |
| F16-ERR-006 | CORRECTION_COMPOSITION_FAILED | CONDITIONAL | base + intent |
| F16-ERR-007 | CORRECTION_VALIDATION_REJECTED | CONDITIONAL | base + intent |
| F16-ERR-008 | NO_EFFECTIVE_CORRECTION | USER_ACTION | base App |
| F16-ERR-009 | REPLAY_INPUT_INCOMPATIBLE | USER_ACTION | base + child |
| F16-ERR-010 | CHILD_REPLAY_FAILED | CONDITIONAL | base + child |
| F16-ERR-011 | COMPARISON_PERSIST_FAILED | YES | base + child + local compare |
| F16-ERR-012 | CORRECTION_INTEGRITY_MISMATCH | NO | safe refs only |
| F16-ERR-013 | CORRECTION_STATE_CONFLICT | YES | current durable record |
| F16-ERR-014 | REVERT_TARGET_UNSAFE | NO | current active App |
| F16-ERR-015 | IDEMPOTENCY_CONFLICT | NO | existing operation |
| F16-ERR-016 | INTERNAL_INVARIANT | NO | trace context |

Semantic mismatch本身沒有 F16-ERR code。

# 44. F12 Recovery Mapping

| Source | F12 Class | Preserve | Next Action |
|---|---|---|---|
| BASE_BLUEPRINT_NOT_FOUND | NOT_FOUND | correction draft | RETURN_HOME / KEEP_CURRENT_APP |
| BASE_BLUEPRINT_UNTRUSTED | SECURITY_TERMINAL | safe refs | KEEP_CURRENT_APP |
| BEFORE_SNAPSHOT_INVALID | USER_INPUT_INVALID | current App | RETRY / CANCEL |
| PROTECTED_REPLAY_CONTEXT_LOST | USER_DECISION_REQUIRED | durable metadata | re-enter value / KEEP_CURRENT_APP |
| CORRECTION_CLARIFICATION_REQUIRED | USER_DECISION_REQUIRED | base + draft | ANSWER_QUESTION |
| CORRECTION_COMPOSITION_FAILED | TRANSIENT_DEPENDENCY | base + intent | RETRY / KEEP_CURRENT_APP |
| CORRECTION_VALIDATION_REJECTED | STATE_OR_ACTION_FAILURE | base + intent | EDIT_REQUEST / KEEP_CURRENT_APP |
| NO_EFFECTIVE_CORRECTION | INFO | base App | ADJUST_AGAIN / KEEP_CURRENT_APP |
| REPLAY_INPUT_INCOMPATIBLE | USER_DECISION_REQUIRED | base + child | ADJUST_AGAIN / route F06 |
| CHILD_REPLAY_FAILED | STATE_OR_ACTION_FAILURE | base + child | RETRY / KEEP_CURRENT_APP |
| COMPARISON_PERSIST_FAILED | TRANSIENT_DEPENDENCY | local compare | RETRY |
| CORRECTION_INTEGRITY_MISMATCH | INTEGRITY_FAILURE | safe refs | KEEP_CURRENT_APP |
| CORRECTION_STATE_CONFLICT | STATE_OR_ACTION_FAILURE | durable state | reload / retry valid action |
| REVERT_TARGET_UNSAFE | INCOMPATIBLE | current App | KEEP_CURRENT_APP |

# 45. Security / Privacy

- F16-SEC-001 Correction不 mutation base Blueprint。
- F16-SEC-002 Child必須完整 F02 validation。
- F16-SEC-003 Replay只寫 replay-eligible mutable input keys。
- F16-SEC-004 Replay不能觸發不可逆 external effect。
- F16-SEC-005 SENSITIVE值Phase 1預設不 durable保存。
- F16-SEC-006 DO_NOT_PERSIST值永不 durable保存。
- F16-SEC-007 Client提交 snapshot要 server按 Blueprint contract重新驗證。
- F16-SEC-008 Client不能自稱 comparison成功 / child trusted。
- F16-SEC-009 Revert target必須重新 trust / compatibility check。
- F16-SEC-010 correction evidence不收 raw feedback by default。
- F16-SEC-011 comparison API不接受 arbitrary new Blueprint body。
- F16-SEC-012 integrity mismatch fail closed。

# 46. Evidence Events

F07 common envelope生效。

~~~text
F16-EVT-001 semantic_mismatch_opened
F16-EVT-002 correction_submitted
F16-EVT-003 correction_clarification_required
F16-EVT-004 correction_delta_resolved
F16-EVT-005 corrected_blueprint_validated
F16-EVT-006 correction_replay_started
F16-EVT-007 correction_compare_ready
F16-EVT-008 correction_accepted
F16-EVT-009 correction_rejected
F16-EVT-010 correction_adjust_again
F16-EVT-011 correction_reverted
F16-EVT-012 correction_failed
F16-EVT-013 no_effective_correction
F16-EVT-014 comparison_limited
~~~

Allowed property seed：

~~~text
correction_id
intent_id
base_blueprint_hash
new_blueprint_hash
comparison_mode
correction_scope
outcome
error_code
trace_id
~~~

禁止：

- raw correction feedback
- raw input values
- raw result values
- protected snapshot payload

# 47. Semantic Mismatch Metric

## F16-RQ-017

Semantic Mismatch Rate numerator：

> User主動進入 F16 correction flow，且有 valid base Blueprint / Result context。

不要用：

- Runtime exception
- F02 validation reject
- technical failure

代替 semantic mismatch。

這讓 appf2能區分：

~~~text
technical success
vs
user-perceived correctness
~~~

# 48. Correction Success Semantics

Correction不以「child generated」作成功。

Stages：

~~~text
REQUESTED
→ GENERATED
→ ACCEPTED / REJECTED / REVERTED
~~~

Product success evidence：

- GENERATED = 系統成功提出可比較修正版。
- ACCEPTED = User認為新版本值得採用。
- REJECTED = 新版本未解決問題 / User選舊版。
- REVERTED = 曾接受後又返回舊版，屬負向/修正 evidence。

真正最強 signal：

> correction ACCEPTED 且後續沒有立即再次 semantic mismatch。

F07可在後續 Evidence Review計算。

# 49. Frontend State

## F16-DATA-008

~~~text
CorrectionUIState
├─ status
├─ correction_id?
├─ base_blueprint_hash
├─ feedback_draft
├─ expected_result_draft?
├─ before_snapshot_local
├─ intent_id?
├─ intent_version?
├─ questions?
├─ assumptions?
├─ correction_delta_summary?
├─ child_blueprint_hash?
├─ child_runtime_instance_id?
├─ after_snapshot_local?
├─ comparison_mode?
├─ durable_outcome?
└─ error_code?
~~~

Local snapshot可含 MEMORY_ONLY protected values；durable payload不可。

# 50. Accessibility / UX Safety

Correction composer：

- keyboard accessible
- current result有 semantic label
- correction feedback textarea有 label
- compare previous/new不只靠顏色
- mobile可 stacked comparison
- Accept / Keep Previous文字明確
- destructive-looking Revert需清楚指出會回到哪個版本
- technical failure overlay由 F12保持 focus / action規則

# 51. Acceptance Criteria

Semantic / Boundary：

- F16-AC-001 semantic mismatch不被分類為 technical Runtime error。
- F16-AC-002 feature addition / input-schema change可路由 F06而不是硬塞 F16。
- F16-AC-003 base Blueprint永不 mutation。
- F16-AC-004 Correction Delta不是 executable JSON patch。
- F16-AC-005 child完整走 F02。
- F16-AC-006 corrected child建立 CORRECT lineage且無 self-lineage。

Replay / Snapshot：

- F16-AC-007 replay input只來自 user-editable input-bound mutable state。
- F16-AC-008 DERIVED / internal capability state不自動進 replay inputs。
- F16-AC-009 SENSITIVE值不預設 durable保存。
- F16-AC-010 DO_NOT_PERSIST值永不 durable保存。
- F16-AC-011 protected value仍可在同一 Browser session MEMORY_ONLY replay。
- F16-AC-012 replay前 child input keys/types/constraints全部驗證。
- F16-AC-013 incompatible input不 silent drop/coerce。
- F16-AC-014 exact replay做不到時comparison標 LIMITED，不假裝 apples-to-apples。

UX / Outcome：

- F16-AC-015 User不需重新輸入可安全 replay的 NORMAL inputs。
- F16-AC-016 correction failure不破壞 current App。
- F16-AC-017 Compare可看到 previous/new result與change summary。
- F16-AC-018 Accept New切到 child但不刪 base。
- F16-AC-019 Keep Previous不刪 child / lineage。
- F16-AC-020 Adjust Again建立新 correction lifecycle。
- F16-AC-021 Revert前重新做 trust / compatibility check。

API / Data：

- F16-AC-022 correction create retry不 duplicate before snapshot / correction record。
- F16-AC-023 comparison retry不 duplicate after snapshot。
- F16-AC-024 stale decision不能覆蓋新 correction outcome。
- F16-AC-025 before/new/after hashes符合 consistency invariant。
- F16-AC-026 result_snapshot只在 correction / explicit compare flow durable建立，不是每次 Runtime。

Evidence：

- F16-AC-027 semantic mismatch、generated、accepted、rejected、reverted可分開量測。
- F16-AC-028 correction accepted不等於技術 generated。
- F16-AC-029 telemetry不含 raw input/result/feedback。
- F16-AC-030 F07可把 correction outcome連回 base/new Blueprint。

Security：

- F16-AC-031 Client不能用 arbitrary Blueprint body作 correction child。
- F16-AC-032 replay不能繞過 F03 state/type constraints。
- F16-AC-033 unsafe/revoked previous Blueprint不可 Revert執行。
- F16-AC-034 correction technical failure進 F12；semantic mismatch本身不進 F12 error。

# 52. Test Mapping Seed

~~~text
F16-AC-001 → TEST-F16-001 mismatch not runtime error
F16-AC-002 → TEST-F16-002 route feature change to F06
F16-AC-003 → TEST-F16-003 base immutability
F16-AC-004 → TEST-F16-004 no JSON patch
F16-AC-005 → TEST-F16-005 full F02 validation
F16-AC-006 → TEST-F16-006 CORRECT lineage
F16-AC-007 → TEST-F16-007 input binding snapshot
F16-AC-009 → TEST-F16-009 sensitive redaction
F16-AC-010 → TEST-F16-010 do-not-persist
F16-AC-012 → TEST-F16-012 replay compatibility
F16-AC-014 → TEST-F16-014 limited comparison disclosure
F16-AC-016 → TEST-F16-016 preserve current App on failure
F16-AC-017 → TEST-F16-017 compare UI contract
F16-AC-021 → TEST-F16-021 safe revert gate
F16-AC-022 → TEST-F16-022 correction idempotency
F16-AC-024 → TEST-F16-024 decision conflict
F16-AC-025 → TEST-F16-025 snapshot integrity
F16-AC-027 → TEST-F16-027 outcome evidence
F16-AC-029 → TEST-F16-029 evidence privacy
F16-AC-032 → TEST-F16-032 replay state constraints
~~~

# 53. Dependencies

Upstream：

- F00 correction / compare shell
- F01 CORRECT lifecycle
- F02 child validation
- F03 result / snapshot / replay runtime
- F06 semantic delta principles
- F07 Evidence
- F12 technical Recovery
- DATA-MODEL result_snapshot / correction_record / lineage

Downstream：

- future F10 Reuse quality evidence
- Capability quality / Compiler improvement
- Release Evidence Review

# 54. Release / Migration

Release 1：

~~~text
Result feedback entry
+ before snapshot
+ CORRECT intent
+ correction delta
+ full revalidation
+ same-input replay when safe
+ compare
+ accept / keep previous / adjust again / revert
+ correction evidence
~~~

Phase 1不做：

- autonomous self-healing without User feedback
- background mass correction
- external irreversible replay
- durable account version history
- AI judge declaring result objectively correct
- mutable patching of old Blueprint

# 55. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F03-RQ-012 correction replay exact interface與comparison downgrade rules。
- F00 accepted correction後的 current-session Revert entry。
- F07 correction evidence / Result privacy / retention。
- F12 exact technical recovery ownership。

非 blocker、可後續迭代：

1. Product Evidence Review可定 accepted後多久未再次 mismatch算 stronger correction success。
2. F10 future reuse ranking可用 aggregated correction evidence，但不得使用個別 sensitive snapshot作 retrieval corpus。
3. F08 future account history可顯示 accepted/reverted versions。
4. Future external capability需 effect-safe replay contract後才可做 exact comparison。

# Conclusion

F16 Current Truth：

~~~text
Technical Runtime Success
≠ Semantic Success

User reports mismatch
→ preserve base + replayable inputs + before result
→ correction intent
→ minimal semantic correction
→ full new Blueprint validation
→ CORRECT lineage
→ replay same safe inputs
→ compare before / after
→ accept / keep previous / adjust again / revert
→ evidence
~~~

> F16 的價值不是「AI 自己修自己」，而是讓 User 能指出語意錯誤，而 appf2 用可追蹤、可回退、可比較的方式產生真正的新版本。
