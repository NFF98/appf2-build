# F03 — Runtime Execution / Semantics

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Browser Runtime Semantics 的 Working Current Truth。
>
> 上游：APP-ARCHITECTURE、DATA-MODEL、F02-BLUEPRINT-VALIDATION、F04-CAPABILITY-REGISTRY、INFRA-ARCHITECTURE、DESIGN-TO-DELIVERY。
>
> 下游：F00 Experience Shell、F05 Share/Restore、F06 Remix、F07 Evidence、F12 Recovery、F16 Result Correction。
>
> 本文件定義已通過 F02 Trust Admission 的 immutable Blueprint，在 Browser 中如何 hydrate、執行、改 state、算 rule、dispatch event、執行 capability、隔離錯誤與產生 result。Runtime 不理解 raw Intent，也不呼叫 LLM。

# 1. Purpose / User Outcome

User Outcome：

> User 打開 validated Blueprint 後，App 可以立刻在 Browser 安全、可預測地互動；一般 deterministic interaction 不需要 Server / LLM，而且單一 Capability 出錯不拖垮整個 App。

Canonical flow：

~~~text
Admitted Blueprint Body
+ Fresh ExecutionAdmission
→ Trust / Compatibility Check
→ Hydrate Instance
→ Evaluate Derived State / Rules
→ Render Capability Tree
→ Event
→ Action Transaction
→ State Commit
→ Recompute
→ Render
→ Result
~~~

核心規則：

1. Blueprint immutable。
2. Instance mutable。
3. Normal interaction = 0 LLM。
4. Normal local interaction = 0 server dependency。
5. Blueprint 是 data，不是 code。
6. 同一 Instance state mutation single-writer、ordered、bounded。
7. failure 要 fail closed / isolate，不 fake success。

# 2. Scope / Non-Scope

Phase 1 F03 定義：

- Runtime Instance contract
- hydration state machine
- Runtime / Registry compatibility
- mutable / derived state semantics
- expression operator semantics
- rule evaluation
- event dispatch
- Action transaction
- Capability invocation protocol
- staged local effects
- seeded randomness
- timer / monotonic clock
- render tree / node isolation
- result evaluation
- reset
- snapshot / replay metadata
- disposal
- runtime errors / recovery direction
- security / resource enforcement
- evidence / acceptance

Phase 1 不做：

- LLM calls
- external API execution
- remote provider actions
- realtime multiplayer
- durable per-click server state
- arbitrary JavaScript / user scripts
- background workflow engine
- generic offline sync
- cross-device live Instance continuation

# 3. Runtime Subsystems

~~~text
Runtime Host
├─ Instance Store
├─ Expression / Rule VM
├─ Event + Action Dispatcher
├─ Capability Runtime Registry
├─ Local Effect Services
└─ Renderer / Error Isolation
~~~

Responsibilities：

- Runtime Host：lifecycle / hydration / disposal / compatibility。
- Instance Store：mutable state、derived state、capability-local state、runtime status。
- Expression / Rule VM：pure typed evaluation。
- Dispatcher：FIFO event ordering + Action transaction。
- Capability Runtime Registry：F04 trusted handler mapping。
- Local Effect Services：RNG、clock、scheduler、safe visual/audio effect broker。
- Renderer：React view tree + node-level error boundary。

# 4. Runtime Version Contract

## F03-RQ-001 — Runtime Version

Runtime build 必須有：

~~~text
runtime_version
supported_blueprint_schema_range
registry_version
registry_digest
~~~

Hydration 前依 `working/common-core/EXECUTION-ADMISSION.md` 確認：

~~~text
fresh ExecutionAdmission exists
admission content_hash = Blueprint hash
admission not expired
Blueprint trust = VALIDATED
Blueprint schema supported
admission registry_version / registry_digest / validator_registry_digest / runtime_registry_digest
  = exact trusted pinned Registry v7 release bundle
pinned RuntimeRegistry artifact integrity verified
every direct Node CapabilityRef has exact trusted bundled handler mapping in pinned RuntimeRegistry
fresh E07 current-eligibility already PASS
~~~

不符合 → 不 hydrate 正常 App，交 F12 Recovery。

Runtime 不可用 best-effort 猜未知 Blueprint semantics。

# 5. Runtime Instance Contract

Runtime Instance 是 Browser-only mutable execution state。

~~~text
RuntimeInstance
├─ instance_id
├─ instance_epoch
├─ blueprint_hash
├─ runtime_version
├─ registry_version
├─ status
├─ mutable_state
├─ derived_state
├─ rule_cache
├─ capability_state_by_instance
├─ rng
│  ├─ algorithm
│  ├─ seed
│  └─ counter
├─ timers
├─ event_queue
├─ active_operation?
├─ action_sequence
├─ runtime_errors
└─ local_started_at
~~~

instance_id：

- local opaque ID
- 不等於 Blueprint hash
- 不等於 DB durable identity
- reload 預設建立新 Instance，除非未來 explicit restore contract 指定 approved snapshot

instance_epoch：

- local monotonic generation，用於拒絕舊 operation對已 reset / reinitialized / disposed execution context commit。
- reset、reinitialize或其他會 invalidate in-flight operation的 lifecycle transition先 increment epoch並關閉舊 token。
- 不等於 durable revision或 Blueprint version。

### 5.1 Canonical NodeInstanceKey（BF-037）

F02 `Node.id` 是 immutable Blueprint **definition identity**；只要某 Node 位於 ancestor repeat subtree，Runtime 就可能同時存在多個該 definition 的 concrete node instance。Phase 1 不得再用 bare `node_id` 當 concrete instance key。

~~~text
NodeInstanceKey = {
  node_id: NodeId,
  repeat_coordinates: [
    { repeat_node_id: NodeId, item_index: integer }
  ]
}
~~~

Canonical rules：

1. `repeat_coordinates` 依 structural ancestry由 outermost repeat → innermost repeat 排序；只包含實際使 target multiplicative 的 ancestor repeat nodes。
2. `item_index` 是該 repeat 的 zero-based runtime index，必須 `0 <= item_index < admitted repeat.max_items` 且小於本次實際 item count。
3. 不在任何 repeat subtree 的 singleton Node 使用 `repeat_coordinates=[]`。
4. equality / map key identity = exact `node_id` + ordered coordinates；不得只用 `node_id`、DOM position、React key或 renderer object identity替代。
5. NodeInstanceKey 是 Browser Runtime identity，不進 Blueprint body、不參與 content_hash、不等於 Runtime `instance_id`。
6. capability-local state、timer ownership、node-local error isolation、event source concrete identity及其他會指向「某一個 rendered/runtime node clone」的內部 reference 必須使用 NodeInstanceKey；bare `node_id`只能表示 static Blueprint definition。
7. Runtime evidence producer在事件源自 concrete node clone時必須先保留 NodeInstanceKey作 internal correlation context；durable F07 payload仍只能輸出 Evidence Registry 已註冊欄位，未註冊前不得自行新增 property。

同一 Instance因 FIFO single-writer同時最多一個 `active_operation`。

Runtime Instance 永遠不直接 mutation Blueprint。

# 6. Instance Status State Machine

~~~text
UNINITIALIZED
→ HYDRATING
→ READY
   ├─ RECOVERABLE_ERROR
   │   └─ READY
   ├─ FATAL_ERROR
   └─ DISPOSED
~~~

- UNINITIALIZED：尚未載入 Blueprint。
- HYDRATING：做 trust / compatibility / state / graph / capability initialization。
- READY：可接受 User / Timer / Capability event。
- RECOVERABLE_ERROR：局部失敗但 Instance core integrity 仍成立。
- FATAL_ERROR：無法安全繼續。
- DISPOSED：teardown 完成，不再接受 event。

# 7. Hydration Pipeline

## F03-RQ-002 — Deterministic Hydration

~~~text
H01 Load admitted Blueprint
↓
H02 Assert fresh ExecutionAdmission / trust / schema / pinned Registry v7 release identity / runtime compatibility
↓
H03 Build immutable execution indexes
↓
H04 Initialize mutable state
↓
H05 Build derived-state dependency graph
↓
H06 Evaluate derived state topologically
↓
H07 Evaluate named rules
↓
H08 Initialize capability-local state
↓
H09 Initialize RNG / Clock / Scheduler
↓
H10 Build render tree from root_node_id
↓
READY
~~~

H02–H09 critical failure：

- 不進 READY
- 不 render half-trusted tree
- 產生 typed F03 error
- 保留 Blueprint hash / stage / trace context
- 交 F12 Recovery

# 8. Immutable Execution Indexes

Runtime 可從 Blueprint 建：

~~~text
state_definition_by_key
derived_dependents_by_key
rule_by_id
action_by_id
node_by_id
event_binding_by_node
capability_handler_by_ref   // built only from the pinned trusted RuntimeRegistry identified by ExecutionAdmission
result_output_by_id
~~~

這些：

- 只存在 Browser memory
- 可重建
- 不寫回 Blueprint
- 不參與 content_hash
- 不形成第二份 semantic truth

# 9. State Semantics

## F03-RQ-003 — Mutable State

Rules：

1. 只有 SET_STATE / RESET_STATE / trusted Capability protocol 可要求 state change。
2. 所有寫入先 type-check + constraint-check。
3. invalid write 不 commit。
4. Runtime 不自行猜 business coercion。
5. String "10" 不自動變 number 10，除非 Capability contract 明確 normalize。
6. NaN / Infinity 不可進 state。
7. State mutation 不改 Blueprint hash。

## F03-RQ-004 — Derived State

Derived state：

- read-only
- pure
- 依 F02 已驗證 acyclic graph
- dependency change 後 incremental recompute
- Action step mutation 後，在下一 step 前完成受影響 derived recompute

因此後續 Action step 可讀到前一步 mutation 後的新 derived value。

Derived evaluation failure：

- current Action transaction fail
- rollback current Action working state
- 不 commit partial state

# 10. Runtime Value Types

Phase 1：

~~~text
NUMBER
STRING
BOOLEAN
ENUM
LIST<T>
RECORD<declared fields>
ABSENT
~~~

ABSENT 是 VM internal sentinel：

- 只可來自 F02/F04 machine descriptor 明示 optional 的 declared field；Phase 1 實際 owner 是 F04 capability_state optional field。不得由 implementation把普通 missing key或 Blueprint SCOPE path自行解讀成 ABSENT
- F02 Blueprint app-state RECORD Phase 1 禁止 optional_fields，因此 app mutable/derived state不會以 ABSENT 表示「缺值」
- F04 capability_state RECORD 的 optional_fields 可在 initialize 時 absent；present 後必須符合 field descriptor
- 不可保存成 JSON null/undefined，也不可跨 Blueprint durable state boundary
- 不可作 Result output
- 可被 COALESCE 消解
- 未消解就進 typed target → RuntimeError

# 11. Expression VM General Rules

## F03-RQ-005

Expression VM 必須：

- pure
- deterministic under same inputs
- no mutation
- no DOM
- no network
- no storage
- no clock
- no RNG
- no LLM
- no function lookup by string
- no eval / new Function

Evaluation：

~~~text
ValueSource
→ resolve typed operands
→ apply allowlisted operator
→ typed result or typed RuntimeError
~~~

Short-circuit：

- AND：遇 false 停止
- OR：遇 true 停止
- IF：只 evaluate selected branch

# 12. Exact Phase 1 Operator Semantics

## Arithmetic

~~~text
ADD(NUMBER, NUMBER, ... >=2) → NUMBER
SUB(NUMBER, NUMBER) → NUMBER
MUL(NUMBER, NUMBER, ... >=2) → NUMBER
DIV(NUMBER, NUMBER) → NUMBER
MOD(NUMBER, NUMBER) → NUMBER
ABS(NUMBER) → NUMBER
ROUND(NUMBER) → NUMBER
FLOOR(NUMBER) → NUMBER
CEIL(NUMBER) → NUMBER
MIN(NUMBER, ... >=1) → NUMBER
MAX(NUMBER, ... >=1) → NUMBER
~~~

Rules：

- every output finite
- DIV / MOD denominator 0 → F03-ERR-008
- non-finite result → F03-ERR-009

Canonical appf2 ROUND v1：

~~~text
nearest integer
exact .5 tie → toward +infinity
~~~

## Comparison

~~~text
EQ(T,T) → BOOLEAN
NEQ(T,T) → BOOLEAN
GT(NUMBER|STRING, same type) → BOOLEAN
GTE(NUMBER|STRING, same type) → BOOLEAN
LT(NUMBER|STRING, same type) → BOOLEAN
LTE(NUMBER|STRING, same type) → BOOLEAN
~~~

EQ/NEQ Phase 1 T：

~~~text
NUMBER STRING BOOLEAN ENUM
~~~

LIST / RECORD deep equality 不在 Phase 1。

STRING ordering 使用 Unicode code point lexicographic comparison，不使用 locale collation。

## Boolean

~~~text
AND(BOOLEAN,... >=2) → BOOLEAN
OR(BOOLEAN,... >=2) → BOOLEAN
NOT(BOOLEAN) → BOOLEAN
~~~

## Conditional

~~~text
IF(BOOLEAN,T,T) → T
COALESCE(T|ABSENT,... >=2) → T
~~~

全部 ABSENT → evaluation error。

## List / Aggregate

~~~text
LENGTH(STRING) → NUMBER
LENGTH(LIST<T>) → NUMBER
COUNT(LIST<T>) → NUMBER
SUM(LIST<NUMBER>) → NUMBER
AVG(LIST<NUMBER>) → NUMBER
LIST_MIN(LIST<NUMBER>) → NUMBER
LIST_MAX(LIST<NUMBER>) → NUMBER
~~~

- SUM empty = 0
- AVG empty = error
- LIST_MIN/MAX empty = error

### 12.1 Static Descriptor Propagation

> **BF-034 resolution：F03 operator signature 不只回傳 base type；F02 admission 必須能 deterministic 推導 concrete descriptor。Assignability / Join 定義由 F02 §8.1.2 canonical 擁有。**

Rules：

- Arithmetic `ADD/SUB/MUL/DIV/MOD/ABS/ROUND/FLOOR/CEIL/MIN/MAX` → `NUMBER` with no inferred min/max unless operator semantics below explicitly prove bounds；因此不得 static assign 到 bounded NUMBER target，除非 receiving rule另有 canonical invariant。
- `EQ/NEQ` → `BOOLEAN`。Operands 必須是同一 primitive/base family；ENUM operands 必須具有相同 primitive member type，domain 可不同；LIST/RECORD equality Phase 1 仍禁止。
- `GT/GTE/LT/LTE` → `BOOLEAN`；operands 必須為相同 base type的 NUMBER 或 STRING。
- `AND/OR/NOT` → `BOOLEAN`。
- `IF(condition,A,B)` → `Join(descriptor(A), descriptor(B))`。
- `COALESCE(A,B,...)` → 對所有非-ABSENT branch descriptor 做 `Join`；沒有可形成 canonical Join 的 branches → reject。
- `LENGTH/COUNT` → unbounded `NUMBER` descriptor；Runtime result仍 finite/non-negative，但 Phase 1 不把 integer/non-negative refinement塞進 F02 TypeDescriptor。
- `SUM/AVG/LIST_MIN/LIST_MAX` → unbounded `NUMBER` descriptor。
- `LOWER/UPPER/TRIM(STRING(n))` → `STRING(n)`。
- `CONCAT(STRING(n1),...,STRING(nk))` → `STRING(sum(n1..nk))`；sum > 8192 → admission reject，而不是 clamp descriptor。
- RULE result descriptor = expression inferred descriptor；`result_type` 只驗證 top-level base type，不得丟失完整 descriptor。
- DERIVED state同理：完整 inferred descriptor 必須傳遞至 downstream binding / result / action validation。

## String

~~~text
CONCAT(STRING,... >=2) → STRING
LOWER(STRING) → STRING
UPPER(STRING) → STRING
TRIM(STRING) → STRING
~~~

Output 仍必須符合平台 length bounds。

# 13. Rule Evaluation

Rule：

~~~text
rule_id
→ pure Expression
→ cached typed value
~~~

Rules：

1. hydration 時 evaluate all rules。
2. dependency mutation 後只 recompute affected rules。
3. rule cache 只是 optimization。
4. rule error 不默認 false。
5. UI / Capability 若依賴 failed Rule，進 recoverable error path，不猜值。

# 14. Event Model

## F03-RQ-006 — FIFO Single-Writer Queue

所有事件進同一 Instance FIFO queue：

~~~text
User Event
Timer Event
Capability Event
System Event
        ↓
Event Queue
        ↓
one event at a time
        ↓
bound Action
~~~

同一 Instance：

> 同時間只允許一個 Action transaction 修改 state。

Event envelope：

~~~text
event_id_local
sequence
source_node_id
source_node_instance_key
event_name
payload
lexical_scope_bindings
occurred_monotonic_ms
origin:
  USER
  TIMER
  CAPABILITY
  SYSTEM
~~~

`payload` 必須符合 F04 capability event schema。

`source_node_id` 永遠是 static Blueprint Node definition ID；`source_node_instance_key` 永遠是 §5.1 concrete NodeInstanceKey。singleton node也必須帶 `repeat_coordinates=[]`，不得用缺省表示「大概是 singleton」。

BF-036 lexical scope runtime rule：

- `lexical_scope_bindings` 只由 F02-admitted structural repeat ancestry建立，key = admitted alias，value = current item/index runtime value + admitted root TypeDescriptor。
- renderer / DOM / arbitrary callback payload不得新增或覆蓋 scope alias。
- repeat node自己的 alias只進入 repeated structural children的 event envelope，不回灌 repeat node自己的事件。
- dispatcher綁定 Action 時，EVENT與SCOPE都從同一 admitted dispatch-site envelope resolve；Action shared across sites仍使用該次實際 site的 immutable envelope。
- Admission 已保證 Action 內每個 SCOPE 對所有可能 dispatch sites成立；Runtime missing alias / descriptor mismatch視為 F03-ERR-018 invariant broken，不做 fallback。

# 15. Re-entrancy / Loop Guard

若 Capability 在處理 Action 時 emit event：

- 不同步 nested dispatch
- append 到 queue 尾端
- current Action 結束後才處理

Phase 1 guards：

~~~text
max queued events = 256
max events processed per dispatch cycle = 64
max synchronous action commits per dispatch cycle = 64
~~~

超過 → 停止 cycle，產生 F03-ERR-015。

Timer / async local event 下一 browser task 再入 queue。

# 16. Action Transaction Semantics

## F03-RQ-007 — Atomic State Commit

~~~text
Committed Instance State
→ create working state
→ execute declared steps sequentially
→ recompute affected derived/rules between steps
→ stage capability-state patches
→ stage local effects
→ if all steps succeed:
     COMMIT state + capability state
     publish render update
     execute staged effects
     enqueue emitted events
→ if any step fails:
     DISCARD working changes
     DISCARD staged effects
     emit Action Failure
~~~

因此：

> Action state mutation 要嘛全部成功，要嘛不留下半套 state。

## 16.1 F03-RQ-013 — Runtime Operation Identity

每個被 dispatcher接受執行的 Runtime interaction，在執行 Action前建立唯一、不可復用的本地 operation token。token scope只涵蓋該次 admitted interaction，不等於 event ID、recovery episode ID或 network idempotency key。

~~~text
RuntimeOperation
├─ operation_token
├─ instance_id
├─ instance_epoch
├─ admitted_monotonic_ms
├─ soft_deadline_monotonic_ms
├─ hard_deadline_monotonic_ms
├─ checkpoint_plan[]
├─ completed_checkpoints[]
└─ status
~~~

Lifecycle：

~~~text
STARTED → PROCESSING → COMMITTED
                     → TIMED_OUT
                     → FAILED
                     → CANCELLED
~~~

Rules：

1. token在 interaction被接受執行時建立；不能等到 commit後才建立。
2. 每個 admitted interaction恰好一個 token；Retry必須建立新 token，closed token永不 reopen / reuse。
3. `COMMITTED / TIMED_OUT / FAILED / CANCELLED`全部是 terminal closed status。
4. Soft Timeout只是 `PROCESSING` 上的 non-terminal wait condition，不是 lifecycle terminal status。
5. operation token只授權該 operation嘗試 commit；不授權繞過 FIFO、type、constraint、trust或resource rules。
6. F00可訂閱 lifecycle / checkpoint presentation，但不能以 UI state決定 commit。

## 16.2 F03-RQ-014 — Checkpoint / Progress Truth

operation開始時建立 finite、ordered checkpoint plan。checkpoint只代表已完成的真實 work milestone；不代表剩餘時間。

~~~text
progress_percent = completed_checkpoints / planned_checkpoints × 100
~~~

Rules：

- checkpoint completion必須 monotonic、operation-scoped且不可撤回。
- 不同 action可有不同 plan；沒有可靠 plan時只回報 stage，不回報百分比。
- `commit_ready`最多表示 pre-commit validation已完成，不得回報100%。
- 只有 atomic commit已成立、token轉 `COMMITTED`後才可回報100%。
- 不為了讓 progress/loading肉眼可見而延長 action。
- 極快 action可能在同一 browser render frame內完成；logical lifecycle仍存在。

Minimum guard boundaries：

~~~text
operation admission
→ action-step boundary
→ derived/rule recompute boundary
→ pre-commit
→ committed
~~~

不是每個 boundary都必須成為 User-visible checkpoint；只有事先列入 plan且真正完成者才可計數。

## 16.3 F03-POL-001 — Monotonic Deadline + Guard Points

Phase 1維持 Browser main-thread、synchronous Action transaction、no async external Action step。Hard Timeout不宣稱可用 `setTimeout()`強制中斷正在佔用 main thread的 trusted synchronous code。

F03使用 monotonic deadline，並在以下 guard points強制檢查：

1. 每個 action-step boundary前後。
2. 每次 affected derived/rule recompute boundary前後。
3. capability handler返回後。
4. **pre-commit（必查）**。

Soft deadline跨越：

- operation仍是 `PROCESSING`。
- committed store完全不動。
- progress停在最後完成 checkpoint。
- 通知 F00/O05顯示 long-wait copy。

Hard deadline跨越：

~~~text
close token as TIMED_OUT
→ discard working transaction
→ discard staged effects / emitted events
→ preserve committed store unchanged
→ emit F03-ERR-021
→ F12 timeout recovery
~~~

若 trusted synchronous handler在 hard deadline後才返回，後續 guard與 pre-commit guard仍必須拒絕 commit。真正永不返回的 trusted code無法由同一 main thread preempt；由 Capability CI、code review與既有 resource guard防守。需要 hard preemption時才升級至 Worker architecture，不在本 Delta改變 Browser-first Runtime。

## 16.4 F03-RQ-015 — Commit Eligibility / Stale Completion

每次 commit前必須同時證明：

~~~text
token is active + open
AND token is current for the admitted operation
AND instance_epoch matches
AND hard deadline has not elapsed
AND Runtime / Store integrity holds
~~~

任一條不成立：

- 禁止 commit。
- discard working transaction、staged effects與尚未 enqueue的 emitted events。
- closed / stale token永遠不可 reopen。
- late callback / completion只記錄 `stale_completion_discarded` evidence，不可改變 committed store或目前 recovery outcome。

Timeout不是 rollback committed state。因 atomic transaction從未修改 committed store，safe recovery只是丟棄 working copy並重新露出一直存在的 last committed state。

# 17. SET_STATE

1. evaluate optional when。
2. false → SKIPPED。
3. resolve value。
4. type-check。
5. constraint-check。
6. write working mutable state。
7. recompute affected derived/rules。
8. next step 看新值。

禁止：

- write DERIVED
- create undeclared state
- silent coercion
- bypass constraints

# 18. RESET_STATE

Target：

~~~text
one mutable key
or
ALL_MUTABLE
~~~

Reset：

- 回 Blueprint initial
- recompute derived/rules
- 不改 Blueprint
- 不自動 reset unrelated capability-local state

完整 App Reset 可由 F00 用 explicit Action 組合。

# 19. Capability Invocation Protocol

## F03-RQ-008 — Trusted Handler Only

~~~text
target static node_id
→ assert F02-admitted singleton target
→ resolve NodeInstanceKey{node_id, repeat_coordinates=[]}
→ exact CapabilityRef
→ exact handler from Blueprint pinned Registry v7 RuntimeRegistry
→ validate action + resolved args + applicable invariant_ids
→ invoke through RuntimeContext
→ CapabilityInvocationResult
~~~

Conceptual trusted handler：

~~~text
initialize(node_instance_key, node_definition, runtime_context)
invoke(node_instance_key, action_name, args, capability_state, runtime_context)
dispose(node_instance_key, capability_state, runtime_context)
~~~

Blueprint 永遠不能提供 handler。

BF-040 pinned Runtime binding rule：

1. Fresh ExecutionAdmission在進 H02 前已證明 pinned `runtime_registry_digest` 與 trusted release ledger一致，且 direct Node exact CapabilityRef有 handler mapping。
2. H03 `capability_handler_by_ref` **只能**從 admission所指 pinned RuntimeRegistry建立；不得從 deployment current Registry重新 resolve或替換 handler。
3. Current execution Registry只在 fresh admission E07決定「現在是否允許執行」；它不改 old Blueprint pinned executable binding。
4. H02/H03若發現 pinned RuntimeRegistry artifact / release tuple / handler mapping與 admission不一致，視為 runtime/deployment integrity failure，Instance不得READY；不得 dynamic fallback、不得拿 current handler頂替。


BF-037 singleton invoke invariant：Phase 1 Blueprint `INVOKE_CAPABILITY.target_node_id` 已由 F02 保證沒有 repeat ancestor，因此 Runtime invocation 只能解析成 `repeat_coordinates=[]` 的單一 NodeInstanceKey。若 admitted content 出現 multi-instance target，視為 `F03-ERR-018 RUNTIME_INVARIANT_BROKEN`，不得自行選 first/current/nearest clone。

### 19.1 BF-035 Runtime Revalidation for Action Invariants

F02 admission 的 static proof 不取代 Runtime 對 exact resolved values 的 transaction-time enforcement。

Rules：

1. Runtime invoke 前必須依 F04 generated Validator contract 重驗 action name、arg keys、resolved arg base type與 applicable invariant IDs；不得從 prose Card自行建立第二份規則。
2. `RANDOM_MIN_MAX`：即使 F02 已證明 descriptor-level relation，Runtime仍以本次 exact `min` / `max` resolved values檢查 `min <= max`；失敗 → invocation FAILURE，current Action rollback。
3. `SCORE_BOUNDS`：`set` / `reset` / `increment` 的 exact resulting score 必須在 declared bounds；`increment` 一律在 transaction pre-commit 前用 current capability state + resolved delta檢查。超界 → invocation FAILURE，current Action rollback。
4. Runtime revalidation 不得讓 F02 原本無法 static prove 的 `RANDOM_MIN_MAX` candidate 通過 admission；Runtime check 是 defense-in-depth，不是 admission bypass。
5. 所有 invariant failure 必須保持 atomicity：不 commit Blueprint mutable state、capability_state patch、staged effect 或 emitted event。

# 20. Capability Invocation Result

Handler 回傳 declarative result：

~~~text
CapabilityInvocationResult
├─ status: SUCCESS | FAILURE
├─ capability_state_patch?
├─ emitted_events[]?
├─ staged_effects[]?
└─ error?
~~~

Rules：

- patch 符合 capability state schema
- emitted event 符合 declared event schema
- emitted events 在 commit 後入 queue
- staged effects commit 後才執行
- FAILURE → current Action rollback

Trusted code 仍受 Runtime lifecycle 約束。

# 21. Local Effect Semantics

Phase 1 effect classes：

~~~text
SCHEDULE_TIMER
CANCEL_TIMER
VISUAL_EFFECT
AUDIO_PLAYBACK_REQUEST
FOCUS_REQUEST
~~~

只有 registered Capability handler 可要求宣告過的 effect。

Post-commit：

~~~text
state commit
→ render notification
→ staged effects in declared order
~~~

Effect failure：

- 不回滾已完成 state commit
- affected capability 進 recoverable error / safe state
- 產生 evidence
- F12 可提供 retry / continue
- 不把 effect failure 假裝成完全成功

Phase 1 local effect 不得 arbitrary network request。

# 22. Capability-local State

~~~text
capability_state_by_instance[NodeInstanceKey]
~~~

BF-036 optional-field initialization：

1. F04 generated `capability_state` RECORD 可含 F02 `constraints.optional_fields[]`；只有該 list中的 fields允許初始 ABSENT。
2. initialize 建立 capability state 時，所有 non-optional fields必須由 canonical capability initializer產生合法 value；optional fields可 omitted。
3. optional field omitted ≠ null；patch 可首次建立該 field，但 value必須通過 descriptor。
4. handler patch含 undeclared key、刪除 required field、或以 null/undefined模擬 absence → invocation failure + current Action rollback。
5. optional capability state不得序列化進 Blueprint body，也不影響 Blueprint content_hash。

用途：

- timer internal status
- playback local status
- UI ephemeral controller state

Rules：

1. shape 受 F04 schema 限制。
2. 與 Blueprint app state 分離。
3. 不參與 Blueprint hash。
4. Browser-memory only by default。
5. 不存 secret。
6. future share/persist 必須 explicit opt-in。
7. handler 不可 arbitrary global mutation。

# 23. Seeded Randomness

## F03-RQ-009 — appf2 PRNG v1

Phase 1 random / dice / wheel 必須使用 Runtime RNG service，不直接呼叫 Math.random。

Instance seed：

~~~text
crypto.getRandomValues
→ 128-bit instance seed
→ appf2 PRNG v1
~~~

appf2 PRNG v1：

> PCG32-compatible deterministic stream；正式 implementation 必須用 golden-vector tests 固定輸出。

Metadata：

~~~text
algorithm = appf2-PCG32-v1
seed
counter
~~~

Rules：

- same seed + same consumption order → same sequence
- random Capability 只能 consume RNG service
- replay / correction 可記 seed + counter
- 不作 cryptographic security decision

# 24. Timer / Clock Semantics

## F03-RQ-010 — Monotonic Time

Duration / elapsed timer 使用 monotonic time source。

~~~text
performance.now()-class monotonic source
~~~

setTimeout 只負責喚醒；elapsed truth 由 monotonic time 重算。

Timer state：

~~~text
IDLE
RUNNING
PAUSED
COMPLETE
~~~

Rules：

- background tab delay 不靠 tick count
- complete 只 emit 一次
- pause 保存 elapsed offset
- resume 建新 anchor
- reset 回 initial duration
- dispose cancel scheduled wakeups
- telemetry 不記每個 tick

# 25. Rendering Semantics

Render tree 從 root_node_id 開始。

每個 node：

~~~text
CapabilityRef
+ resolved props
+ resolved bindings
+ children
+ trusted renderer
~~~

Render：

1. 從 static `root_node_id` definition 建立 singleton root NodeInstanceKey。
2. 遇到 `repeat` 時，依 admitted item order為 structural children建立/傳遞新的 ancestor repeat coordinate；每個 repeated descendant因此得到唯一 NodeInstanceKey。
3. resolve current committed props/bindings。
4. evaluate relevant rules。
5. provide immutable render props + concrete NodeInstanceKey。
6. renderer 產生 React UI；React/DOM key 可由 NodeInstanceKey 派生，但不得反向成為 Runtime identity truth。
7. renderer 只能透過 Runtime dispatch API 發 declared event，並由 Runtime附上 canonical `source_node_instance_key`。

Renderer 不直接 mutate Instance Store；同一 static `node_id` 的不同 repeated clones不得共用 capability-local state、timer slot或 node-local error slot。

# 26. Node-level Error Isolation

## F03-RQ-011

每個 Capability render subtree 有 Error Boundary。

~~~text
Node Error
→ isolate failed subtree
→ keep rest alive
→ safe fallback / F12 notice
→ record capability/node/error
~~~

不應整頁 White Screen。

只有 Runtime Host / Store integrity failure 升 FATAL_ERROR。

# 27. Runtime Error Isolation Levels

~~~text
LEVEL 1 — Expression / Binding
isolate affected value / action

LEVEL 2 — Action
rollback current Action

LEVEL 3 — Capability Node
isolate node/subtree

LEVEL 4 — Instance Fatal
stop execution, preserve recovery context
~~~

Blast radius 最小化，但不能用 fallback 假裝 semantic success。

# 28. Result Evaluation

Runtime：

~~~text
evaluateResult()
→ outputs[]
~~~

每個 output：

~~~text
id
label
resolved typed value
sensitivity
status:
  AVAILABLE
  ERROR
~~~

Rules：

- 從 committed state 評估
- 不從 React DOM 抓值
- failure 不給 fake default
- 有結果 ≠ semantic correctness

# 29. Result Snapshot / Correction Support

F03 提供 capture source：

~~~text
RuntimeSnapshot
├─ blueprint_hash
├─ instance_id
├─ mutable_state
├─ result_outputs
├─ rng_metadata
├─ timer_metadata_if_required
└─ captured_at_local
~~~

F16 不可盲目 durable 保存整份 RuntimeSnapshot。

Persistence：

- NORMAL result → durable eligible
- SENSITIVE → default not durable，需 F16/F07 explicit policy
- DO_NOT_PERSIST → 永不 durable
- input durable subset 由 F16/F07 決定
- capability-local state 預設不 durable

# 29.1 Exact Correction Replay Interface

## F03-RQ-012 — createCorrectionReplayInstance

Canonical internal interface：

~~~text
createCorrectionReplayInstance(request)
→ CorrectionReplayResult
~~~

Request：

~~~text
CorrectionReplayRequest
├─ admitted_blueprint
├─ execution_admission
├─ replay_inputs[]
├─ requested_comparison_mode
└─ replay_context
~~~

ReplayInput：

~~~text
state_key
value
value_type
sensitivity
~~~

ReplayContext：

~~~text
source_blueprint_hash
source_runtime_version
source_registry_version
rng_metadata?
timer_metadata?
limitations[]
~~~

Result：

~~~text
CorrectionReplayResult
├─ instance_id
├─ effective_comparison_mode
├─ result_outputs
├─ runtime_snapshot
└─ limitations[]
~~~

### Replay algorithm

~~~text
R01 assert fresh ExecutionAdmission
R02 create fresh child Runtime Instance
R03 initialize Blueprint mutable initial state
R04 validate every replay_input against child MUTABLE state type/constraints
R05 write only replay-eligible state keys into pre-ready working state
R06 recompute all affected derived state / rules
R07 evaluate replay context support
R08 initialize supported RNG / timer replay context without historical side effects
R09 build capability/render state
R10 enter READY
R11 evaluate canonical result.outputs
R12 return snapshot + effective comparison mode
~~~

Failure before R10：

- Instance不進 READY。
- 不留下 partial committed replay state。
- dispose failed child Instance。
- 回 typed F03/F16 error。

### Comparison mode truth

DETERMINISTIC_REPLAY：

~~~text
allowed when result dependency graph is deterministic
and all replayed values are available
~~~

SEEDED_REPLAY：

~~~text
allowed only when all result-affecting SEEDED capabilities provide enough replay-safe context
to reproduce the comparison point without replaying irreversible/history-dependent effects
~~~

Phase 1只有 seed + counter 並不自動保證 exact historical replay。
若缺 event/action history或 capability replay state：

~~~text
effective mode = LIMITED_COMPARISON
~~~

TIME_CONTEXT_REPLAY：

~~~text
allowed only when all result-affecting timer state can be reconstructed from bounded monotonic metadata
without re-emitting historical events
~~~

Timer replay metadata minimum：

~~~text
node_id
timer_state: IDLE | RUNNING | PAUSED | COMPLETE
duration_ms
elapsed_ms
~~~

Replay建立新的 monotonic anchor：

~~~text
remaining_ms = max(duration_ms - elapsed_ms, 0)
~~~

Rules：

- 不 replay historical timer ticks/events。
- COMPLETE不重新emit completion。
- RUNNING只排未來 remaining duration。
- 若 result依賴無法重建的歷史 timing sequence → LIMITED_COMPARISON。

LIMITED_COMPARISON：

- child仍可hydrate / evaluate。
- Runtime回 limitations[]。
- F16 UI必須揭露不是 apples-to-apples exact replay。

### Replay input safety

只接受 F16依 F04 editable-input binding規則選出的 MUTABLE keys。

禁止：

- DERIVED state write
- undeclared state
- capability-local arbitrary state injection
- silent coercion
- replay external/irreversible effect
- replay permission grant
- replay arbitrary Action/Event history

### Snapshot output

captureRuntimeSnapshot與CorrectionReplayResult使用同一 Runtime value semantics。

F03不負責 durable persistence；F16/F07決定 redact / retention。

# 30. Local Recovery / Reload

Phase 1 Runtime 本身不自動保存完整 Instance 到 localStorage。

理由：

- 尚未完成 per-field sensitivity policy
- 避免意外留下 user content
- Share/Remix 核心是 immutable Blueprint

F00 可保存必要 unsent input / recovery context；F05 restore Blueprint。

Future Instance persistence 必須有 versioned snapshot + privacy contract。

# 31. Event → Render Ordering

Canonical ordering：

~~~text
Event dequeue
→ Action transaction
→ state commit
→ final derived/rule recompute
→ React store notification
→ render
→ staged effects
→ emitted events enqueue
→ next event
~~~

React batching 可優化 render 數，不得改 observable state semantics。

# 32. Concurrency Model

Phase 1：

- Browser JS single-thread runtime control plane
- one dispatcher / Instance
- one Action transaction at a time
- timers/UI callbacks only enqueue
- no async external Action step
- future Worker 可算 heavy pure compute，但 state commit 回 single-writer dispatcher
- 每個 admitted interaction有獨立 operation token；token與deadline guard不改變 FIFO single-writer ordering

因此 normal interaction 不需要 DB lock / distributed transaction。

# 33. Multiple Runtime Instances

同頁可有多個 Instance：

- isolated store / queue / RNG / timers
- immutable Blueprint 可共享 memory cache
- Instance state 不互讀
- Phase 1 不支援 cross-instance interaction
- dispose 一個不影響其他

# 34. Disposal Contract

DISPOSE：

1. stop accepting new events
2. cancel timers
3. dispose capability handlers
4. cancel pending local effects where possible
5. clear event queue
6. release renderer references
7. status = DISPOSED

Dispose 後 event → ignore + dev diagnostic。

# 35. Runtime Security Boundary

Phase 1 Capability handler 是 appf2 build-time trusted first-party code，不是 hostile-code sandbox。

安全依賴：

1. Blueprint 無 executable code
2. F04 static trusted Registry
3. build-time bundled handlers
4. explicit RuntimeContext services
5. CI / lint / code review 禁止 arbitrary network / eval / dynamic import
6. privileged Browser API 必須走 permission broker
7. no provider secret in Browser

React Error Boundary 不是 security sandbox。

# 36. Permission Broker

Phase 1 Core：

~~~text
NONE
USER_GESTURE
~~~

RuntimeContext 不預設提供：

- camera
- microphone
- location
- clipboard write
- filesystem
- network
- credentials

Future permission capability：

~~~text
Capability declaration
→ User-visible permission UX
→ Runtime Permission Broker
→ Browser API
~~~

# 37. Runtime Resource Enforcement

F02 admission 是第一層，F03 再做 defense-in-depth。BF-038 明確分離 static admission proof 與 dynamic runtime guard：F03 不得用 runtime實際值回頭合理化一個本應被 F02 V09拒絕的 Blueprint。

F03 guards：

- event queue max
- dispatch-cycle max
- timer max（不得超過 admitted F02 timer upper bound / Capability budget）
- capability instance count（不得超過 admitted static upper bound）
- capability-local state bytes
- state patch size
- repeat max
- effect rate limit
- node error boundary
- action duration instrumentation

`ResourceBudget.maxLocalStateBytes` exact runtime measurement：

1. guard unit = **每個 concrete NodeInstanceKey** 的 capability-local state，不跨 instance合併。
2. value使用 F04 admitted `capability_state` TypeDescriptor，只能有 declared fields / optional ABSENT semantics。
3. 每次 initialize後、每次準備 commit capability-local state mutation前，將該 state value依 F02 canonical JSON scalar/object ordering rules序列化，取 exact UTF-8 byte length。
4. byte length > exact Capability `maxLocalStateBytes` → 本次 transition不得 commit，進 typed Runtime resource failure / Recovery；不得 truncate / drop field / silently reset。
5. 此 dynamic guard不替代 F02 §19.1/19.2 的 static Blueprint / timer / instance / binding / props checks。

Phase 1 synchronous action CPU：

~~~text
target <= 16 ms common path
warning > 50 ms
diagnostic / recovery if > 250 ms
~~~

JS 無法可靠 preempt infinite trusted code；因此 trusted Capability code 必須 CI test / code review。Blueprint DSL 自身無 loop。

Timeout enforcement使用 monotonic deadline + §16.3 guard points；不得把 browser timer callback描述成 main-thread hard preemption。

# 38. Internal Module Contract

~~~text
createRuntimeInstance(admittedBlueprint, runtimeContext)
hydrateInstance(instance)
dispatchRuntimeEvent(instanceId, event) → RuntimeOperationHandle
subscribeRuntimeOperation(operationToken, listener)
evaluateValue(instanceId, valueSource, admittedDispatchContext?)
evaluateResult(instanceId)
captureRuntimeSnapshot(instanceId)
createCorrectionReplayInstance(request)
resetRuntimeInstance(instanceId, mode)
disposeRuntimeInstance(instanceId)
~~~

Capability side：

~~~text
initializeCapability(nodeInstanceKey, nodeContext)
invokeCapabilityAction(nodeInstanceKey, actionName, args)
disposeCapability(nodeInstanceKey)
~~~

appf2-owned interfaces，不把 React / vendor API 當核心 protocol。

`RuntimeOperationHandle`只暴露 operation token與只讀 lifecycle / checkpoint projection；consumer不能透過 handle強制 commit、reopen token或修改 Runtime store。

# 39. Backend / Network Behavior

正常 Runtime path：

~~~text
Browser
→ Browser
→ Browser
~~~

不呼叫：

- LLM
- PostgreSQL
- Edge API

只有明確 Function 才出 Browser：

- Share create/resolve
- telemetry batch
- correction/refine compile
- future external capability

Telemetry failure 不阻斷 Runtime。

# 40. Error Taxonomy Seed

| ID | Meaning | Scope | Retry |
|---|---|---|---|
| F03-ERR-001 | HYDRATION_TRUST_FAILURE | Instance | NO |
| F03-ERR-002 | RUNTIME_VERSION_INCOMPATIBLE | Instance | CONDITIONAL |
| F03-ERR-003 | REGISTRY_RUNTIME_MISMATCH | Instance | CONDITIONAL |
| F03-ERR-004 | CAPABILITY_INIT_FAILED | Node | CONDITIONAL |
| F03-ERR-005 | VALUE_SOURCE_FAILED | Binding | CONDITIONAL |
| F03-ERR-006 | RULE_EVALUATION_FAILED | Rule | CONDITIONAL |
| F03-ERR-007 | ACTION_STEP_FAILED | Action | CONDITIONAL |
| F03-ERR-008 | DIVIDE_OR_MOD_BY_ZERO | Expression | CONDITIONAL |
| F03-ERR-009 | NON_FINITE_NUMBER | Expression | NO |
| F03-ERR-010 | STATE_CONSTRAINT_VIOLATION | Action | CONDITIONAL |
| F03-ERR-011 | CAPABILITY_ACTION_FAILED | Node/Action | CONDITIONAL |
| F03-ERR-012 | LOCAL_EFFECT_FAILED | Node | CONDITIONAL |
| F03-ERR-013 | NODE_RENDER_FAILED | Node | CONDITIONAL |
| F03-ERR-014 | EVENT_QUEUE_LIMIT | Instance | CONDITIONAL |
| F03-ERR-015 | RUNTIME_LOOP_GUARD | Instance | NO |
| F03-ERR-016 | TIMER_SERVICE_FAILED | Node | CONDITIONAL |
| F03-ERR-017 | RNG_SERVICE_FAILED | Instance | NO |
| F03-ERR-018 | RUNTIME_INVARIANT_BROKEN | Instance | NO |
| F03-ERR-019 | RESULT_EVALUATION_FAILED | Result | CONDITIONAL |
| F03-ERR-020 | INSTANCE_DISPOSED | Instance | NO |
| F03-ERR-021 | RUNTIME_ACTION_TIMEOUT | Action | CONDITIONAL |

F12 負責 humanized message / next action。

# 41. Recovery Direction

Hydration incompatibility：

~~~text
do not run
→ keep Blueprint reference
→ refresh / compatible runtime / explain unavailable
~~~

Action failure：

~~~text
rollback current Action
→ keep previous committed state
→ allow retry / alternate action
~~~

Node failure：

~~~text
isolate subtree
→ keep rest usable
→ retry node / continue
~~~

Fatal invariant：

~~~text
stop Instance
→ preserve Blueprint hash + safe recovery context
→ reload / restore Blueprint
~~~

Recovery 不 mutation Blueprint。

Runtime action timeout：

~~~text
discard uncommitted transaction + staged effects
→ keep last committed state
→ close operation token
→ F12-POL-011 when integrity holds
or F03-ERR-018 → F12-POL-001 when integrity cannot be proven
~~~

# 42. Evidence Contract Seed

正式 envelope 由 F07 定義。

~~~text
F03-EVT-001 runtime_hydration_started
F03-EVT-002 runtime_ready
F03-EVT-003 runtime_hydration_failed
F03-EVT-004 action_committed
F03-EVT-005 action_rolled_back
F03-EVT-006 capability_runtime_failed
F03-EVT-007 node_isolated
F03-EVT-008 loop_guard_triggered
F03-EVT-009 result_evaluated
F03-EVT-010 runtime_fatal
F03-EVT-011 runtime_operation_started
F03-EVT-012 runtime_checkpoint_completed
F03-EVT-013 runtime_soft_timeout_observed
F03-EVT-014 runtime_action_timed_out
F03-EVT-015 stale_completion_discarded
F03-EVT-016 runtime_safe_state_restored
~~~

不要記：

- every render
- every timer tick
- every state field value
- raw user content

Minimum dimensions：

~~~text
function_id = F03
blueprint_hash
runtime_version
registry_version
instance_session_id
capability_id/version when relevant
node_id when relevant
action_id when relevant
error_code when relevant
trace_id when relevant
~~~

## F03-RQ-016 — Evidence Runtime / Operation Status Separation

BF-007 Human Review closure將原本模糊的 `runtime_stage` 拆成兩個不同維度。A0 / BF-022 又移除 properties 對 common envelope 欄位的重複 ownership，因此 F03 Evidence family 的 breaking schema 現為 `schema_version = 3.0.0`；v2 semantics 保留，但 v3 不再允許 `blueprint_hash / capability_id / error_code / trace_id` 重複出現在 properties：

~~~text
runtime_status
= RuntimeInstance.status
= UNINITIALIZED | HYDRATING | READY | RECOVERABLE_ERROR | FATAL_ERROR | DISPOSED

operation_status
= RuntimeOperation.status when an admitted operation exists
= STARTED | PROCESSING | COMMITTED | TIMED_OUT | FAILED | CANCELLED
~~~

Rules：

1. `runtime_status`描述整個 Runtime Instance；`operation_status`只描述單次 admitted operation，兩者不得混用。
2. 沒有對應 RuntimeOperation的 event可以省略 `operation_status`，不得填假值。
3. F03 v2 event不得再使用 `runtime_stage`。
4. `runtime_operation_started`的 operation_status = `STARTED`。
5. `runtime_checkpoint_completed`與`runtime_soft_timeout_observed`發生時 operation_status = `PROCESSING`。
6. `runtime_action_timed_out`的 operation_status = `TIMED_OUT`。

Integrity Evidence：

~~~text
integrity_status:
  PROVEN
  UNKNOWN
  ASSURANCE_DEGRADED
  CORRUPTED
~~~

- `PROVEN` = F03已證明 committed Runtime / Store integrity成立。
- `UNKNOWN` = 資訊不足，不能證明安全。
- `ASSURANCE_DEGRADED` = 用來證明 integrity 的必要 assurance / check未完整成立。
- `CORRUPTED` = 已有正面證據顯示 Runtime invariant / state consistency被破壞。
- **只有 PROVEN 可以進 normal timeout recovery。**
- UNKNOWN / ASSURANCE_DEGRADED / CORRUPTED全部視為「integrity無法證明」，必須產生 `F03-ERR-018 RUNTIME_INVARIANT_BROKEN`，由 F12-POL-001 fail closed；不得回正常 Runtime。
- `F03-EVT-014 runtime_action_timed_out`若走 F12-POL-011，只能記 `integrity_status = PROVEN`。
- non-PROVEN integrity可由 `F03-EVT-010 runtime_fatal` + `F03-ERR-018`記錄。

Stale completion discard：

~~~text
discard_reason:
  TOKEN_CLOSED
  TOKEN_NOT_CURRENT
  INSTANCE_EPOCH_MISMATCH
  HARD_DEADLINE_ELAPSED
~~~

`discard_reason`只回答「這份 operation為什麼已過期 / 失效而不能 commit」。Integrity failure不是 stale reason，不得塞入 `discard_reason`；它由 `integrity_status + F03-ERR-018`表達。

Machine-readable property type / enum / bound由 F07 Evidence Registry擁有；F03擁有上述 Runtime語意。

# 43. Acceptance Criteria

Technical：

- F03-AC-001 Valid admitted Blueprint 可 deterministic hydrate 到 READY。
- F03-AC-002 normal interaction 0 LLM call。
- F03-AC-003 normal local interaction 不需 server round trip。
- F03-AC-004 state mutation 後 affected derived/rules 正確 recompute。
- F03-AC-005 FIFO event 順序固定，無 parallel state writer。
- F03-AC-006 Action 全成功才 commit；step failure 無 partial state。
- F03-AC-007 emitted nested event 只 queue，不 re-enter current Action。
- F03-AC-008 Reset 回 Blueprint initial mutable state。
- F03-AC-009 Result 由 result.outputs 評估，不讀 DOM。

Determinism / Replay：

- F03-AC-010 pure expression 同 inputs → 同 typed output。
- F03-AC-011 same RNG seed + consumption order → same sequence。
- F03-AC-012 Timer 以 monotonic elapsed 為 truth。
- F03-AC-013 background-tab delay 不造成 tick-count drift。

Safety / Reliability：

- F03-AC-014 Blueprint 無法注入 runtime handler / JS。
- F03-AC-015 Node render failure 不造成整頁 White Screen。
- F03-AC-016 Action failure rollback current transaction。
- F03-AC-017 event loop / queue bounded。
- F03-AC-018 revoked / incompatible Blueprint 不進 READY。
- F03-AC-019 dispose 後 timers/subscriptions 不再改 state。
- F03-AC-020 Runtime 不可放寬 F02/F04 resource ceiling。

Product / Data：

- F03-AC-021 Instance state mutation 不改 Blueprint content_hash。
- F03-AC-022 Runtime 不逐 click 寫 PostgreSQL。
- F03-AC-023 capability-local state 與 Blueprint state 分離。
- F03-AC-024 Result sensitivity 可供 F16 persistence policy。
- F03-AC-025 Runtime failure 保留最近一次完整 committed state。

Evidence：

- F03-AC-026 action commit / rollback / fatal failure 可 trace。
- F03-AC-027 node isolation 帶 capability/node/error context。
- F03-AC-028 telemetry failure 不阻斷 Runtime。
- F03-AC-029 evidence 不要求 raw Runtime state。

Runtime Operation / Timeout：

- F03-AC-030 每個 admitted Runtime interaction建立唯一 operation token，terminal token永不重用或 reopen。
- F03-AC-031 checkpoint progress保持單調、truthful、operation-scoped；無可靠 checkpoint plan時不造假百分比。
- F03-AC-032 Hard Timeout不留下 partial state、staged effect或未提交 event；committed store保持原樣。
- F03-AC-033 closed / stale token與 late completion永遠不得 commit。
- F03-AC-034同一 recovery episode的每次 Retry都建立新 operation token。
- F03-AC-035 hard deadline跨越後，即使 synchronous handler稍後返回，pre-commit guard仍拒絕 commit。
- F03-AC-036 Runtime integrity無法證明時，必須產生 F03-ERR-018並停止 affected execution path，不得回正常 Runtime。
- F03-AC-037 F03 v2 Evidence必須分離 `runtime_status`與`operation_status`；不得再以 `runtime_stage`混合兩種語意。
- F03-AC-038 只有 `integrity_status = PROVEN`可進 normal timeout recovery；non-PROVEN必須走 F03-ERR-018 fail-closed，且 `discard_reason`只表示 stale / expired operation原因。

# 44. Test Mapping Seed

~~~text
F03-AC-001 → TEST-F03-001 hydration
F03-AC-004 → TEST-F03-004 derived recompute
F03-AC-005 → TEST-F03-005 FIFO ordering
F03-AC-006 → TEST-F03-006 action atomic rollback
F03-AC-007 → TEST-F03-007 no re-entrant dispatch
F03-AC-009 → TEST-F03-009 result surface
F03-AC-010 → TEST-F03-010 operator golden cases
F03-AC-011 → TEST-F03-011 PRNG golden vectors
F03-AC-012 → TEST-F03-012 monotonic timer
F03-AC-015 → TEST-F03-015 node isolation
F03-AC-017 → TEST-F03-017 loop guard
F03-AC-018 → TEST-F03-018 trust gate
F03-AC-019 → TEST-F03-019 disposal cleanup
F03-AC-021 → TEST-F03-021 Blueprint immutability
F03-AC-022 → TEST-F03-022 no server-per-interaction
F03-AC-030 → TEST-F03-030 unique operation token per admitted interaction
F03-AC-031 → TEST-F03-031 monotonic truthful operation-scoped checkpoints
F03-AC-032 → TEST-F03-032 timeout leaves no partial state or effect commit
F03-AC-033 → TEST-F03-033 closed or stale token cannot commit
F03-AC-034 → TEST-F03-034 retry creates a fresh token
F03-AC-035 → TEST-F03-035 pre-commit rejects post-deadline completion
F03-AC-036 → TEST-F03-036 integrity uncertainty fails closed
F03-AC-037 → TEST-F03-037 runtime / operation evidence status separation
F03-AC-038 → TEST-F03-038 integrity and stale-discard evidence semantics
~~~

完整 Executable Acceptance 待 Function contracts 完成後統一升級。

# 45. Dependencies

Upstream：

- F02 Blueprint / operator allowlist / trust
- F04 trusted runtime registry
- DATA-MODEL Blueprint vs Instance
- Infra Browser-first

Downstream：

- F00 Runtime frame / states / recovery UX
- F05 restore to fresh Instance
- F06 semantic revision vs state mutation
- F07 runtime evidence
- F12 runtime recovery
- F16 result snapshot / rerun / compare

## BF-040 Runtime Boundary Closure

BF-040 不新增一般 Runtime feature semantics；只收斂 F02/F04 fresh-admission與F03既有 trusted-handler boundary：ExecutionAdmission必須綁 pinned Registry v7 release tuple，Runtime只使用該 pinned RuntimeRegistry建立 handler index。這是 H02/H03 safety precondition，不是新的 dynamic registry service。

# 46. Release / Migration

Phase 1 Runtime：

~~~text
Browser React Runtime
+ appf2 Rule VM
+ trusted static Capability Registry
+ local Instance Store
+ FIFO Dispatcher
+ Local Effect Services
~~~

Versioning：

- Runtime version explicit
- Blueprint schema compatibility explicit
- Registry compatibility explicit
- PRNG algorithm version explicit
- old Blueprint 不因 Runtime update被原地改寫

新版不能安全執行舊 Blueprint：

~~~text
INCOMPATIBLE
→ F12 Recovery
~~~

不 silently reinterpret。

# 47. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F00 Runtime loading / recoverable / fatal UX。
- F05 Phase 1分享為 immutable Blueprint restore，不分享完整 Runtime Instance。
- F07 runtime evidence / privacy / retention。
- F12 Runtime recovery semantics。
- F16 correction replay exact interface與sensitive snapshot handling。

未來 Optional media autoplay/browser policy與 async/external Action transaction semantics需另行 versioned design。

# Conclusion

F03 Runtime Current Truth：

~~~text
Validated immutable Blueprint
→ deterministic hydration
→ local mutable Instance
→ pure Rule VM
→ FIFO single-writer events
→ atomic Action state commit
→ trusted Capability handlers
→ post-commit bounded local effects
→ isolated failures
→ explicit Result surface
~~~

> appf2 Runtime 的工作不是再次「理解」App，而是忠實、安全、可重播地執行已經被理解與驗證過的 App。


---

## Closed Working Delta — Runtime Interaction Processing / Timeout

> 狀態：WORKING_DELTA_CLOSED（2026-09-22）/ STEP2_RECONCILED
>
> STEP2 reconciliation：本 delta 已整合回 canonical Runtime / Error / Evidence / Acceptance sections；Build Freeze 直接讀整合後 Working truth。
>
> Canonical detail已整合至 §16.1–§16.4、Error / Evidence、Acceptance / Test sections。

### Closure Summary

每次 admitted Runtime interaction建立本地 operation token：

~~~text
STARTED → PROCESSING → COMMITTED | TIMED_OUT | FAILED | CANCELLED
~~~

Closure invariant：

> 只有 open + current + same instance epoch + within hard deadline + integrity-valid 的 token才有資格 commit。

Hard Timeout使用 monotonic deadline與 guard points拒絕晚到 commit；不宣稱 main-thread timer可強制中斷卡死的 trusted code。Atomic transaction確保 last committed state從未被本次未完成 operation改變；integrity成立時由 F12安全露出該 state，否則以 F03-ERR-018 fail closed。
