# F12 — Humanized Recovery Orchestration

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Cross-Function Error Classification、Recovery Policy、Context Preservation、Humanized Message、Next Action、Recovery Episode Evidence 的 Working Current Truth。
>
> 上游：F00–F07 Function contracts、DESIGN-TO-DELIVERY。
>
> 下游 / collaborators：F16 Result Correction，以及所有需要 Consumer Recovery 的 Function。
>
> F12 不取代各 Function 的 stable error code。F00-ERR、F01-ERR、F02-ERR 等仍是 technical identity；F12 負責把它們轉成一致的 recovery class、policy、preserved context、human message 與 next action。

# 1. Purpose / User Outcome

User Outcome：

> 當 appf2 某一步失敗時，User 不需要理解 HTTP、schema、provider、Runtime 或 stack trace；系統會保留能保留的內容，說清楚發生了什麼，並給出可以真正繼續的下一步。

Canonical flow：

~~~text
Technical Failure
→ Source Function Error Code
→ F12 Error Classification
→ Recovery Policy
→ Preserve Safe Context
→ Humanized Recovery State
→ F00 / Function-specific UX
→ User Next Action
→ Recovered | Abandoned | Escalated
→ F07 Evidence
~~~

核心原則：

1. Technical Error ID 由 source Function 擁有。
2. Recovery policy 由 F12 擁有。
3. Consumer 不看 raw engineering error。
4. Recoverable failure 優先保留 context。
5. Retry 必須 bounded。
6. Unsupported / security / incompatibility 不 fake success。
7. Recovery outcome 必須可量測。

# 2. Scope / Non-Scope

F12 Phase 1 負責：

- cross-function error classification
- recovery severity
- retryability semantics
- context preservation policy
- safe fallback policy
- human message contract
- next action contract
- retry budget
- recovery episode identity
- recovery state machine
- source error → recovery policy mapping
- node/action/function/instance blast-radius rules
- consumer vs diagnostic separation
- UX integration contract
- evidence / metrics
- security / privacy
- acceptance / tests

F12 不負責：

- 定義 F00–F07 的 source error code
- 修改 F01 Clarification Policy
- 修改 F02 Validation semantics
- 修改 F03 Runtime transaction semantics
- 自動修 Blueprint
- 用 LLM自由生成 recovery decision
- 把 unsupported capability假裝 supported
- durable support ticket system
- customer-service CRM
- account ownership recovery
- semantic correction本身；那是 F16

# 3. SSOT Boundary

## F12-RQ-001

Error identity：

~~~text
source_error_code
= Fxx-ERR-nnn
~~~

Recovery identity：

~~~text
recovery_policy_id
= F12-POL-nnn
~~~

Rules：

1. F12 不把 F03-ERR-011 改名成 F12-ERR-xxx。
2. 一個 source error 可在不同 context下映射不同 recovery policy。
3. 一個 recovery policy可處理多個 source error。
4. source Function仍負責 technical trigger與diagnostic context。
5. F12負責 user-safe handling contract。

# 4. Common Recovery Classification

## F12-DATA-001

所有 expected failure先映射到 recovery_class：

~~~text
USER_INPUT_INVALID
USER_DECISION_REQUIRED
TRANSIENT_DEPENDENCY
RATE_LIMITED
TIMEOUT
NOT_FOUND
EXPIRED_OR_REVOKED
UNSUPPORTED
INCOMPATIBLE
RESOURCE_LIMIT
LOCAL_EFFECT_FAILURE
PARTIAL_COMPONENT_FAILURE
STATE_OR_ACTION_FAILURE
SECURITY_TERMINAL
INTEGRITY_FAILURE
INTERNAL_INVARIANT
~~~

Recovery class不是 replacement error code；只是跨 Function共用處理維度。

# 5. Severity

## F12-DATA-002

~~~text
INFO
DEGRADED
BLOCKING_RECOVERABLE
TERMINAL
CRITICAL
~~~

INFO：
- 不阻斷主要 flow
- 例如 no_effective_change

DEGRADED：
- 部分功能不可用
- 核心 App仍可使用

BLOCKING_RECOVERABLE：
- 當前操作不能完成
- 有安全 next action

TERMINAL：
- 當前 operation / artifact不能安全繼續
- 但可回安全狀態

CRITICAL：
- integrity / security invariant疑似破壞
- 停止相關 execution path
- diagnostics必須保留 trace

# 6. Retryability

## F12-DATA-003

~~~text
NO_RETRY
USER_ACTION_REQUIRED
IMMEDIATE_RETRY
RETRY_LATER
CONDITIONAL_RETRY
~~~

Rules：

- Security terminal / integrity failure = NO_RETRY。
- malformed User input = USER_ACTION_REQUIRED。
- transient network/provider = IMMEDIATE_RETRY 或 RETRY_LATER。
- incompatibility = CONDITIONAL_RETRY。
- retryable不代表無限 retry。

# 7. Recovery State Contract

## F12-DATA-004

~~~text
RecoveryState
├─ recovery_episode_id
├─ source_function_id
├─ source_error_code
├─ recovery_class
├─ severity
├─ retryability
├─ policy_id
├─ human_message_key
├─ human_detail_key?
├─ preserved_context[]
├─ lost_context[]
├─ next_actions[]
├─ primary_action_id?
├─ safe_surface
├─ diagnostic_ref?
└─ evidence_context
~~~

Consumer surface只需要：

~~~text
human_message_key
human_detail_key?
next_actions
safe_surface
~~~

Technical diagnostics保留：

~~~text
source_error_code
policy_id
diagnostic_ref
trace_id
~~~

# 8. Recovery Episode

## F12-RQ-002

每一次真正需要 User看到或採取動作的 recovery flow：

~~~text
recovery_episode_id = UUID
~~~

Episode lifecycle：

~~~text
OPENED
→ ACTION_SELECTED
→ RECOVERED
or ABANDONED
or ESCALATED
or TERMINATED
~~~

Rules：

1. 同一 technical retry loop不因每次 backend attempt建立新 episode。
2. 同一 User-visible recovery context保留同 episode ID。
3. User開啟新 semantic operation時可關閉舊 episode並建立新 episode。
4. recovery_episode_id放 F07 event properties；Phase 1不建立 recovery_episode DB table。

# 9. Context Preservation Classes

## F12-DATA-005

~~~text
PROMPT_DRAFT
INTENT_RECORD
CLARIFICATION_ANSWERS
VISIBLE_ASSUMPTIONS
RESOLVED_INTENT
CURRENT_BLUEPRINT
CURRENT_RUNTIME_INSTANCE
CURRENT_RESULT
SOURCE_BLUEPRINT
CHANGE_DRAFT
CORRECTION_DRAFT
BEFORE_RESULT_SNAPSHOT
SHARE_REFERENCE
CHILD_BLUEPRINT
LOCAL_UI_STATE
~~~

Rules：

- preserve不代表 durable persist。
- 是否可以保存仍受 privacy / sensitivity policy限制。
- DO_NOT_PERSIST資料不能因 Recovery被寫進 durable storage。
- unsafe / corrupted context不得標記 preserved。

# 10. Safe Surface

## F12-DATA-006

~~~text
DISCOVER
CREATE
APP_CURRENT
APP_PREVIOUS
COMPARE
SHARE_ROUTE
NONE_FATAL
~~~

F12不操作 router；F00執行 presentation / navigation。

# 11. Next Action Contract

## F12-DATA-007

~~~text
RecoveryAction
├─ action_id
├─ action_type
├─ label_key
├─ priority
├─ requires_user_input
├─ target_function?
└─ payload_ref?
~~~

action_type：

~~~text
RETRY
RETRY_LATER
EDIT_REQUEST
ANSWER_QUESTION
ACCEPT_DEGRADATION
KEEP_CURRENT_APP
KEEP_PREVIOUS
USE_SIMPLER_VERSION
RETURN_HOME
RELOAD
REFRESH_COMPATIBILITY
REMIX
CORRECT_RESULT
CANCEL
CONTACT_SUPPORT
CONTINUE
~~~

Rules：

1. next action必須真能執行。
2. primary action最多1個。
3. visible actions通常1–3個。
4. 不提供必然失敗的 Retry。
5. CONTACT_SUPPORT不是 Phase 1 default escape hatch。

# 12. Human Message Contract

## F12-RQ-003

Consumer copy使用 stable message key：

~~~text
recovery.intent.provider_unavailable
recovery.blueprint.validation_failed
recovery.runtime.component_failed
recovery.share.not_found
recovery.share.incompatible
recovery.change.unsupported
~~~

Rules：

- 不顯示 raw 401 / 404 / 500作主訊息
- 不顯示 stack trace
- 不承諾系統做不到的修復
- 說明現在發生什麼
- material時說明保留了什麼
- CTA與 next action一致

Localization copy不是 semantic truth；message key + meaning才是 contract。

# 13. Recovery Policy Evaluation

## F12-RQ-004

Input：

~~~text
source_error_code
source_function_id
operation_context
runtime_context?
preservation_candidates[]
retry_attempts
compatibility_context?
security_context?
~~~

Output：

~~~text
RecoveryState
~~~

Policy evaluation deterministic。

LLM不得決定：

- retryable / terminal
- preserved context
- security fallback
- compatibility bypass
- whether old Blueprint can be mutated

# 14. Core Recovery Policies

## F12-POL-001 — Security / Integrity First

~~~text
SECURITY_TERMINAL
or INTEGRITY_FAILURE
→ stop unsafe path
→ NO_RETRY
→ preserve only safe context
→ TERMINAL | CRITICAL
~~~

## F12-POL-002 — Preserve Last Known Good

如果 failure發生在 Refine、Remix、Correction、Runtime Action、Share creation，而已有 last-known-good App：

~~~text
preserve current / previous good App
→ offer safe return when relevant
~~~

## F12-POL-003 — No Infinite Retry

Retry budget耗盡：

~~~text
retryable transient
→ RETRY_LATER or alternate action
~~~

## F12-POL-004 — Localize Blast Radius

如果 source Function已證明 component failure或 action transaction rollback，且 Instance integrity成立：

~~~text
keep rest of App usable
→ severity <= DEGRADED / BLOCKING_RECOVERABLE
~~~

## F12-POL-005 — Unsupported Is Not Retry

~~~text
UNSUPPORTED
→ no automatic retry
→ Edit / Simplify / Accept supported degradation
~~~

## F12-POL-006 — Incompatible Is Not Silent Recompile

~~~text
INCOMPATIBLE
→ do not silently reinterpret or recompile
→ Refresh Compatibility / Return Home / preserve reference
~~~

## F12-POL-007 — User Input Error Preserves Draft

~~~text
USER_INPUT_INVALID
→ preserve draft
→ highlight actionable field
→ USER_ACTION_REQUIRED
~~~

## F12-POL-008 — Semantic Mismatch Routes to F16

~~~text
technical execution succeeds
+ User says result / logic is wrong
→ not technical recovery
→ CORRECT_RESULT
→ F16
~~~

# 15. Retry Budget

## F12-RQ-005

F12不覆蓋各 Function自身 automatic retry上限。

共同 rule：

~~~text
automatic retry exhausted
→ no further automatic retry
→ user-visible retry or alternate path
~~~

Phase 1 max user-triggered immediate retries in同一 episode：

~~~text
3
~~~

第4次：

- transient依賴 → RETRY_LATER / Edit / Keep current
- terminal error → 本來就不提供 Retry

Runtime action timeout Retry補充：

- 同一 User-visible F12 recovery episode可以有多次 Retry，但每次 Retry都是新的 F03 operation。
- 每次 Retry必須建立新 operation token；舊 token保持 closed，永不復用。
- Retry click只使 episode進 `ACTION_SELECTED / RECOVERING`，不等於成功。
- 只有新 operation成功 commit並回到 safe continuation，episode才標 `RECOVERED`。

# 16. F00 Presentation Mapping

~~~text
INFO
→ inline notice

DEGRADED
→ inline / node-level notice

BLOCKING_RECOVERABLE
→ blocking recoverable overlay / creation panel

TERMINAL
→ terminal safe-state view

CRITICAL
→ stop affected path + generic safe failure view
~~~

F00不自行猜 source_error_code的 recovery。

# 17. F01 Recovery Mapping

| Source | Class | Policy | Preserve | Next Action |
|---|---|---|---|---|
| F01-ERR-003 CLARIFICATION_ANSWER_INVALID | USER_INPUT_INVALID | F12-POL-007 | intent + answers | ANSWER_QUESTION |
| F01-ERR-005 MODEL_PROVIDER_RATE_LIMITED | RATE_LIMITED | F12-POL-003 | intent | RETRY_LATER |
| F01-ERR-006 MODEL_PROVIDER_UNAVAILABLE | TRANSIENT_DEPENDENCY | F12-POL-003 | intent | RETRY / RETRY_LATER |
| F01-ERR-008 CAPABILITY_UNSUPPORTED | UNSUPPORTED | F12-POL-005 | resolved intent | EDIT_REQUEST |
| F01-ERR-009 OPERATION_TIMEOUT | TIMEOUT | F12-POL-003 | operation identity | RETRY |
| F01-ERR-012 SECURITY_TERMINAL | SECURITY_TERMINAL | F12-POL-001 | safe context | EDIT_REQUEST / CANCEL |

# 18. F02 Recovery Mapping

| Source Class | Recovery Class | Policy | Preserve | Next Action |
|---|---|---|---|---|
| schema / binding / action invalid | STATE_OR_ACTION_FAILURE | bounded composer recovery | resolved intent | RETRY via F01 if budget remains |
| RESOURCE_LIMIT_EXCEEDED | RESOURCE_LIMIT | F12-POL-005 | resolved intent | EDIT_REQUEST / USE_SIMPLER_VERSION |
| PERMISSION_NOT_ALLOWED | SECURITY_TERMINAL | F12-POL-001 | intent | EDIT_REQUEST |
| FORBIDDEN_EXECUTABLE_CONTENT | SECURITY_TERMINAL | F12-POL-001 | safe intent context | EDIT_REQUEST |
| BLUEPRINT_REVOKED | EXPIRED_OR_REVOKED | F12-POL-001 | Blueprint ref | KEEP_PREVIOUS / RETURN_HOME |
| BLUEPRINT_INCOMPATIBLE | INCOMPATIBLE | F12-POL-006 | Blueprint ref | REFRESH_COMPATIBILITY / RETURN_HOME |

F02 internal validation report不直接顯示 Consumer。

# 19. F03 Recovery Mapping

| Source | Class | Severity | Preserve | Next Action |
|---|---|---|---|---|
| action step failure | STATE_OR_ACTION_FAILURE | BLOCKING_RECOVERABLE | last committed state | RETRY / CONTINUE |
| local effect failure | LOCAL_EFFECT_FAILURE | DEGRADED | App state | RETRY |
| node render failure | PARTIAL_COMPONENT_FAILURE | DEGRADED | App + other nodes | RETRY / CONTINUE |
| runtime version incompatible | INCOMPATIBLE | TERMINAL | Blueprint ref | RELOAD / RETURN_HOME |
| loop guard | STATE_OR_ACTION_FAILURE | BLOCKING_RECOVERABLE | last committed state | KEEP_CURRENT_APP / RELOAD |
| F03-ERR-021 RUNTIME_ACTION_TIMEOUT | TIMEOUT | BLOCKING_RECOVERABLE | CURRENT_BLUEPRINT + last committed CURRENT_RUNTIME_INSTANCE + CURRENT_RESULT when valid | RETRY + KEEP_CURRENT_APP；budget exhausted時 KEEP_CURRENT_APP + RETRY_LATER |
| invariant broken | INTERNAL_INVARIANT | CRITICAL | safe Blueprint ref | RELOAD / RETURN_HOME |

F03 atomic rollback / node isolation仍是 source truth。

Runtime timeout precedence：

- F03可以證明 atomic transaction未 commit且 Instance integrity成立 → `F12-POL-011`。
- F03無法證明 integrity → 不把 F03-ERR-021「升級」成另一種 timeout；直接產生既有 `F03-ERR-018 RUNTIME_INVARIANT_BROKEN`，由 `F12-POL-001`接管。
- F12不自行推測 Runtime integrity。

# 20. F04 Recovery Mapping

~~~text
PARTIALLY_SUPPORTED
→ ACCEPT_DEGRADATION or EDIT_REQUEST

UNSUPPORTED
→ EDIT_REQUEST / USE_SIMPLER_VERSION

EXTERNAL_OR_HEAVY_REQUIRED in Phase 1
→ EDIT_REQUEST

Registry security revoke
→ SECURITY_TERMINAL / INCOMPATIBLE
→ no bypass
~~~

# 21. F05 Recovery Mapping

| Source | Class | Preserve | Next Action |
|---|---|---|---|
| SHARE_CREATE_FAILED | TRANSIENT_DEPENDENCY | current App | RETRY |
| SHARE_NOT_FOUND | NOT_FOUND | route | RETURN_HOME |
| SHARE_EXPIRED | EXPIRED_OR_REVOKED | route | RETURN_HOME |
| SHARE_REVOKED | EXPIRED_OR_REVOKED | route | RETURN_HOME |
| BLUEPRINT_FETCH_FAILED | TRANSIENT_DEPENDENCY | share ref | RETRY |
| BLUEPRINT_INCOMPATIBLE | INCOMPATIBLE | share ref | RELOAD / RETURN_HOME |
| RESTORE_HYDRATION_FAILED | STATE_OR_ACTION_FAILURE | Blueprint ref | RETRY / RETURN_HOME |
| SHARE_COPY_FAILED | LOCAL_EFFECT_FAILURE | share URL | RETRY |

# 22. F06 Recovery Mapping

| Source | Class | Preserve | Next Action |
|---|---|---|---|
| SOURCE_BLUEPRINT_NOT_FOUND | NOT_FOUND | change draft | RETURN_HOME / EDIT_REQUEST |
| SOURCE_BLUEPRINT_UNTRUSTED | SECURITY_TERMINAL | draft | KEEP_CURRENT_APP |
| CHANGE_CLARIFICATION_REQUIRED | USER_DECISION_REQUIRED | source + draft | ANSWER_QUESTION |
| CHANGE_COMPOSITION_FAILED | TRANSIENT_DEPENDENCY | source + resolved change | RETRY / EDIT_REQUEST |
| CHANGE_UNSUPPORTED | UNSUPPORTED | source App | EDIT_REQUEST / KEEP_CURRENT_APP |
| CHILD_HYDRATION_FAILED | STATE_OR_ACTION_FAILURE | source + child hash | RETRY / KEEP_CURRENT_APP |
| LINEAGE_WRITE_FAILED | TRANSIENT_DEPENDENCY | source + child | RETRY |
| NO_EFFECTIVE_CHANGE | INFO | source App | KEEP_CURRENT_APP / EDIT_REQUEST |

# 23. F07 Recovery Mapping

Evidence failures原則：

> Evidence不能阻斷產品主流程。

~~~text
event schema invalid
→ diagnostics only

ingest unavailable
→ local retry queue

queue full
→ priority drop

rate limited
→ retry later

anonymous identity invalid/disabled
→ rotate identity when safe
~~~

只有 identity issue同時影響產品 server request時，才需要 Consumer recovery。

# 24. F16 Recovery Integration

F16 已建立完整 correction technical error taxonomy 與 F12 mapping。

Canonical source mapping：

> F16-RESULT-CORRECTION.md 的 F16 Error Taxonomy + F12 Recovery Mapping。

F12在這裡不複製第二份逐項表格，避免雙 SSOT。

固定跨 Function 規則：

~~~text
semantic mismatch itself
→ not F12 error
→ F16 product flow

technical failure during correction
→ source identity = F16-ERR-*
→ F12 recovery class / policy
→ preserve base Blueprint + before result + correction draft where safe
~~~

Critical examples：

- correction integrity mismatch → INTEGRITY_FAILURE / fail closed
- replay input incompatible → USER_DECISION_REQUIRED
- child replay failure → preserve base App
- revert target unsafe → INCOMPATIBLE / keep current App

# 25. Recovery State Machine

## F12-STATE-001

~~~text
NONE
→ DETECTED
→ CLASSIFIED
→ PRESENTED
→ ACTION_SELECTED
→ RECOVERING
→ RECOVERED
or ABANDONED
or ESCALATED
or TERMINATED
~~~

Rules：

- auto-retry可在 CLASSIFIED → RECOVERING，不一定先 PRESENTED。
- automatic recovery成功且對 User無影響，可不顯示 episode。
- 一旦需要 User action，必須有 episode ID。

# 26. Automatic vs User-visible Recovery

## F12-POL-009

Automatic recovery只允許：

- transient
- bounded
- preserves semantics
- no hidden material decision
- no security downgrade

例如 network retry、telemetry buffer、idempotent metadata retry。

不得 automatic：

- accept material degradation
- choose ambiguous business rule
- bypass permission
- reinterpret incompatible Blueprint
- delete User data
- replace semantic result

# 27. Recovery API Strategy

Phase 1 F12不建立 public recovery endpoint。

Canonical internal interface：

~~~text
resolveRecovery(errorContext)
recordRecoveryAction(episodeId, action)
closeRecoveryEpisode(episodeId, outcome)
~~~

如果 next action需要 network，使用 target Function原本 API。

這避免 Recovery變成第二個 orchestration backend。

# 28. Frontend Contract

~~~text
RecoveryPresentation
├─ episode_id
├─ severity
├─ message_key
├─ detail_key?
├─ next_actions[]
├─ primary_action_id?
└─ safe_surface
~~~

UI rules：

- default顯示 primary action + 最多2 secondary。
- raw technical details預設隱藏。
- internal/dev build可展開 diagnostic_ref。
- blocking recovery時 focus移到 recovery heading / first action。
- close overlay若會失去 context，必須明確。

# 29. Context Loss Disclosure

## F12-UX-001

若 lost_context包含 material User內容：

> UX 必須說明哪部分需要重新輸入 / 無法保留。

不能默默清空。

# 30. Humanized Message Examples

Provider unavailable：

~~~text
「現在暫時無法完成這一步，你的需求已保留。」
Primary: 再試一次
Secondary: 稍後再試
~~~

Unsupported：

~~~text
「這個版本目前還做不到其中一部分。」
Primary: 修改需求
Secondary: 使用較簡單版本
~~~

Node failure：

~~~text
「這個區塊暫時無法使用，其他部分仍可繼續。」
Primary: 再試一次
~~~

Share not found：

~~~text
「這個分享連結目前無法使用。」
Primary: 回首頁
~~~

# 31. Security / Privacy

- F12-SEC-001 Consumer message不得洩漏 provider secret / stack / SQL / internal path。
- F12-SEC-002 Recovery不能降低 F02/F04 trust requirement。
- F12-SEC-003 Recovery不能用 stale / revoked Blueprint強制執行。
- F12-SEC-004 preserved_context受原 sensitivity policy約束。
- F12-SEC-005 diagnostic_ref只提供 internal diagnostics。
- F12-SEC-006 Recovery action payload不能讓 Client注入 arbitrary internal action。
- F12-SEC-007 automatic recovery不能接受 money / permission / irreversible assumptions。
- F12-SEC-008 Recovery evidence不複製 raw context。
- F12-SEC-009 Critical integrity/security error fail closed。

# 32. Evidence Contract

F07 common envelope生效。

~~~text
F12-EVT-001 recovery_presented
F12-EVT-002 recovery_action_selected
F12-EVT-003 recovery_started
F12-EVT-004 recovery_succeeded
F12-EVT-005 recovery_failed
F12-EVT-006 recovery_abandoned
F12-EVT-007 recovery_escalated
F12-EVT-008 terminal_failure_presented
~~~

Allowed properties：

~~~text
recovery_episode_id
source_function_id
source_error_code
recovery_class
severity
policy_id
action_type
attempt_no
safe_surface
outcome
~~~

禁止 raw preserved context。

# 33. Recovery Success Semantics

## F12-RQ-006

RECOVERED 表示：

> User或system已到達該 policy定義的 safe continuation outcome。

不是：

- User按了 Retry
- overlay關掉
- request重新送出

Examples：

- provider retry後 Create flow回 READY/BUILDING → recovered
- node retry後 component恢復 → recovered
- unsupported flow User修改需求並重新進 Analyze → recovered
- User選 Keep Current App離開 failed Refine → recovered to safe previous state

ABANDONED：
- User離開且沒有達到 safe continuation

TERMINATED：
- terminal policy正常結束 unsafe operation並回 safe surface

# 34. Recovery Metrics

~~~text
Recovery Presentation Rate
Recovery Action Selection Rate
Recovery Success Rate
Recovery Abandon Rate
Recovery Success by source Function
Recovery Success by error class
Retry Exhaustion Rate
Mean Recovery Attempts
Time to Recovery
Terminal Failure Rate
~~~

不能把 Retry clicked當 Recovery Success。

# 35. Recovery Episode Dedupe

## F12-POL-010

同一 episode：

~~~text
same source operation
+ same recovery_class
+ same preserved safe context
+ unresolved previous episode
~~~

重複 error不要一直疊新 overlay / 新 episode。

如果 error class、safe context改變，或 User開新 semantic operation，才建新 episode。

## F12-POL-011 — Runtime Timeout Preserve Last Known Good

適用 source：`F03-ERR-021 RUNTIME_ACTION_TIMEOUT`，且 F03已證明 Instance integrity成立。

~~~text
recovery_class = TIMEOUT
severity = BLOCKING_RECOVERABLE
preserve = CURRENT_BLUEPRINT
         + last committed CURRENT_RUNTIME_INSTANCE
         + CURRENT_RESULT when still valid
safe_surface = APP_CURRENT
message_key = recovery.runtime.action_timeout
~~~

Next actions：

- retry budget可用 → Primary `RETRY` + Secondary `KEEP_CURRENT_APP`。
- budget exhausted → `KEEP_CURRENT_APP` + `RETRY_LATER`。

Recovery不是把 state rollback回去：F03 atomic transaction從未修改 committed store；F12只是移除 processing/recovery阻擋並重新露出一直存在的 last committed Runtime state。

若 F03回報 integrity無法證明，F12-POL-011不得套用；`F03-ERR-018 → F12-POL-001`具有優先權，affected execution path停止並進 terminal safe-state。

# 36. Diagnostics Contract

internal diagnostic context可包括：

~~~text
trace_id
request_id
function_id
source_error_code
policy_id
blueprint_hash
capability_id/version
runtime_status
operation_status when relevant
schema_version
registry_version
runtime_version
attempt_no
~~~

不預設包括：

- raw Prompt
- raw Result
- full Runtime state
- secrets

# 37. Accessibility

Blocking recovery：

- focus到 recovery heading / primary action
- screen reader announcement適度
- keyboard可操作所有 next action
- modal可關閉時有明確 close
- terminal screen有 heading + next action
- 不只靠顏色區分 severity

Inline degraded notice不搶輸入中的 focus。

# 38. Error Taxonomy Governance

## F12-RQ-007

新增 expected source error時，source Fxx必須定：

~~~text
stable error ID
trigger
retry hint
preserved context candidates
security implications
~~~

F12補：

~~~text
recovery_class
severity
policy mapping
next action mapping
~~~

Review / CI可檢查：

- expected source error有 recovery mapping
- terminal/security error沒有 unsafe retry
- message_key存在
- next action合法
- evidence mapping存在 when required

# 39. Acceptance Criteria

SSOT / Classification：

- F12-AC-001 source Fxx error code保持唯一 technical identity。
- F12-AC-002 F12不重新編號 source errors。
- F12-AC-003 same error context + policy version產生 deterministic RecoveryState。
- F12-AC-004 security/integrity failure優先於 convenience recovery。

Context：

- F12-AC-005 recoverable Create failure保留 prompt / intent context。
- F12-AC-006 Refine/Remix/Correction failure保留 last-known-good App。
- F12-AC-007 Runtime action failure保留 F03 last committed state。
- F12-AC-008 DO_NOT_PERSIST內容不因 Recovery被 durable保存。
- F12-AC-009 material context loss會告知 User。

Retry / Next Action：

- F12-AC-010 automatic retry有上限。
- F12-AC-011 terminal/security failure不提供必然無效 Retry。
- F12-AC-012 unsupported flow提供 Edit/Simplify而不是無限 Retry。
- F12-AC-013每個 blocking recoverable failure至少有1個有效 next action。
- F12-AC-014 visible next actions通常不超過3個。

UX：

- F12-AC-015 Consumer不看到 raw stack / SQL / provider secret。
- F12-AC-016 raw HTTP status不是主 consumer message。
- F12-AC-017 component-level failure能局部呈現，不強制全App失效。
- F12-AC-018 semantic mismatch導向 F16，不呈現technical error。
- F12-AC-019 blocking recovery keyboard可操作。

Evidence：

- F12-AC-020每個 User-visible recovery episode有 episode ID。
- F12-AC-021 retry click不等於 recovered。
- F12-AC-022 recovered / abandoned / terminated可區分。
- F12-AC-023 recovery event不包含 raw preserved context。
- F12-AC-024 F07可計算 recovery success rate。

Architecture：

- F12-AC-025 F12不建立第二套 public recovery backend。
- F12-AC-026 Recovery不 mutation immutable Blueprint。
- F12-AC-027 Recovery不繞過 F02/F04 trust / compatibility。
- F12-AC-028 telemetry failure本身不阻斷產品 recovery。

Runtime Timeout Delta：

- F12-AC-029 F03-ERR-021在 integrity成立時依 F12-POL-011保留 last-known-good App並回 `APP_CURRENT`。
- F12-AC-030 integrity / critical precedence高於 TIMEOUT convenience recovery；無法證明安全時不得回正常 Runtime。
- F12-AC-031同一 recovery episode每次 Retry都建立新的 F03 operation token，且只有 safe continuation成立才標 `RECOVERED`。

# 40. Test Mapping Seed

~~~text
F12-AC-001 → TEST-F12-001 source error identity
F12-AC-003 → TEST-F12-003 deterministic policy
F12-AC-004 → TEST-F12-004 security precedence
F12-AC-005 → TEST-F12-005 preserve create context
F12-AC-006 → TEST-F12-006 preserve last good App
F12-AC-007 → TEST-F12-007 runtime committed state
F12-AC-008 → TEST-F12-008 no persist sensitive recovery
F12-AC-010 → TEST-F12-010 bounded retry
F12-AC-011 → TEST-F12-011 no terminal retry
F12-AC-013 → TEST-F12-013 valid next action
F12-AC-015 → TEST-F12-015 no raw engineering UX
F12-AC-017 → TEST-F12-017 local component recovery
F12-AC-018 → TEST-F12-018 semantic mismatch routes F16
F12-AC-020 → TEST-F12-020 recovery episode identity
F12-AC-021 → TEST-F12-021 retry not success
F12-AC-023 → TEST-F12-023 evidence privacy
F12-AC-025 → TEST-F12-025 no recovery API
F12-AC-027 → TEST-F12-027 trust cannot bypass
F12-AC-029 → TEST-F12-029 timeout preserves last-known-good APP_CURRENT
F12-AC-030 → TEST-F12-030 integrity precedence over timeout recovery
F12-AC-031 → TEST-F12-031 recovery episode and fresh token separation
~~~

# 40.1 Machine-readable Recovery Registry

Phase 1 Working registry：

~~~text
working/detailed-design/registries/recovery-registry.json
~~~

它是 exact source Error ID → recovery_class / policy_id / severity / retryability / message_key / next_actions / evidence_class 的 machine-readable mapping。

Error meaning仍由各 source Fxx 擁有；F12擁有 shared Recovery semantics。Registry只把已批准 mapping結構化，不建立第二套 Error truth。

# 41. Dependencies

Upstream：

- F00 Shell presentation
- F01 compiler errors
- F02 validation/trust errors
- F03 runtime isolation / rollback
- F04 coverage/trust
- F05 share/restore errors
- F06 remix/refine errors
- F07 Evidence contract

Downstream：

- F16 Correction technical recovery
- all future Fxx expected failure handling

# 42. Release / Migration

Phase 1：

~~~text
source Fxx errors
+ common F12 Recovery classification
+ deterministic policy map
+ F00 presentation
+ recovery episode
+ F07 outcome evidence
~~~

不建立：

- generic workflow engine
- AI-generated recovery logic
- public recovery API
- CRM/support platform
- mutable Blueprint repair
- silent security downgrade

Future F11/F13/F14/F15/F17接入時，只新增 source error mappings與必要 policy，不推翻 F12 common contract。

# 43. Open Decisions

目前沒有阻擋 Phase 1 Core Working Design 的 architecture-level open decision。

已閉合：

- F16 correction technical errors已有 canonical F12 mapping。
- F07 common Evidence Contract已有 recovery episode / outcome承接位置。

後續：

1. Product copy可持續 A/B，但 message meaning / action mapping不能被文案實驗改變。
2. 未來 account/support system可加入 CONTACT_SUPPORT durable case；Phase 1不是 blocker。
3. background async job recovery需未來擴充 policy state，不偷偷塞進 Phase 1。

# Conclusion

F12 Current Truth：

~~~text
Fxx-ERR technical truth
→ common recovery classification
→ deterministic F12 policy
→ preserve safe context
→ human message
→ 1–3 real next actions
→ recover / abandon / terminate
→ F07 evidence
~~~

> Humanized Recovery 不是把錯誤訊息寫得比較漂亮，而是讓 User 在失敗後仍有一條安全、可理解、真的走得下去的路。


---

## Closed Working Delta — Runtime Action Timeout Recovery

> 狀態：WORKING_DELTA_CLOSED（2026-09-22）/ STEP2_RECONCILED
>
> STEP2 reconciliation：本 policy delta已整合回 canonical F12 sections；Build Freeze直接讀整合後 Working truth。

normal F03 Runtime action timeout已由 `F12-POL-011`形成完整 mapping。

### Closed Mapping

~~~text
F03-ERR-021 RUNTIME_ACTION_TIMEOUT
→ recovery_class = TIMEOUT
→ policy_id = F12-POL-011
→ preserve = CURRENT_BLUEPRINT + CURRENT_RUNTIME_INSTANCE(last committed) + CURRENT_RESULT when safe
→ severity = BLOCKING_RECOVERABLE when integrity holds
→ retryability = IMMEDIATE_RETRY / RETRY_LATER by budget
→ safe_surface = APP_CURRENT
~~~

Default consumer meaning：

> 剛才這個操作處理太久，App 已回到上一個安全狀態。

Next actions：
- Primary：再試一次（retry budget仍可用）。
- Secondary：回到 App / 保留目前狀態。
- Budget exhausted：稍後再試。

若 timeout伴隨 Runtime integrity uncertainty：

~~~text
F03 cannot prove integrity
→ F03-ERR-018 RUNTIME_INVARIANT_BROKEN
→ F12-POL-001 / CRITICAL precedence
→ terminal safe-state
→ no unsafe retry
~~~

### Retry Budget

沿用 F12既有規則：
- 同一 recovery episode immediate User Retry最多3次。
- 第4次改 RETRY_LATER 或 alternate safe path。
- 每次 Retry建立新 F03 operation token；old token永不復用。
- Retry click不等於 recovered；新 operation成功回 safe continuation才標 `RECOVERED`。

### Acceptance Closure

新增 `F12-AC-029`–`F12-AC-031` 與 `TEST-F12-029`–`TEST-F12-031`；machine mapping同步在 Working registries。F03負責 stale completion discard與 integrity判斷，F12不重做 Runtime transaction logic。
