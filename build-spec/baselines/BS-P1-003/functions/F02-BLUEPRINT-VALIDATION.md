# F02 — Blueprint Validation / Trust Admission

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Executable Blueprint + L3 Validation 的 Working Current Truth。
>
> 上游：APP-ARCHITECTURE、APP-DETAILED-DESIGN-OVERVIEW、DATA-MODEL、F04-CAPABILITY-REGISTRY、DESIGN-TO-DELIVERY。
>
> 下游：F03 Runtime、F01 Blueprint Composer、F05 Restore、F06 Remix、F16 Correction。
>
> 本文件回答兩件事：
> 1. Blueprint Candidate 必須長什麼樣，才能成為 appf2 可執行 App definition。
> 2. Candidate 必須通過哪些 deterministic validation / trust gates，才准進 Runtime。

# 1. Purpose / User Outcome

User Outcome：

> appf2 產生的 App 不只是 JSON 能 parse，而是所有 state、binding、rule、action、Capability、resource、permission、compatibility 都能被平台安全理解與執行。

Canonical flow：

~~~text
Resolved Intent
→ F04 Capability Coverage
→ F01 Blueprint Candidate
→ F02 Parse / Validate / Admit
   ├─ REJECTED
   ├─ INCOMPATIBLE
   └─ VALIDATED
→ immutable canonical Blueprint
→ content_hash
→ durable blueprint_content
→ F03 Runtime
~~~

核心原則：

> Schema Valid ≠ Semantic Correct，但 Schema / Trust Invalid 一定不能進 Runtime。

# 2. Scope / Non-Scope

Phase 1 定義：

- Blueprint top-level contract
- stable schema version
- exact capability reference
- state model
- node composition
- typed Value Source / Binding
- pure Expression AST
- Rule contract
- Action contract
- Event binding
- result/output declarations
- support / degradation metadata
- canonical JSON serialization
- content hash
- deterministic validation pipeline
- trust admission
- compatibility
- resource ceilings
- security rejection
- validation report
- errors / evidence / acceptance

F02 不負責：

- 理解 raw Intent
- 決定 clarification
- 發明 Capability
- React rendering
- Runtime scheduling
- User-facing recovery copy
- semantic correctness 100% 判斷
- external provider execution
- arbitrary generated code

# 3. Blueprint Lifecycle

## F02-RQ-001 — Candidate vs Admitted Blueprint

~~~text
Blueprint Candidate
= F01 / import / restore 提供、尚未被信任的 JSON

Admitted Blueprint
= Candidate 通過完整 F02 validation 後的 canonical immutable JSON
~~~

只有 Admitted Blueprint 才能：

- 產生 canonical content_hash
- 寫入 blueprint_content
- 被 F03 正常 Runtime 執行
- 成為 durable Share / Remix / Correct base

Rejected Candidate body Phase 1 不預設 durable 保存。

# 4. Top-level Executable Blueprint Contract

Phase 1 logical shape：

~~~json
{
  "schema_version": "1.0.0",
  "registry_version": "1.0.0",
  "kind": "APP",
  "meta": {
    "title": "聚餐分帳",
    "description": "依角色權重計算每人金額"
  },
  "support": {
    "coverage_status": "FULLY_SUPPORTED",
    "degradations": []
  },
  "state": {},
  "rules": [],
  "actions": [],
  "nodes": [],
  "root_node_id": "node_root",
  "result": {
    "outputs": []
  }
}
~~~

Top-level allowed keys：

~~~text
schema_version
registry_version
kind
meta
support
state
rules
actions
nodes
root_node_id
result
~~~

Unknown top-level executable key → reject。

理由：

> 避免 LLM 用多塞欄位偷偷創造 Runtime semantics。

# 5. Version Contract

## F02-RQ-002 — schema_version

Phase 1：

~~~text
schema_version = 1.0.0
~~~

規則：

- PATCH：不改 executable meaning
- MINOR：backward-compatible extension
- MAJOR：breaking syntax / semantics
- Runtime / Validator 必須明確聲明支援 range
- 不允許未知新 version 自動通過

## F02-RQ-003 — registry_version

Blueprint 必須帶產生時使用的 F04 Registry snapshot version。

每個 Node 另外引用 exact：

~~~text
capability_id
capability_version
~~~

Registry version 不取代 capability version。

# 6. Metadata Contract

~~~text
meta.title
meta.description?
~~~

Rules：

- title：1–120 Unicode chars
- description：0–500 chars
- metadata 屬於 canonical Blueprint 並參與 hash
- creator、anonymous_id、created_at、ownership、share_id、prompt/model metadata 不得放進 Blueprint body

# 7. Support / Degradation Contract

~~~text
support.coverage_status:
  FULLY_SUPPORTED
  PARTIALLY_SUPPORTED

support.degradations[]:
  requirement_id
  description
  capability_refs[]
  preserves_semantic_core = true
~~~

Phase 1 Admitted Blueprint 不允許 EXTERNAL_OR_HEAVY_REQUIRED / UNSUPPORTED 冒充 local executable Blueprint。

PARTIALLY_SUPPORTED 必須：

1. 每個 material degradation user-visible
2. preserves_semantic_core = true
3. 引用合法 Registry Capability
4. 不可藉 degradation 改掉核心業務結果

F02 驗證結構與引用；是否真的符合原 Intent，仍由 F01 semantic process + F16 evidence 持續驗證。

# 8. State Contract

## F02-RQ-004 — State Key

State key：

~~~text
^[a-z][a-z0-9_]{0,63}$
~~~

Reserved prefixes：

~~~text
nff_
sys_
__*
~~~

User Blueprint 不得使用。

## 8.1 Mutable State

~~~json
{
  "budget": {
    "mode": "MUTABLE",
    "type": "NUMBER",
    "initial": 400,
    "constraints": {
      "min": 0,
      "max": 1000000
    }
  }
}
~~~

Allowed Phase 1 types：

~~~text
NUMBER
STRING
BOOLEAN
ENUM
LIST
RECORD
~~~

Rules：

- null 不作獨立 state type
- optional value 不靠 undefined
- NUMBER 必須 finite
- STRING 有 length bound
- ENUM 有 bounded allowed values
- LIST 有 item type + max length
- RECORD 有 declared fields，禁止 unbounded arbitrary object

## 8.2 Derived State

~~~json
{
  "per_person": {
    "mode": "DERIVED",
    "type": "NUMBER",
    "expr": {
      "kind": "OP",
      "op": "DIV",
      "args": [
        {"kind": "STATE", "key": "bill_total"},
        {"kind": "STATE", "key": "people"}
      ]
    }
  }
}
~~~

Rules：

- DERIVED 無 initial
- Action 不可直接寫 DERIVED
- dependency graph acyclic
- expression pure / side-effect free

# 9. Value Source Contract

所有 bindable runtime value 使用顯式 Value Source，不允許 free-form expression string。

Allowed：

~~~json
{"kind":"LITERAL","value":100}
~~~

~~~json
{"kind":"STATE","key":"budget"}
~~~

~~~json
{"kind":"RULE","rule_id":"rule_can_submit"}
~~~

Action context 可用：

~~~json
{"kind":"EVENT","path":"value"}
~~~

Repeat scope 可用：

~~~json
{"kind":"SCOPE","name":"item","path":"price"}
~~~

Expression：

~~~json
{
  "kind":"OP",
  "op":"MUL",
  "args":[...]
}
~~~

禁止：

- JavaScript expression string
- template code
- undeclared object path
- function call by name
- global/window/document access

# 10. Expression AST

## F02-RQ-005 — Pure Operator Allowlist

Arithmetic：

~~~text
ADD SUB MUL DIV MOD ABS ROUND FLOOR CEIL MIN MAX
~~~

Comparison：

~~~text
EQ NEQ GT GTE LT LTE
~~~

Boolean：

~~~text
AND OR NOT
~~~

Conditional：

~~~text
IF COALESCE
~~~

List / Aggregate：

~~~text
LENGTH SUM AVG COUNT LIST_MIN LIST_MAX
~~~

String：

~~~text
CONCAT LOWER UPPER TRIM
~~~

Rules：

1. 每個 operator 有 deterministic typed signature
2. unknown operator → reject
3. DIV / MOD zero 必須 bounded typed failure，不允許 Infinity/NaN 漏出
4. AST 不得 recursion / self-reference
5. Random / current time 不屬於 expression operator，必須走 Registry Capability / Runtime service
6. Expression 不做 network / storage / DOM / LLM call

Exact typed signatures 由 F03 實作並回指本 allowlist。

# 11. Rule Contract

Rule 是 pure named expression，不能 mutation state。

~~~json
{
  "id": "rule_can_submit",
  "result_type": "BOOLEAN",
  "expr": {
    "kind":"OP",
    "op":"GT",
    "args":[
      {"kind":"STATE","key":"budget"},
      {"kind":"LITERAL","value":0}
    ]
  }
}
~~~

Rule ID：

~~~text
^rule_[a-z0-9_]{1,58}$
~~~

Rules：

- unique
- no side effects
- no action / capability invocation
- dependency graph acyclic
- output type 必須與 result_type 一致

# 12. Node Contract

~~~json
{
  "id": "node_budget",
  "capability": {
    "id": "input.number",
    "version": "1.0.0"
  },
  "props": {
    "label": {"kind":"LITERAL","value":"預算"},
    "min": {"kind":"LITERAL","value":0}
  },
  "bindings": {
    "value": {"kind":"STATE","key":"budget"}
  },
  "events": {
    "change": "action_set_budget"
  },
  "children": []
}
~~~

Node ID：

~~~text
^node_[a-z0-9_]{1,58}$
~~~

Rules：

1. Node ID unique
2. exact capability ID/version 存在 F04 Registry
3. props/bindings 只能使用 Capability Card 宣告 keys
4. binding output type 匹配 target type
5. event 必須由 Capability 宣告
6. action ref 必須存在
7. children 只有允許 composition 的 Capability 可用
8. root_node_id 可達所有 executable node
9. orphan executable node → reject
10. child graph 不可 cycle

# 13. Repeat / List Scope

Phase 1 bounded repeat：

~~~json
{
  "repeat": {
    "items": {"kind":"STATE","key":"rows"},
    "item_alias":"item",
    "index_alias":"index",
    "max_items":100
  }
}
~~~

Rules：

- 只有 Registry 宣告支援 repeat/template 的 node 可用
- max_items 不超過 platform / capability ceiling
- aliases lexical scoped
- scope path 符合 declared list item type
- no arbitrary template code
- nested repeat depth 有 global limit

# 14. Action Contract

Action = bounded declarative mutation / invocation sequence。

~~~json
{
  "id": "action_set_budget",
  "steps": [
    {
      "type": "SET_STATE",
      "target":"budget",
      "value":{"kind":"EVENT","path":"value"}
    }
  ]
}
~~~

Action ID：

~~~text
^action_[a-z0-9_]{1,56}$
~~~

Allowed Phase 1 step types：

~~~text
SET_STATE
INVOKE_CAPABILITY
RESET_STATE
~~~

SET_STATE：

~~~text
target = MUTABLE state key
value = typed Value Source
when? = BOOLEAN Value Source
~~~

INVOKE_CAPABILITY：

~~~text
target_node_id
capability_action
args
when?
~~~

RESET_STATE：

~~~text
target = mutable state key | ALL_MUTABLE
~~~

Rules：

1. steps 保持 declared order
2. action 不可呼叫另一 Blueprint action
3. no loops / recursion
4. max steps 受 global limit
5. failed step 由 F03 定義 bounded failure semantics，不可假裝 success

# 15. Event Binding Contract

~~~text
Node capability event
→ Action ID
~~~

Phase 1 禁止：

- arbitrary inline handler
- event → JavaScript
- event → URL callback
- dynamic action name

Event payload schema 由 F04 Capability Card 提供，F02 type-check EVENT Value Source。

# 16. Result Contract

Blueprint 明確宣告 semantic outputs，避免 F16 從 React tree 猜結果。

~~~json
{
  "result": {
    "outputs": [
      {
        "id":"per_person",
        "label":"每人金額",
        "value":{"kind":"STATE","key":"per_person"},
        "sensitivity":"NORMAL"
      }
    ]
  }
}
~~~

Sensitivity：

~~~text
NORMAL
SENSITIVE
DO_NOT_PERSIST
~~~

Rules：

- output Value Source typed / valid
- F16 durable Result Snapshot 遵守 sensitivity
- DO_NOT_PERSIST 可顯示但不可進 durable snapshot
- Result declaration 不代表 semantic correctness，只提供 canonical result surface

# 17. Canonical JSON Contract

## F02-RQ-006 — Canonicalization

Rules：

1. UTF-8 JSON
2. Object keys 依 Unicode code point lexicographic ascending
3. Array order 保留
4. 無 insignificant whitespace
5. duplicate object keys 禁止
6. undefined、NaN、Infinity 禁止
7. -0 canonicalize 為 0
8. JSON number 使用可 round-trip 最短 decimal representation
9. String 使用標準 JSON escaping；不做 locale-dependent normalization
10. Optional field 缺失與 explicit null 不視為同值；Phase 1 executable schema 原則上不用 null 表達 optional
11. Unknown executable keys Admission 前 reject
12. created_at / ownership / compiler / share metadata 不在 Blueprint body

Canonicalization implementation 必須是一份 shared library，不能各自實作。

# 18. Content Hash Contract

## F02-RQ-007 — Blueprint Identity

~~~text
canonical_json_bytes
→ SHA-256
→ lowercase hex
→ content_hash = sha256:<hex>
~~~

Rules：

- hash 在完整 validation PASS 後計算
- 相同 canonical content → 相同 hash
- canonical content change → hash change
- hash 不包含 DB metadata
- collision / mismatch = critical integrity failure
- blueprint_content.content_hash 使用此 identity

Candidate digest 與 content hash 分離：

~~~text
candidate_digest
= untrusted candidate intake evidence

content_hash
= admitted canonical Blueprint identity
~~~

# 19. Global Phase 1 Resource Ceilings

這些是 Phase 1 Working safety ceiling，可經 material review 調整；Cursor 不得自行放寬。

| Resource | Ceiling |
|---|---:|
| canonical Blueprint bytes | 256 KB |
| nodes | 100 |
| state entries | 100 |
| rules | 100 |
| actions | 100 |
| action steps / action | 16 |
| expression AST nodes / expression | 64 |
| expression nesting depth | 12 |
| UI child nesting depth | 12 |
| repeat nesting depth | 2 |
| initial LIST items | 500 |
| initial STRING chars / state | 8,192 |
| total initial state bytes | 128 KB |
| event bindings | 200 |
| concurrent timers | 10 |
| result outputs | 50 |

Capability Card 可以更低，不可更高。

Limit exceeded → validation reject，不交 Runtime 試跑。

# 20. Validation Pipeline

## F02-RQ-008 — Deterministic Validation Order

~~~text
V01 Intake / JSON Parse
↓
V02 Top-level Schema
↓
V03 Version / Compatibility
↓
V04 Registry Capability Admission
↓
V05 State Definition / Type
↓
V06 Node Graph / Composition
↓
V07 Binding / Expression / Rule Type Check
↓
V08 Action / Event Contract
↓
V09 Resource Bounds
↓
V10 Permission / Security
↓
V11 Support / Degradation Consistency
↓
V12 Canonicalize / Hash
↓
TRUST ADMISSION
~~~

相同 Candidate + Registry + Runtime policy snapshot → 相同 Validation Report。

# 21. V01 — Intake / JSON Parse

Reject：

- invalid JSON
- duplicate keys
- payload bytes > intake ceiling
- non-object root
- prohibited binary / executable payload

先產生 candidate_digest + trace id。

# 22. V02 — Schema Validation

檢查：

- required keys
- allowed keys only
- field type / enum / ID pattern
- bounds
- unique IDs
- exact schema version syntax

unknown executable field → F02-ERR-002。

# 23. V03 — Version / Compatibility

檢查：

- Blueprint schema supported
- Registry snapshot known
- required compatibility range
- no unknown future version auto-accept

Outcome：

~~~text
COMPATIBLE
INCOMPATIBLE
~~~

# 24. V04 — Registry Admission

對每個 Node：

- exact capability ID/version exists
- availability = ENABLED
- not REVOKED
- dependencies available
- execution class Phase 1 allowed
- props/events/actions known

Unknown / disabled / revoked → reject or incompatible，不 dynamic fallback。

# 25. V05 — State Validation

檢查：

- unique keys
- valid type
- initial type
- valid constraints
- bounded list/record
- DERIVED no initial
- dependency cycle
- reserved key
- state size ceilings

# 26. V06 — Node Graph Validation

檢查：

- unique node IDs
- root exists
- all executable nodes reachable
- child refs exist
- no cycle
- composition allowed
- nesting / repeat depth
- repeat scope valid

# 27. V07 — Binding / Rule / Expression Validation

檢查：

- refs exist
- Value Source context allowed
- operator allowlisted
- arg count / types
- result type
- rule graph acyclic
- expression complexity
- EVENT only in action context
- SCOPE only in repeat scope

# 28. V08 — Action / Event Validation

檢查：

- unique action IDs
- capability event exists
- action ref exists
- SET_STATE target mutable
- action value type matches
- INVOKE_CAPABILITY action declared
- args typed
- no recursion / loop
- step count bounded

# 29. V09 — Resource Validation

Aggregate Blueprint + per-Capability resource budget。超 hard ceiling → reject。

# 30. V10 — Permission / Security Validation

Phase 1：

- Core capability permission = NONE / USER_GESTURE
- Core networkAccessAllowed = false
- no script / code / module / import / handler path
- strings never executed as code
- no provider secrets
- privileged Browser API only if Registry explicitly declares and release approves

# 31. V11 — Support / Degradation Validation

檢查：

- FULLY_SUPPORTED 與 degradation consistency
- PARTIALLY_SUPPORTED 必須有 degradation
- preserves_semantic_core = true
- referenced capability valid
- External / Unsupported 不可 admission 為 local app
- 有 F04 Coverage artifact 時做 consistency check

F02 不宣稱可從 JSON 單獨證明 Intent semantic correctness。

# 32. V12 — Canonicalize / Hash / Admission

全部 PASS：

~~~text
validated logical Blueprint
→ canonicalize
→ content_hash
→ ValidationReport = PASSED
→ write validation_run
→ insert-or-get blueprint_content
→ trust_status = VALIDATED
~~~

若同 hash 已存在：

- canonical bytes 必須一致
- reuse immutable body
- 新 validation_run 可指向同 hash

Hash same but bytes differ → critical integrity error。

# 33. Validation Report Contract

~~~text
validation_run_id
candidate_digest
status:
  PASSED
  REJECTED
  INCOMPATIBLE

schema_version
registry_version
registry_digest?
content_hash?    // PASSED only

issues[]:
  error_code
  severity
  stage
  json_path?
  capability_ref?
  message_key
  retryable
  recovery_hint

warnings[]:
  warning_code
  stage
  json_path?
  message_key

resource_usage:
  blueprint_bytes
  node_count
  state_count
  rule_count
  action_count
  event_binding_count
  timer_count

trace_id
~~~

Consumer UX 不直接顯示 internal issue detail；F12 負責 human message / next action。

# 34. Trust Status

Durable trust status：

~~~text
VALIDATED
REVOKED
INCOMPATIBLE
~~~

VALIDATED = admission pass。
REVOKED = security / critical correctness governance。
INCOMPATIBLE = current Runtime / Registry 無法安全執行。

Status 可更新，canonical body 不修改。

# 35. Frontend Behavior

F02 不擁有主要 consumer UI。

透過：

- F00 validation / unsupported recovery
- F01 Composer retry / recompose
- F05 restore trust failure
- F16 correction validation failure

UX：

~~~text
Candidate invalid
→ 保留 User Intent / current working App
→ 不顯示 raw schema stack
→ 提供 Retry / Refine / Keep Previous 等 next action
~~~

# 36. Backend Processing

Canonical service boundaries：

~~~text
validateBlueprintCandidate(candidate, context)
canonicalizeBlueprint(validatedLogicalBlueprint)
hashBlueprint(canonicalBytes)
admitBlueprint(validationResult)
getBlueprintTrust(contentHash)
assertExecutable(contentHash, runtimeContext)
issueExecutionAdmission(contentHash, runtimeContext)
~~~

F02 不呼叫 LLM。

F01 Candidate invalid：

~~~text
F02 reject
→ F01 bounded recompose / recovery
~~~

不是 F02 偷偷修 JSON。

# 37. API / Contract Boundary

F02 可為 Edge internal service/module；是否獨立 public endpoint 由 F01/API design 決定。

Request context：

~~~text
candidate
candidate_source:
  COMPOSER
  RESTORE
  IMPORT
schema_policy_version
registry_version / digest
runtime_version
trace_id
~~~

Response：

~~~text
status
validation_report
content_hash?          // PASSED
canonical_blueprint?  // trusted internal path
~~~

Client 不可傳 trust_status=VALIDATED 自我宣告可信。

Browser / F03 fresh execution gate由 `working/common-core/EXECUTION-ADMISSION.md` 擁有；F02提供current trust assertion，不讓 immutable CDN body本身充當執行授權。

# 38. Data / DB Read-Write

讀：

- F04 Registry / compatibility
- existing blueprint_content
- trust status

寫：

- validation_run
- PASSED 時 insert-or-get blueprint_content

不寫：

- Runtime Instance
- ownership
- share
- arbitrary rejected candidate body

# 39. Error Taxonomy Seed

| ID | Meaning | Stage | Retry |
|---|---|---|---|
| F02-ERR-001 | INVALID_JSON | V01 | NO |
| F02-ERR-002 | SCHEMA_INVALID | V02 | CONDITIONAL |
| F02-ERR-003 | SCHEMA_VERSION_UNSUPPORTED | V03 | NO |
| F02-ERR-004 | REGISTRY_INCOMPATIBLE | V03/V04 | CONDITIONAL |
| F02-ERR-005 | CAPABILITY_INVALID | V04 | CONDITIONAL |
| F02-ERR-006 | STATE_INVALID | V05 | CONDITIONAL |
| F02-ERR-007 | NODE_GRAPH_INVALID | V06 | CONDITIONAL |
| F02-ERR-008 | BINDING_TYPE_INVALID | V07 | CONDITIONAL |
| F02-ERR-009 | EXPRESSION_INVALID | V07 | CONDITIONAL |
| F02-ERR-010 | ACTION_EVENT_INVALID | V08 | CONDITIONAL |
| F02-ERR-011 | RESOURCE_LIMIT_EXCEEDED | V09 | NO |
| F02-ERR-012 | PERMISSION_NOT_ALLOWED | V10 | NO |
| F02-ERR-013 | FORBIDDEN_EXECUTABLE_CONTENT | V10 | NO |
| F02-ERR-014 | DEGRADATION_INVALID | V11 | CONDITIONAL |
| F02-ERR-015 | HASH_INTEGRITY_FAILURE | V12 | NO |
| F02-ERR-016 | BLUEPRINT_REVOKED | Trust | NO |
| F02-ERR-017 | BLUEPRINT_INCOMPATIBLE | Trust | CONDITIONAL |

F12 後續定 consumer copy / next action。

# 40. Security / Permission

- F02-SEC-001 Blueprint 是 data，不是 code。
- F02-SEC-002 禁止 eval / new Function / dynamic import / module URL / script body。
- F02-SEC-003 Capability 必須 exact Registry ref。
- F02-SEC-004 Unknown executable field fail closed。
- F02-SEC-005 Client 不能自我標記 VALIDATED。
- F02-SEC-006 Rejected candidate 不得被 Runtime 使用。
- F02-SEC-007 Runtime 執行前確認 trust + compatibility。
- F02-SEC-008 No external secret in Blueprint。
- F02-SEC-009 Resource bound 在 Runtime 前 enforce。
- F02-SEC-010 Result sensitivity controls durable snapshot eligibility。

# 41. Telemetry / Evidence

正式 envelope 由 F07 定義。

~~~text
F02-EVT-001 validation_started
F02-EVT-002 validation_passed
F02-EVT-003 validation_rejected
F02-EVT-004 validation_incompatible
F02-EVT-005 resource_rejected
F02-EVT-006 security_rejected
F02-EVT-007 blueprint_admitted
F02-EVT-008 trust_revoked
F02-EVT-009 hash_integrity_failure
F02-EVT-010 execution_admission_requested
F02-EVT-011 execution_admission_allowed
F02-EVT-012 execution_admission_denied
F02-EVT-013 execution_admission_failed
~~~

Minimum dimensions：

~~~text
function_id = F02
validation_stage
schema_version
registry_version
capability_id when relevant
error_code when relevant
content_hash when PASSED
trace_id
~~~

Raw Blueprint body 不複製進 telemetry。

# 42. Acceptance Criteria

Technical：

- F02-AC-001 相同 logical Blueprint canonicalize 後 byte-for-byte 相同。
- F02-AC-002 相同 canonical Blueprint 產生相同 SHA-256 content_hash。
- F02-AC-003 任一 canonical content change 改變 content_hash。
- F02-AC-004 invalid / unknown top-level executable key 被拒絕。
- F02-AC-005 unknown capability ID/version 100% 不得 admission。
- F02-AC-006 invalid state / binding / rule / action reference 100% 不得 admission。
- F02-AC-007 node / derived rule cycles 被拒絕。
- F02-AC-008 admitted Blueprint 可保存為 immutable blueprint_content。

Safety / Reliability：

- F02-AC-009 arbitrary JS / eval / dynamic import 無法成為 executable path。
- F02-AC-010 超過 hard resource ceiling 在 Runtime 前被拒絕。
- F02-AC-011 disabled / revoked / incompatible capability 不得 admission / execute。
- F02-AC-012 Client supplied trust flag 無法繞過 validation。
- F02-AC-013 validation failure 不破壞既有 validated Blueprint。
- F02-AC-014 rejected candidate body 不成為 executable durable artifact。

Semantic / Product：

- F02-AC-015 PARTIALLY_SUPPORTED 必須有 explicit user-visible degradation metadata。
- F02-AC-016 semantic core not preserved 不得 admission 為 partial success。
- F02-AC-017 result surface 有 explicit outputs，不需 F16 從 UI tree 猜結果。
- F02-AC-018 Runtime Instance state change 不改 Blueprint hash。

Evidence：

- F02-AC-019 每次 validation 可追蹤 stage / error / trace。
- F02-AC-020 validation evidence 不需要 telemetry raw Blueprint body。
- F02-AC-021 admitted Blueprint 可追到 admitting validation_run。
- F02-AC-022 trust revoke / incompatible 可追蹤但不 mutation Blueprint body。

# 43. Test Mapping Seed

~~~text
F02-AC-001 → TEST-F02-001 canonical serialization
F02-AC-002 → TEST-F02-002 stable hash
F02-AC-003 → TEST-F02-003 hash content sensitivity
F02-AC-004 → TEST-F02-004 unknown key fail-closed
F02-AC-005 → TEST-F02-005 unknown capability rejection
F02-AC-006 → TEST-F02-006 broken refs / types
F02-AC-007 → TEST-F02-007 cycle detection
F02-AC-009 → TEST-F02-009 forbidden executable content
F02-AC-010 → TEST-F02-010 resource bounds
F02-AC-011 → TEST-F02-011 trust / compatibility denial
F02-AC-012 → TEST-F02-012 trust spoof prevention
F02-AC-015 → TEST-F02-015 degradation required
F02-AC-017 → TEST-F02-017 explicit result surface
F02-AC-021 → TEST-F02-021 validation lineage
~~~

完整 Executable Acceptance 在全部 Function contracts 完成後再升級。

# 44. Dependencies

Upstream：

- DATA-MODEL immutable Blueprint / validation_run
- F04 exact Capability Registry
- Architecture no-arbitrary-code
- Delivery traceability

Downstream：

- F03 Runtime semantics
- F01 Blueprint Composer output
- F05 Share / Restore trust checks
- F06 Remix new Blueprint
- F12 Validation Recovery
- F16 Correction revalidation / result surface

# 45. Release / Migration

Phase 1：

~~~text
LegoSpec / Blueprint schema = 1.0.0
Static trusted F04 Registry
SHA-256 content-addressed immutable Blueprint
~~~

Compatibility：

- old Blueprint 不重寫
- Runtime 支援舊 schema/version → execute
- deprecated capability supported → warning
- incompatible / revoked → Recovery
- migration 若產生新 Blueprint body → new content_hash + lineage

# 46. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F03 operator/evaluation/runtime transaction semantics已建立。
- F01 Composer / Candidate boundary已建立。
- F12 recovery mapping已建立並由 machine-readable Recovery Registry承接。
- F16 Result Snapshot / sensitivity / correction flow已建立。
- Fresh Execution Admission已由 working/common-core/EXECUTION-ADMISSION.md 固定。

未來擴充 Date/Time、Map、Media input、async/external Action時，必須走 versioned extension，不回寫 Phase 1 contract。

# Conclusion

Executable Blueprint Current Truth：

~~~text
Resolved Intent
→ exact registered capabilities
→ declarative state / nodes / rules / actions
→ no executable code
→ deterministic validation
→ canonical JSON
→ SHA-256 immutable identity
→ Trust Admission
→ Runtime
~~~

> Blueprint 是可驗證的資料，不是生成出來的程式碼。只有完整通過 F02 的 canonical Blueprint 才是 appf2 可以信任與執行的 App。
