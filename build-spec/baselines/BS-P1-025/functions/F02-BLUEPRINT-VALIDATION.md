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
  "registry_version": "7.0.0",
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
  "nodes": [
    {
      "id": "node_root",
      "capability": {"id":"layout.container","version":"1.0.0"},
      "props": {
        "direction":{"kind":"LITERAL","value":"COLUMN"},
        "gap":{"kind":"LITERAL","value":"NONE"},
        "align":{"kind":"LITERAL","value":"STRETCH"}
      },
      "bindings": {},
      "events": {},
      "children": []
    }
  ],
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

## 4.1 BF-036 Canonical Executable Schema Closure

> **BF-036/BF-040 resolution：V02 的「required keys / allowed keys only」必須能由單一 machine schema直接判斷。以下 shape、requiredness、grammar與非-resource bounds是 Phase 1 canonical Product truth；凡 §19/BF-040 ownership matrix 指定由 V05/V09 擁有的 canonical hard maximum，V02不得以同一 max搶先拒絕。範例不承擔隱含 requiredness。**

Canonical identifier token（除已有更嚴格專用 ID grammar外）：

~~~text
CanonicalIdentifier = ^[a-z][a-z0-9_]{0,63}$
~~~

`nff_`、`sys_`、`__` 開頭 token 保留給平台，不得由 Blueprint 使用。

Top-level exact shape（**11 keys 全部 required**，不得省略 empty object / array）：

~~~text
Blueprint = {
  schema_version: "1.0.0",
  registry_version: "6.0.0",
  kind: "APP",
  meta: Meta,
  support: Support,
  state: map<StateKey, StateEntry>,
  rules: Rule[],
  actions: Action[],
  nodes: Node[],
  root_node_id: NodeId,
  result: ResultContract
}
~~~

`kind` Phase 1 唯一 allowed value = `APP`。

Nested exact shapes：

~~~text
Meta = {
  title: string(1..120 chars),
  description?: string(0..500 chars)
}

Support = {
  coverage_status: FULLY_SUPPORTED | PARTIALLY_SUPPORTED,
  degradations: Degradation[]
}

Degradation = {
  requirement_id: CanonicalIdentifier,
  description: string(1..500 chars),
  capability_refs: CapabilityRef[],
  preserves_semantic_core: true
}

CapabilityRef = {
  id: F04 capability_id,
  version: exact F04 capability SemVer
}

MutableStateEntry = {
  mode: "MUTABLE",
  type: NUMBER | STRING | BOOLEAN | ENUM | LIST | RECORD,
  initial: value,
  constraints?: type-specific constraints
}

DerivedStateEntry = {
  mode: "DERIVED",
  type: NUMBER | STRING | BOOLEAN | ENUM | LIST | RECORD,
  expr: ValueSource
}

Rule = {
  id: RuleId,
  result_type: NUMBER | STRING | BOOLEAN | ENUM | LIST | RECORD,
  expr: ValueSource
}

Node = {
  id: NodeId,
  capability: CapabilityRef,
  props: map<declared_prop_key, ValueSource>,
  bindings: map<declared_binding_key, ValueSource>,
  events: map<declared_event_name, ActionId>,
  children: NodeId[],
  repeat?: Repeat
}

Repeat = {
  items: ValueSource,
  item_alias: CanonicalIdentifier,
  index_alias?: CanonicalIdentifier,
  max_items: integer 0..500
}

Action = {
  id: ActionId,
  steps: ActionStep[]
}

SET_STATE step = {
  type: "SET_STATE",
  target: StateKey,
  value: ValueSource,
  when?: ValueSource
}

INVOKE_CAPABILITY step = {
  type: "INVOKE_CAPABILITY",
  target_node_id: NodeId,
  capability_action: declared action name,
  args: map<declared_arg_key, ValueSource>,
  when?: ValueSource
}

RESET_STATE step = {
  type: "RESET_STATE",
  target: StateKey | "ALL_MUTABLE"
}

ResultContract = {
  outputs: ResultOutput[]
}

ResultOutput = {
  id: CanonicalIdentifier,
  label: string(1..120 chars),
  value: ValueSource,
  sensitivity: NORMAL | SENSITIVE | DO_NOT_PERSIST
}
~~~

Canonical requiredness / closure rules：

1. 每個上述 object 只允許列出的 exact keys；unknown key → V02 reject。
2. `Meta.description`、`Node.repeat`、`Repeat.index_alias`、SET_STATE / INVOKE_CAPABILITY 的 `when` 是本節唯一 optional executable keys；另有 TypeDescriptor 自身已明示的 optional constraint keys。
3. `props` / `bindings` / `events` / `children` / `args` / `outputs` / `degradations` 即使為空也必須 explicit 寫成 `{}` / `[]`；不得靠 omission 表示 empty。
4. `Node.repeat`：F04 `composition.repeat=false` 時 forbidden；`repeat=true && repeat_required=true` 時 required；`repeat=true && repeat_required!=true` 時 optional。
5. `children` 永遠 required；F04 `composition.children=false` 時必須 `[]`。
6. `Support.coverage_status=FULLY_SUPPORTED` → `degradations=[]`；`PARTIALLY_SUPPORTED` → degradations 必須 non-empty，且每項 `preserves_semantic_core=true`。
7. `Degradation.capability_refs` 在 V02 只要求 **non-empty**、每個元素都是 exact `CapabilityRef` object、同一 degradation內不得 duplicate；不得使用 bare capability ID 字串。canonical max=20 由 §19/V09 單一擁有，不得在 V02先以同一 max preempt。每個 ref 的 Registry validity / eligibility 由 V11擁有。
8. `Degradation.requirement_id` 在 degradations 內 unique；`ResultOutput.id` 在 outputs 內 unique；`Node.children` 不得 duplicate；Action / Rule / Node identity沿用各自專用 grammar與 unique rule。
9. Mutable State 的 type-specific `constraints` requiredness仍由 §8.1.1 擁有；DERIVED 永遠禁止 `initial` / `constraints`。
10. `when` 若存在，static descriptor 必須 assignable 到 BOOLEAN；RESET_STATE Phase 1 不接受 `when`，需要 conditional reset 時由 IF/Action composition明確建模。
11. `Action.steps` 在 V02 只要求 non-empty；empty Action沒有 executable meaning，V02 reject。canonical max=16 由 §19/V09 單一擁有。
12. `nodes` 在 V02 只要求至少 1；canonical max=100 由 §19/V09 單一擁有。`root_node_id` 必須指向存在 Node。structural children graph 必須是 rooted tree：root不得作為任何 node child；每個 non-root Node必須恰有一個 structural parent；DAG multi-parent與 orphan都 reject。rules/actions可為 empty。
13. `support.degradations` max50、每個 `capability_refs` max20、`Result.outputs` max50、`Node.children` max100 均由 §19/V09 單一擁有；V02只驗證 container shape、requiredness、minimum與元素 grammar，不得用同一 canonical resource max搶先回 F02-ERR-002。
14. valid but unused state/rule/action declaration Phase 1 不因「dead code」本身 reject；Validator 不得自行加 unused-declaration rejection。Node 例外：所有 nodes 必須屬於 rooted structural tree。
15. 字串長度以 Unicode code points 計，不以 UTF-16 code units 計；byte ceiling另由 §19 / V01 enforce。
16. 任何「example 有 key所以視為 required」或「沒寫就當 empty」的 implementation inference 均禁止；只認本節 exact schema。
17. 所有 executable Blueprint JSON string token（包含 object key 與 value）必須屬於 §21 的 PostgreSQL-jsonb-representable Unicode scalar domain；不得讓「F02 PASSED、DB jsonb cast 才失敗」成為合法路徑。

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

BF-038 resolution：

- Current Phase 1 Registry snapshot version = `7.0.0`。
- `1.x`–`6.x` 與 `7.0.0` 的 release-identity / validator / runtime-binding / current-authority machine contract 不視為同一 executable contract；未知或不相容 snapshot必須在 V03 reject。
- Registry `5.0.0` 新增 BF-038 execution eligibility/resource usage；`6.0.0` 加入 BF-039 execution_contract_digest + dual-snapshot；`7.0.0` 再加入 BF-040 validator/runtime artifact digest、append-only release ledger與 runtime_binding_digest。這是 Registry machine contract MAJOR bump，不自動改變 Core Capability semantic versions。
- Phase 1 current execution-admission沒有 v6→v7 compatibility adapter；pinned Registry `<7.0.0` 的既有 Blueprint body保持 immutable/durable，但 fresh execution fail closed為 `F02-ERR-017`，直到明確 versioned adapter/migration存在。不得用 v7 snapshot重解舊 machine contract。
- Capability 自身的 `capability_version` 不因 Registry machine-contract rebaseline 自動改號；只有該 Capability contract 本身 breaking 時才另行 bump。

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

### 8.1.1 Canonical Phase 1 Mutable-State Machine Shape

> **BF-030 remediation：以下 machine shape 是 executable Product truth。Implementation 不得改 key、增加 alias、接受第二種 shape，或用「fail-closed implementation detail」補未定語意。**

Mutable state entry 只允許：

~~~text
mode = MUTABLE
type = NUMBER | STRING | BOOLEAN | ENUM | LIST | RECORD
initial = value matching the declared type
constraints = type-specific object only when defined below
~~~

Type-specific canonical shape：

**NUMBER**

~~~json
{
  "mode":"MUTABLE",
  "type":"NUMBER",
  "initial":400,
  "constraints":{"min":0,"max":1000000}
}
~~~

- `constraints` optional。
- allowed constraint keys only：`min?`, `max?`。
- min/max 必須 finite；兩者同時存在時 `min <= max`。
- initial 必須 finite 且落在 bounds 內。

**STRING**

~~~json
{
  "mode":"MUTABLE",
  "type":"STRING",
  "initial":"hello",
  "constraints":{"max_length":120}
}
~~~

- `constraints` required。
- 唯一 allowed key：`max_length`。
- `max_length` = integer，`0..8192`。
- length 以 Unicode code points 計算。
- initial length 不得超過 max_length。

**BOOLEAN**

~~~json
{
  "mode":"MUTABLE",
  "type":"BOOLEAN",
  "initial":false
}
~~~

- `constraints` forbidden。
- initial 只能是 JSON boolean。

**ENUM**

~~~json
{
  "mode":"MUTABLE",
  "type":"ENUM",
  "initial":"SMALL",
  "constraints":{"allowed":["SMALL","MEDIUM","LARGE"]}
}
~~~

- `constraints` required。
- 唯一 allowed key：`allowed`。
- `allowed` 必須 non-empty、unique，最多 500 items。
- item 只能是 JSON string / finite number / boolean。
- 同一 ENUM 的 allowed items 必須全部同一 primitive type；禁止 heterogeneous enum domain。
- initial 必須是 allowed 中的 exact value；禁止 string/number coercion。

**LIST**

~~~json
{
  "mode":"MUTABLE",
  "type":"LIST",
  "initial":[{"name":"A","price":10}],
  "constraints":{
    "item":{
      "type":"RECORD",
      "constraints":{
        "fields":{
          "name":{"type":"STRING","constraints":{"max_length":120}},
          "price":{"type":"NUMBER","constraints":{"min":0}}
        }
      }
    },
    "max_length":100
  }
}
~~~

- `constraints` required。
- exact keys：`item`, `max_length`。
- `item` 使用下方 TypeDescriptor。
- `max_length` = integer，`0..500`。
- initial 必須是 array，length <= max_length，每個 item 必須符合同一 item descriptor。

**RECORD**

~~~json
{
  "mode":"MUTABLE",
  "type":"RECORD",
  "initial":{"name":"A","price":10},
  "constraints":{
    "fields":{
      "name":{"type":"STRING","constraints":{"max_length":120}},
      "price":{"type":"NUMBER","constraints":{"min":0}}
    }
  }
}
~~~

- `constraints` required。
- allowed keys：`fields`，以及 machine vocabulary 的 `optional_fields?`。
- `fields` 是 declared field map；field key grammar = `^[a-z][a-z0-9_]{0,63}$`。
- `optional_fields` 若存在：array values unique、lexicographically canonical、每個 value 必須存在於 `fields`；它表示該 field 的 runtime value 可以是 ABSENT，而 **不是** null/undefined。
- Phase 1 Blueprint MUTABLE / DERIVED app state **禁止** `optional_fields`；因此 app-state RECORD initial object keys仍必須與 declared fields exactly equal。Phase 1 `optional_fields` 只供 F04 generated `capability_state` machine descriptor 使用。
- capability_state runtime value：所有 non-optional fields 必須存在；optional field 可缺失，存在時必須符合其 field descriptor；extra field 永遠 reject。
- arbitrary undeclared object key 永遠 reject。

Canonical reusable `TypeDescriptor`：

~~~text
TypeDescriptor
= { type: NUMBER,  constraints?: { min?, max? } }
| { type: STRING,  constraints:  { max_length } }
| { type: BOOLEAN }
| { type: ENUM,    constraints:  { allowed[] } }
| { type: LIST,    constraints:  { item: TypeDescriptor, max_length } }
| { type: RECORD,  constraints:  { fields: map<field, TypeDescriptor>, optional_fields?: field[] } }
~~~

TypeDescriptor 遞迴 shape 受 §19 `TypeDescriptor / composite literal nesting depth = 12`、canonical Blueprint bytes / total initial state bytes ceiling共同限制，不建立第二套 hidden type system；composite LITERAL nesting 必須跟 receiving expected descriptor同步計 depth。

### 8.1.2 Canonical Static Assignability / Descriptor Join

> **BF-034 resolution：static source descriptor 只有在其可能值集合是 target descriptor 可能值集合的安全子集合時，才可 assign。Validator 不得以 runtime coercion、sample value 或「通常不會超界」放寬。**

定義：

~~~text
Assignable(source, target) = every value admitted by source is also admitted by target
~~~

Rules：

1. Base type 必須相同；唯一例外是 F04 的 `ONE_OF` target matcher，source 只需 assignable 至其中一個 branch。
2. `BOOLEAN → BOOLEAN` always assignable。
3. `NUMBER`：missing bound = unbounded。若 target 有 `min`，source 必須也有 `min >= target.min`；若 target 有 `max`，source 必須也有 `max <= target.max`。
4. `STRING`：`source.max_length <= target.max_length`。
5. `ENUM`：source / target item primitive type 必須一致，且 source `allowed` 必須是 target `allowed` 的 exact-value subset。Capability-specific invariant 可要求 exact same domain。
6. `LIST`：`source.max_length <= target.max_length`，且 source item descriptor 必須 assignable 到 target item descriptor。
7. `RECORD`：declared field key set 必須 exactly equal；每個 source field descriptor 必須 assignable 到同名 target field descriptor。若 descriptor 含 `optional_fields`，還必須滿足 `source.optional_fields ⊆ target.optional_fields`，避免 source 可能缺少 target-required field。Phase 1 不做 width subtyping；Blueprint app-state RECORD 本身禁止 optional_fields。
8. Constraint-free / wider source 不得 assign 到較窄 target。例：unbounded NUMBER 不可 static assign 到 NUMBER{min:0}；STRING(500) 不可 assign 到 STRING(120)。
9. `LITERAL` 可在 receiving context 直接以 target descriptor 驗證 exact value；這不建立新的 inferred composite schema。
10. Runtime 仍對 mutation / capability output做 constraint-check；runtime check 不取代 admission-time static assignability。

Descriptor join `Join(A,B,...)` 用於 IF / COALESCE 等多分支結果，產生可安全涵蓋所有 branch 的最小 canonical descriptor：

- BOOLEAN → BOOLEAN。
- NUMBER → `min = minimum known lower bound`；任一 branch 無 min 則 result 無 min；max 同理取 maximum，任一 branch 無 max 則 result 無 max。
- STRING → max_length = maximum branch max_length。
- ENUM → same primitive type 的 ordered-insensitive exact union；超過 500 items → reject。
- LIST → max_length = maximum branch max_length；item = recursive Join(item...)。
- RECORD → field key set 必須 exactly equal；每個 field recursive Join；`optional_fields` = all branches optional_fields 的 ordered-insensitive union。Phase 1 app-state Join 若產生 non-empty optional_fields → reject，因 app state不允許 optional RECORD。
- base type 不同、無合法 canonical Join、或 Join 超出 Phase 1 ceiling → reject。

Derived state / Rule / OP 必須攜帶 inference 後的完整 descriptor；不得只保留 top-level type。

Derived state 不攜帶 `constraints`。Validator 必須從 `expr` 做 static type inference；declared `type` 必須與 inferred top-level type 一致。若 inferred value 是 ENUM/LIST/RECORD，完整 descriptor 跟著 inference 傳遞，供後續 binding / result / action type-check 使用。

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

### 9.1 Exact Value Source Variant Shape

Allowed keys are exact：

~~~text
LITERAL = { kind, value }
STATE   = { kind, key }
RULE    = { kind, rule_id }
EVENT   = { kind, path }
SCOPE   = { kind, name, path }
OP      = { kind, op, args }
~~~

Unknown key inside a Value Source → V02 schema reject。

`LITERAL.value`：

- null / undefined forbidden。
- scalar = finite number / string / boolean。
- array / object literal is allowed **only when the receiving context supplies an explicit expected TypeDescriptor**。
- receiving context = Capability prop/binding/action arg、SET_STATE target、operator arg signature、或其他已經有 canonical expected type 的位置。
- 沒有 expected TypeDescriptor 的 composite literal（包含 non-empty / empty array/object）一律 reject；Validator 不得從 object shape 自創新的 RECORD contract。
- LIST literal 每個 item 必須符合 expected item descriptor。
- RECORD literal keys 必須與 expected declared fields exact match；no extra / missing key。
- scalar literal 在沒有 expected enum domain 時只推得 NUMBER / STRING / BOOLEAN；只有 expected ENUM descriptor 可把 exact scalar value視為該 ENUM member。
- no executable string interpretation；string 永遠只是 data。

Static type inference owner：

- operator signature：F03 §12。
- STATE：F02 state descriptor。
- RULE：rule inferred result descriptor。
- EVENT：F04 event payload schema。
- SCOPE：F02 repeat item descriptor。
- Capability prop/binding/action target：F04 generated Validator contract。

Canonical `EVENT.path` / `SCOPE.path`：

~~~text
path = "" | segment ("." segment)*
segment = ^[a-z][a-z0-9_]{0,63}$
~~~

- path 永遠是 **相對於 root descriptor** 的 field path。
- EVENT root = F04 event `payload`；因此 canonical example 是 `"value"`，`"payload.value"` 禁止。
- SCOPE root = current repeat item descriptor。
- empty path `""` 表示 root value 本身。
- traversal 只可穿過 RECORD declared fields；Phase 1 不支援 numeric LIST index、bracket syntax、escaping alias 或 dynamic segment。
- scalar root 只允許 empty path；unknown / missing field → reject。
- path resolve 後得到的 concrete descriptor 才參與 Assignable(source,target)。

### 9.2 Canonical Lexical SCOPE Context

BF-036 固定 SCOPE typing，不允許 top-level Action 自行猜「目前是哪個 repeat」。

Node-local lexical environment：

1. 一個 repeat node 的 `item_alias` / `index_alias` 只對其 **structural children subtree** 可見；不對 repeat node 自己的 props/bindings/events/repeat.items 可見。
2. nested repeat 可繼承 ancestor aliases，但 child repeat 的 alias 不得 shadow任何 ancestor alias；`item_alias != index_alias`。
3. `item_alias` root descriptor = `repeat.items` 的 LIST item descriptor。
4. `index_alias` 若存在，root descriptor = `NUMBER{min:0}`；runtime value必須是 finite integer且等於本次 repeated item zero-based index。
5. Node props/bindings 中的 SCOPE 只能從該 Node lexical environment resolve；Rule、Derived State、top-level Result output 不存在 lexical repeat environment，因此直接使用 SCOPE → reject。

Action dispatch-site SCOPE context：

1. Action 中任一 Value Source tree（SET_STATE value/when、INVOKE_CAPABILITY args/when 以及 nested OP）含 SCOPE → 該 Action 至少必須有一個 `Node.events.* -> action_id` dispatch site。
2. 每個 dispatch site 的 lexical environment = dispatching Node 的 ancestor repeat environments，依本節 node-local規則建立。
3. 對 Action 內每個 `SCOPE{name,path}`，**每個** dispatch site都必須存在同名 alias，且 path resolve後 descriptor必須對該 receiving target通過 Assignable；任一 site missing/incompatible → entire Blueprint reject。
4. Validator 不得挑第一個 site、最寬 descriptor或把多 site union成 hidden type。
5. Action 同時含 EVENT + SCOPE 時，兩者各自對所有 dispatch sites驗證；同一 site必須同時滿足 EVENT payload與 lexical SCOPE。
6. F04 `action_refs` 不建立 EVENT 或 SCOPE dispatch context。
7. Runtime event envelope必須攜帶該 admitted dispatch site的 immutable lexical scope bindings供本次 Action evaluate；不得從 DOM/render tree反推。

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
    "bind": {"kind":"STATE","key":"budget"}
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
4. prop / binding Value Source 的 static type 必須符合 F04 machine contract；binding source-kind restriction 也必須符合
5. event 必須由 Capability 宣告；F04 generated event contract 提供 `EventPayloadDescriptorResolver`。F02 必須先以同 node 已驗證的 props/bindings deterministic resolve 成 concrete F02 TypeDescriptor，之後該 descriptor 才是 EVENT root type。
6. event payload resolver 若引用不存在/錯誤 kind 的 binding/prop、無法得到 concrete descriptor、或違反其 canonical invariant → node validation reject；不得 fallback 成 ANY / inferred object shape。
7. action ref 必須存在
8. `children` / `repeat` 是 **F02 structural composition fields，不是 binding names**
9. children / repeat 只有 F04 `composition` 明確允許的 Capability 可用；不得用 magic binding name（例如 `children` / `items`）推導
10. root_node_id 可達所有 executable node
11. structural graph必須是 rooted tree：root parent count=0；每個 non-root parent count=1；orphan或multi-parent node → reject
12. child graph 不可 cycle

F04 generated Validator artifact 是 prop/binding/event/action/composition 的唯一 Capability machine truth；F02 不維護第二份 Capability allowlist/schema。

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

Exact machine shape / requiredness 由 §4.1 `Repeat` 擁有。

Rules：

- `node.repeat` 是 Phase 1 **唯一 structural repeat syntax**。
- 只有 F04 machine contract `composition.repeat = true` 的 Capability 可用。
- `repeat.items` 必須 static type = LIST<T>；T 成為 item_alias 的 SCOPE TypeDescriptor。
- `item_alias` required；`index_alias` optional；兩者都使用 §4.1 CanonicalIdentifier、不得使用平台 reserved prefix、不得相同或 shadow ancestor alias。
- `max_items` required integer 0..500，且不超過 source LIST descriptor max_length、F02 global ceiling與 Capability ceiling的最小值。
- aliases lexical scoped，exact visibility / Action dispatch semantics由 §9.2 擁有。
- scope path 必須存在於 T；若 T 是 scalar，非空 path 一律 reject。
- repeated template 由該 node 的 structural `children` 描述；不得再以 `bindings.item_template` 建立第二種 executable template syntax。
- no arbitrary template code。
- nested repeat depth 有 global limit。

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

Action exact object / ActionStep variant shape與 requiredness由 §4.1 擁有。

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

- `target_node_id` 必須指向存在的 static Blueprint Node 定義。
- Phase 1 `INVOKE_CAPABILITY` target 必須是 **singleton runtime target**：該 target Node 在 structural tree 上不得有任何帶 `repeat` 的 ancestor。target Node 自己可宣告 `repeat`，因 repeat multiplicity只套用到其 structural children subtree；只有落在 ancestor repeat subtree 內的 Node 才是 multi-instance target。
- target 若不是 singleton runtime target → V08 / `F02-ERR-010 ACTION_EVENT_INVALID` reject；Phase 1 不提供「挑哪個 repeated clone」的隱式 selector。
- `capability_action` 必須存在於 target node exact Capability 的 F04 machine contract。
- `args` allowed keys / requiredness / TypeDescriptor 全部來自該 action schema；unknown arg reject。
- `when` static type 必須 BOOLEAN。

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

Event payload machine metadata 由 F04 generated Validator machine contract 提供；F02 必須先完成 node-local resolver，再以 resolved concrete TypeDescriptor type-check EVENT Value Source。

`Node.events` 是 Phase 1 唯一 event → Blueprint Action reference mechanism。Capability props/bindings 不得另外定義可執行 `action_ref` 捷徑，避免第二條 dispatch semantics。

### 15.1 Canonical Node Event Payload Resolution

F04 generated event payload 不允許 implementation-defined dynamic typing。每個 node/event 在進 dispatch-site typing 前，F02 依 generated `EventPayloadDescriptorResolver` 執行以下 deterministic resolution：

~~~text
STATIC(descriptor)
→ descriptor

BOUND_STATE_DESCRIPTOR(binding_key)
→ resolve node.bindings[binding_key]
→ required source kind = STATE
→ payload root = RECORD{ value: concrete bound mutable state TypeDescriptor }

BOUND_STRING_NARROWED_BY_PROP(binding_key, prop_key)
→ resolve node.bindings[binding_key] as concrete mutable STRING descriptor
→ resolve node.props[prop_key] as validated LITERAL NUMBER
→ payload root = RECORD{ value: STRING(max_length = literal prop value) }
~~~

Rules：

1. Resolver 只能引用同一 node 的已宣告 machine binding/prop key。
2. props/bindings 的 requiredness、source kind、TargetMatcher、named invariant 必須先 PASS。
3. `BOUND_STATE_DESCRIPTOR` 不允許 RULE/OP/EVENT/SCOPE/LITERAL 代替 STATE，也不允許 abstract matcher（例如 ANY_ENUM）直接充當 payload descriptor；必須取得 Blueprint 中實際 concrete state descriptor，並包成 canonical payload-root `RECORD{value: ...}`。
4. `BOUND_STRING_NARROWED_BY_PROP` 的 prop value 必須是已通過 invariant 的 literal integer；若大於 bound STRING 的 max_length → reject；resolved payload-root 固定為 `RECORD{value: STRING(max_length=n)}`。
5. resolver 完成後 event payload root 必須是完整 concrete F02 RECORD TypeDescriptor；任何 unresolved state / missing key / non-concrete descriptor → V06/V08 reject。
6. resolver metadata 不寫入 Blueprint body，也不成為 Runtime type system；它只決定 Admission 時的 event concrete descriptor。
7. 相同 Blueprint + Registry snapshot 必須 resolve 成相同 descriptor。

### 15.2 Canonical EVENT Typing Context

Blueprint Action 的 EVENT Value Source 以所有實際 `Node.events.<event> -> action_id` dispatch site 建立 static context：

1. Action 不含 EVENT Value Source → 不需要 event payload context。
2. Action 含 EVENT Value Source → 至少必須有一個 `Node.events` dispatch site；沒有 dispatch site → reject。
3. 同一 Action 被多個 event dispatch site 共用時，每一個 EVENT path 都必須在 **每個** dispatch payload descriptor 中存在，且 resolve 後 descriptor 對該 receiving target 都必須通過 canonical Assignable；任一 site 不成立 → 整個 Blueprint reject。
4. Validator 不得挑「最寬 payload」、第一個 event、或 union payload 來掩蓋不相容 site。
5. F04 `action_refs` 是 ACTION_ID data reference，不建立 event payload typing context；它不會使含 EVENT 的 Action 合法。
6. EVENT path 使用 §9.1 canonical relative path grammar；不得帶 `payload.` prefix。
7. 每個 dispatch site 使用 §15.1 已 resolve 的 concrete payload descriptor；Validator 不得回頭讀 prose Card、runtime handler 或自行推導另一份 event schema。

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

ResultContract / ResultOutput exact object shape與 requiredness由 §4.1 擁有。

Rules：

- output IDs unique，且使用 §4.1 CanonicalIdentifier；label required 1..120 Unicode code points；sensitivity required。
- output Value Source typed / valid；SCOPE forbidden because Result has no lexical repeat dispatch context。
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
10. Canonicalizer input 已先通過 §21 executable string-domain validation；canonical output 不得包含 U+0000 或 lone surrogate code unit，合法 supplementary Unicode scalar value 以標準 JSON escaping 或等價 UTF-8 scalar representation canonicalize。
11. Optional field 缺失與 explicit null 不視為同值；Phase 1 executable schema 原則上不用 null 表達 optional
12. Unknown executable keys Admission 前 reject
13. created_at / ownership / compiler / share metadata 不在 Blueprint body

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
candidate_payload_bytes
= 進入 F02 validation boundary 的 exact UTF-8 candidate payload bytes
= parse / normalization / canonicalization 之前的 bytes

candidate_digest
= SHA-256(candidate_payload_bytes)
= sha256:<64 lowercase hex>
= untrusted candidate intake identity

content_hash
= SHA-256(admitted canonical_json_bytes)
= admitted canonical Blueprint identity
~~~

Rules：

1. `candidate_digest` 必須在 JSON parse 前計算，因此 invalid JSON / duplicate-key candidate 仍有 deterministic identity。
2. 不得以 parsed object re-serialize 後的 bytes 取代 `candidate_payload_bytes`，避免 parse / serializer 行為改寫 untrusted intake identity。
3. Internal Composer / Restore / Import 呼叫 F02 時，也必須先形成 exact UTF-8 candidate payload bytes 再跨入 validation boundary；F02 不接受 implementation-defined object identity。
4. `candidate_digest` 只作 intake / validation trace，不代表 admitted Blueprint；只有完整 PASS 後的 `content_hash` 可作 durable Blueprint identity。

# 19. Global Phase 1 Resource Ceilings

這些是 Phase 1 Working safety ceiling，可經 material review 調整；Cursor 不得自行放寬。

| Resource | Ceiling |
|---|---:|
| canonical Blueprint bytes | 256 KiB = 262,144 exact UTF-8 bytes |
| nodes | 100 |
| state entries | 100 |
| rules | 100 |
| actions | 100 |
| action steps / action | 16 |
| expression AST nodes / expression | 64 |
| expression nesting depth | 12 |
| TypeDescriptor / composite literal nesting depth | 12 |
| UI child nesting depth | 12 |
| repeat nesting depth | 2 |
| initial LIST items | 500 |
| initial STRING chars / state | 8,192 |
| total initial state bytes | 128 KiB = 131,072 exact UTF-8 bytes |
| event bindings | 200 |
| concurrent timers | 10 |
| result outputs | 50 |
| support degradations | 50 |
| capability refs / degradation | 20 |
| children refs / node | 100 |

Capability Card 可以更低，不可更高。

### 19.1 BF-038 Canonical Resource Measurement

所有 §19 metric 都必須由 admitted-candidate static truth deterministic 計算；Validator 不得依 renderer output、DOM、sample runtime value、replayClass、capability ID hard-code 或「通常會用多少」推論。

1. **canonical Blueprint bytes** = §18 canonical JSON 的 exact UTF-8 byte length；上限 262,144。
2. **nodes / state entries / rules / actions** = static Blueprint declaration count；repeat 不複製 declaration count。
3. **action steps / action** = 每一 Action 的 `steps.length`，逐 Action 檢查。
4. **expression AST nodes / expression** = 一棵 ValueSource expression tree 中 ValueSource object 的總數，root 算 1；OP 的每個 arg遞迴計入。LITERAL 內部 JSON container不是 expression AST node。
5. **expression nesting depth** = ValueSource root depth 1；每跨一層 OP→arg +1；非 OP ValueSource depth=1。
6. **TypeDescriptor nesting depth** = descriptor root depth 1；LIST.item、RECORD.fields child descriptor 每跨一層 +1。**composite literal nesting depth** 使用同一 ceiling，但獨立量測 JSON ARRAY/OBJECT container：top-level container depth 1、nested container +1、scalar不增加 container depth。
7. **UI child nesting depth** = rooted structural Node path 上的 Node definition 數，root depth 1。
8. **repeat nesting depth** = rooted structural path 上宣告 `repeat` 的 Node 數；當某 repeat Node 的 repeated children subtree內再遇 repeat Node時 depth+1。Node自己的 repeat不複製自己，只複製其 structural children subtree，沿用 BF-037。
9. **initial LIST items** = 每一 MUTABLE initial value 中每個 LIST container individually 的 item count；任一 >500 reject，且仍受其 TypeDescriptor較低 `max_length`。
10. **initial STRING chars / state** = 每一 MUTABLE initial value 中每個 STRING scalar 的 Unicode code point count；任一 >8,192 reject，且仍受其 TypeDescriptor較低 `max_length`。
11. **total initial state bytes** = 建立只含 MUTABLE entries 的 canonical object `{state_key: initial_value}`（DERIVED omitted），依 §18 canonical JSON 序列化後取 exact UTF-8 bytes；上限 131,072。
12. **event bindings** = 所有 static `Node.events` map entry 的總和；repeat runtime multiplicity不改這個 static metric。
13. **result outputs / support degradations / capability refs per degradation / children refs per node** = 對應 canonical array length；後兩者逐 container individually 檢查。
14. **node runtime instance upper bound**：某 static Node 的 `instance_upper_bound` = 該 Node **strict structural ancestors** 中所有帶 `repeat` Node 的 admitted `repeat.max_items` 乘積；沒有 repeat ancestor時=1。Node自己的 repeat不乘自己。
15. **concurrent timers**：F04 Registry v7 每個 exact CapabilityRef 必須 machine-declare `resource_usage.timerSlotsPerInstance`。Blueprint `timer_count = Σ(node.instance_upper_bound × capability.resource_usage.timerSlotsPerInstance)`。不得從 `TIME_DEPENDENT`、名稱 `logic.timer` 或 handler實作反推。Phase 1 Core truth：`logic.timer@1.0.0 = 1`，其餘 current Core = 0。
16. 所有 integer count 使用 mathematical integer；乘積或總和若超出 safe implementation integer range，直接視為超 ceiling reject，不 wrap / clamp。

### 19.2 F04 ResourceBudget Enforcement Split

F04 `ResourceBudget` 每個欄位的 meaning / stage：

- `maxInstancesPerBlueprint`：V09；對 exact CapabilityRef 的所有 Node `instance_upper_bound` 加總。
- `maxSerializedPropsBytes`：V09；對使用 exact CapabilityRef 的每個 static `Node.props` object 做 §18 canonical JSON UTF-8 byte length後加總；不乘 repeat runtime instances，因這是 Blueprint serialized props budget。
- `maxEventBindings`：V09；使用 exact CapabilityRef 的 static `Node.events` entry總數。
- `maxActionBindings`：V09；所有 static `INVOKE_CAPABILITY` steps中，target node使用 exact CapabilityRef者的數量。
- `maxConcurrentTimers`：V09；對 exact CapabilityRef 的 `Σ(instance_upper_bound × resource_usage.timerSlotsPerInstance)`。
- `maxLocalStateBytes`：F03 runtime dynamic defense-in-depth；每個 concrete NodeInstanceKey 的 capability-local state canonical JSON UTF-8 bytes不得超該 Capability budget。F02 不得以假設 runtime值來偽造 static proof。
- `mediaAutoplayAllowed` / `networkAccessAllowed`：V10 permission/security policy，不是 byte/count metric。

V09 對「可 static 判定」的 global ceiling與 Capability budget全部在 Runtime 前 enforce；F03 dynamic guard不得取代 V09。

Limit exceeded → `F02-ERR-011 / V09` validation reject，不交 Runtime 試跑。

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
- payload bytes > **512 KiB (524,288 exact UTF-8 bytes)**
- non-object root
- prohibited binary / executable payload
- 任一 decoded JSON string token 含 U+0000
- 任一 `\uXXXX` surrogate escape 未形成合法 high-surrogate + low-surrogate pair；lone high surrogate、lone low surrogate、錯序或未配對 surrogate 一律 reject

Executable string domain（BF-037）：

1. V01 UTF-8 decoder維持 fatal；raw invalid UTF-8 直接 `F02-ERR-001`。
2. JSON escape 解碼後的每個 string token（object key 與 value）必須是 Unicode scalar values sequence；U+D800..U+DFFF 不得作為獨立 decoded value 留存。
3. supplementary scalar 可由合法 surrogate pair escape表示；Validator 必須合成單一 Unicode scalar value語意後再進後續 validation / canonicalization。
4. U+0000 即使以 `\u0000` 合法 JSON escape 出現也 reject，因 canonical `blueprint_content.canonical_blueprint` 使用 PostgreSQL `jsonb`，Admission 必須保證所有 PASSED content 可持久化。
5. 本節 string-domain failure 全部是 V01 / `F02-ERR-001 INVALID_JSON`；不得延後到 repository / database cast 才失敗。

先對 exact `candidate_payload_bytes` 產生 `candidate_digest = sha256:<hex>` + trace id，再 parse。

# 22. V02 — Schema Validation

檢查：

- required keys
- allowed keys only
- field type / enum / ID pattern
- non-resource shape/minimum/value bounds only；§19-owned resource maxima不得在 V02 preempt
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

F02 只讀 **Registry v7 generated Validator machine truth**；不得從 compiler catalog、runtime handler、capability ID命名或 prose 反推。

對每個 Node exact CapabilityRef deterministic 檢查：

1. ID/version 不存在 → `F02-ERR-005 / V04`，REJECTED。
2. `availability != ENABLED`（DISABLED / EXPERIMENTAL in production validation）→ `F02-ERR-005 / V04`，REJECTED。
3. `execution_status = REVOKED` → `F02-ERR-005 / V04`，REJECTED。這是該 validation snapshot的 Capability execution policy；不得誤用 Blueprint-level `F02-ERR-016`。
4. `execution_class` 不在 Phase 1 trusted local allowlist `LOCAL_REACT | LOCAL_RULE | LOCAL_EFFECT` → `F02-ERR-005 / V04`，REJECTED。
5. Blueprint schema不在 Capability `blueprintSchemaRange`，或 validation context的 trusted `runtime_version` 不在 Capability min/max runtime range → `F02-ERR-004 / V04`，INCOMPATIBLE。
6. 每個 **required dependency** 必須 deterministic resolve：收集同一 snapshot內 versionRange match 的 exact versions，SemVer descending；第一個「availability=ENABLED、execution_status=ACTIVE、execution_class受支援、Blueprint schema compatible、trusted runtime compatible、且其所有 required dependencies遞迴同樣 eligible」的 candidate滿足 requirement。沒有任何 eligible candidate → `F02-ERR-005 / V04`。Registry generation已禁止 dependency cycle；若 consumer仍遇 cycle/integrity異常，fail closed。
7. Optional dependency不影響 base admission，除非 Capability contract另有 explicit degradation rule。
8. props / bindings / events / actions / composition 仍只由 generated `validator` exact machine contract判斷。

不得 dynamic fallback、不得自動換 Capability version、不得把 disabled/revoked轉成「先讓 Runtime 試」。

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
- SCOPE only in §9.2 admitted lexical context：Node-local使用 ancestor repeat scope；top-level Action 只可使用 all-dispatch-site SCOPE context；Rule/Derived/Result 無 scope時一律 reject

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
- Action.steps 必須 non-empty且每 step schema/type合法；canonical max steps/action = 16 只由 V09 resource owner enforce

# 29. V09 — Resource Validation

V09 必須依 §19.1 / §19.2 計算 **所有由本節擁有的 static global metrics + per-Capability budgets**，並把結果填入 §33 ValidationReport。

BF-040 stage-ownership matrix：

- **V05 owns value/type-domain maxima only**：MUTABLE initial LIST container item count不得超 receiving TypeDescriptor `max_length`，且 platform上限500；MUTABLE initial STRING chars不得超 `max_length`，且 platform上限8192。這兩個是 declared value/type validity，錯誤 = `F02-ERR-006 / V05`，不得再由 V09重複擁有。
- **V09 owns all remaining §19 resource maxima**：canonical Blueprint bytes、nodes、state entries、rules、actions、steps/action、expression AST nodes/expression、expression depth、TypeDescriptor depth、composite literal depth、UI child depth、repeat depth、total initial state bytes、event bindings、timers、result outputs、degradations、refs/degradation、children/node，以及所有 §19.2 static per-Capability budgets。
- V02/V06/V07/V08可驗 shape/minimum/graph/type/expression/action correctness，但不得用與 V09相同 canonical resource maximum提早回另一個 error code。
- 任一 V09-owned global ceiling超限 → `F02-ERR-011 / V09`。
- 任一 Capability Card static budget超限 → `F02-ERR-011 / V09`，issue帶 exact `capability_ref`。
- Capability Card只能比 global更嚴格；若 Registry source宣告比 platform global更寬，Registry generation必須 fail，不由 F02偷偷 clamp。
- repeat instance upper bound與 timer_count一律用 admitted `max_items` worst-case；不得用本次 runtime list實際長度放寬 admission。
- `maxLocalStateBytes` 是 §19.2 明定的 F03 dynamic guard，不得為了讓 V09 PASS而假造 static runtime value。
- TEST-F02-010 必須逐項 direct-proof上述每一個 V05/V09 hard ceiling與所有 static Capability budgets；不得以「另一層 parser已擋掉」替代 owner-stage proof。

# 30. V10 — Permission / Security Validation

Phase 1：

- Core capability permission = NONE / USER_GESTURE
- Core networkAccessAllowed = false
- Core mediaAutoplayAllowed = false
- 任一 referenced Capability `permission_class` 超出 NONE/USER_GESTURE，或 `networkAccessAllowed=true`，或 `mediaAutoplayAllowed=true` → `F02-ERR-012 / V10`。USER_GESTURE 不自動授權 autoplay；Phase 1沒有 autoplay exception。
- no script / code / module / import / handler path
- strings never executed as code
- no provider secrets
- privileged Browser API only if Registry explicitly declares and release approves

BF-038 structural no-code rule：

1. No-code safety 由 **closed Blueprint schema + generated Capability validator allowlist + trusted bundled runtime mapping** 建立，不以任意 user string lexical scan建立。
2. `script` / `code` / `module` / `handler` / `import_url` / function-body類 executable carrier若不在 exact schema/Capability contract，一律在最早 deterministic stage fail closed。
3. 合法 declared text/value欄位中的字串即使字面包含 `eval(...)`、`import(...)`、`function` 等 token，也只是 inert data；Validator不得因關鍵字本身拒絕。
4. Blueprint永遠不能指定 Runtime registrationKey、module path、handler identity或 dynamic import target；這些只來自 trusted F04 Runtime artifact。
5. 若未來某 schema-valid path實際形成 forbidden executable content，使用 `F02-ERR-013 / V10`；目前 exact Phase 1 schema不得為測試目的新增這種 carrier。

# 31. V11 — Support / Degradation Validation

檢查：

- FULLY_SUPPORTED 與 degradation consistency
- PARTIALLY_SUPPORTED 必須有 degradation
- preserves_semantic_core = true
- 每個 `support.degradations[].capability_refs[]` exact ref必須存在於 pinned Registry v7，且在該 validation snapshot下通過與 V04相同的 availability / execution_status / execution_class / Blueprint-schema / trusted-runtime / required-dependency eligibility；失敗 → `F02-ERR-014 / V11`。Degradation ref不因是 metadata就可引用 disabled/revoked/incompatible Capability
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
  initial_state_bytes
  event_binding_count
  timer_count
  max_expression_ast_nodes
  max_expression_depth
  max_type_descriptor_depth
  max_composite_literal_depth
  max_ui_child_depth
  max_repeat_depth

trace_id
~~~

`trace_id` 是 trusted server/deployment tracing context。F02 boundary 只接受符合 F07 canonical trace grammar（32 lowercase hex、不可全 0）的 upstream trace；缺失或不合法時必須由 F02 產生新的 canonical trace_id。不得把不合法 trace 寫入 `validation_run` 後再讓 Evidence intake 靜默拒絕，因為這會破壞 F02-AC-019 的 validation↔evidence traceability。

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

Trust transition authority（Phase 1）：

- `VALIDATED → REVOKED`：只可由 server/governance-owned F02 trust transition service 執行；public/client input 無 authority。
- `VALIDATED → INCOMPATIBLE`：只可由 server/deployment-owned compatibility decision 執行；public/client input 無 authority。
- Phase 1 不允許 `REVOKED / INCOMPATIBLE → VALIDATED` 原地恢復；重新取得 VALIDATED truth 必須走新的 validation/admission truth，不得改寫舊 Blueprint body。
- transition 必須以 `content_hash + previous_status + new_status + canonical trace_id` 為受控輸入；repository 只允許 compare-and-set `VALIDATED → terminal status`，避免 stale/重複 transition 覆蓋。
- 成功 transition 不得 mutation canonical Blueprint body、content_hash、schema/registry version、created_at 或 admitting validation lineage。
- 成功 `REVOKED` transition 發 `F02-EVT-008 trust_revoked`；成功 `INCOMPATIBLE` transition 發 `F02-EVT-014 trust_incompatible`。Evidence delivery 依 F07 為 non-blocking，因此 durable `trust_status` 是執行 gate truth，event 是可觀測 evidence；transition service 必須嘗試 emission 並把 intake failure 交 F07 diagnostics，不得 rollback 已成立的安全 terminal status。

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
validateBlueprintCandidate(candidatePayloadBytes, context)
canonicalizeBlueprint(validatedLogicalBlueprint)
hashBlueprint(canonicalBytes)
admitBlueprint(validationResult)
getBlueprintTrust(contentHash)
assertExecutable(contentHash, runtimeContext)
issueExecutionAdmission(contentHash, runtimeContext)
~~~

BF-040 trusted execution context：

~~~text
RegistryReleaseIdentity = {
  registry_version: SemVer,
  registry_digest: sha256,
  validator_registry_digest: sha256,
  runtime_registry_digest: sha256
}

RegistryReleaseBundle = {
  identity: RegistryReleaseIdentity,
  validator_registry: trusted generated Registry v7 artifact,
  runtime_registry: trusted generated RuntimeRegistry v7 artifact
}

ExecutionRuntimeContext = {
  runtime_version: SemVer,
  supported_blueprint_schema_range: SemVerRange,
  registry_snapshot: RegistryReleaseBundle,          // Blueprint pinned
  current_registry_snapshot: RegistryReleaseBundle,  // deployment current
  trusted_release_ledger: server/deployment-owned immutable RegistryReleaseLedger,
  trusted_runtime_handler_catalog: server/deployment-owned actual bundled handler keys,
  now: trusted server time
}
~~~

Rules：

1. `ExecutionRuntimeContext` 只能由 appf2 server/deployment truth建立；public client不得提供、覆寫或選擇任何 release identity / artifact / ledger欄位。
2. pinned bundle必須 exact match Blueprint `registry_version` + persisted admitted `registry_digest`，並通過 F04 v7 full validator/runtime artifact digest + trusted release-ledger tuple驗證。Deterministic unsupported/missing pinned release → E06；temporary lookup/load failure → E08。
3. current bundle是 deployment指定的 current execution authority；取得/載入/驗證發生 temporary failure → E08 503，絕不 fallback到 pinned allow。
4. Fresh execution reference set = unique union of `nodes[].capability` **與** `support.degradations[].capability_refs[]`。每個 ref都必須在 current snapshot重新做 eligibility。
5. 任一 execution ref若 current與pinned都有同一 exact ref，`execution_contract_digest` **及** `runtime_binding_digest` 都必須一致；任一 drift → E07 / `F02-ERR-017`。
6. Required dependency從 current snapshot依 V04 deterministic recursive rule resolve。Candidate若同 exact ref也存在pinned snapshot，兩個 identity digest都必須相同；current新 exact version若pinned不存在，可依 versionRange + current eligibility滿足 requirement。
7. current `availability` / `execution_status` 只讀 current snapshot；過去 validation PASS不凍結 revoke/disable。
8. executable=true前必須確認 pinned RuntimeRegistry artifact identity成立；對所有 **node direct executable refs**，由 pinned RuntimeRegistry取得 registration_key，且該 key必須存在 server/deployment-owned、由實際 bundle建立的 TrustedRuntimeHandlerCatalog。Current snapshot不得換掉 pinned handler binding。
9. Content persistence `admitBlueprint` / same-hash REUSED只代表 canonical content與validation lineage成立，**永遠不等於現在可執行**；fresh Runtime仍必須取得 §37 / EXECUTION-ADMISSION 的 executable=true authorization。
10. Persisted canonical body重新 hash若不等 content_hash，或 persisted schema_version/registry_version與body不一致 → deterministic content integrity denial，`F02-ERR-015`；repository temporary failure則 E08。

F02 不呼叫 LLM。

F01 Candidate invalid：

~~~text
F02 reject
→ F01 bounded recompose / recovery
~~~

不是 F02 偷偷修 JSON。

# 37. API / Contract Boundary

F02 可為 Edge internal service/module；是否獨立 public endpoint 由 F01/API design 決定。

Validation internal request context：

~~~text
candidate_payload_bytes  // exact UTF-8 bytes；F02 boundary 前不得 parse / re-serialize
candidate_source:
  COMPOSER
  RESTORE
  IMPORT
schema_policy_version
registry_version / digest   // trusted server/deployment selected
runtime_version             // trusted server/deployment selected
trace_id  // trusted canonical trace；invalid/missing upstream value由 F02 server產生
~~~

External Candidate payload只能是 §4 exact Blueprint body。Client不得用 sibling body/query/header欄位提供 `trust_status`、`executable`、`registry_digest`、`runtime_version`、Validator Registry object或 ExecutionRuntimeContext來改變 validation/admission truth。

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

Cross-Function retry authority：

- 本表 `Retry` 只說 F02 error是否可能經上游修正後再次 validation；**不等於 F01可自動 recompose**。
- F01對每個 F02 error的 `SCHEMA_FIXABLE / CAPABILITY_FIXABLE / SEMANTIC_CONTRADICTION / SECURITY_TERMINAL / RESOURCE_TERMINAL` authoritative mapping只由 F01-RQ-008A擁有。
- 特別是 `F02-ERR-012 PERMISSION_NOT_ALLOWED` 與 `F02-ERR-013 FORBIDDEN_EXECUTABLE_CONTENT` = no retry / security terminal；Recovery Registry不得把它們降級成普通 STATE_OR_ACTION_FAILURE。
- `F02-ERR-015 HASH_INTEGRITY_FAILURE` = integrity terminal，F01不得拿去 recompose。

# 40. Security / Permission

- F02-SEC-001 Blueprint 是 data，不是 code。
- F02-SEC-002 禁止 eval / new Function / dynamic import / module URL / script body。
- F02-SEC-003 Capability 必須 exact Registry ref。
- F02-SEC-004 Unknown executable field fail closed。
- F02-SEC-005 Client 不能自我標記 VALIDATED。
- F02-SEC-006 Rejected candidate 不得被 Runtime 使用。
- F02-SEC-007 Runtime 執行前確認 trust + compatibility。
- F02-SEC-008 No external secret in Blueprint。
- F02-SEC-009 Resource bound 在 Runtime 前依 §19 deterministic static metrics enforce；dynamic local-state guard由 F03 defense-in-depth承接。
- F02-SEC-010 Result sensitivity controls durable snapshot eligibility。
- F02-SEC-011 No-code safety是structural allowlist，不是 user-text lexical blacklist。
- F02-SEC-012 Content admission / cache / same-hash reuse永遠不能替代 fresh ExecutionAdmission。
- F02-SEC-013 Validation / execution trusted context只能由 server/deployment提供；client override一律無 authority。

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
F02-EVT-014 trust_incompatible
~~~

Minimum dimensions：

~~~text
function_id = F02
validation_stage
blueprint_schema_version
registry_version
capability_id when relevant
error_code when relevant
content_hash when PASSED
trace_id
~~~

Event `schema_version` 只代表 Evidence event schema；validated / candidate Blueprint version 使用 `blueprint_schema_version`。

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
- F02-AC-022 trust revoke / incompatible transition 由 trusted server authority 執行；成功 transition 以 F02-EVT-008 / F02-EVT-014 可追蹤，且不 mutation Blueprint body / immutable admission lineage。

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

BF-036 Blueprint machine-schema completeness remediation 已完成：exact nested schema closure、RECORD optional_fields machine token、lexical/action-dispatch SCOPE typing、repeat/result/support/kind/intake bounds、Registry 4.0.0。

BF-038 已完成前次 T003 machine-contract remediation。

BF-039 已完成 Registry v6 dual-snapshot remediation。

BF-040 於 T003 candidate independent review發現 artifact integrity、historical identity、V02/V09 owner、runtime-bound grammar、durable content integrity、degradation refs、dependency drift與 pinned Runtime binding仍有同族缺口；Human已批准 exhaustive same-class remediation through pre-Cursor re-execution。

BF-040 resolution：Registry v7 release bundle + append-only ledger；V05/V09 ceiling owner matrix；degradation refs納入 pinned validation與fresh E07；dependency same-ref雙 digest defense；persisted body corruption固定 `F02-ERR-015`；pinned handler mapping在 executable=true前驗證。Replacement Build Freeze / T003 Activation前 implementation保持 BLOCKED。

目前沒有其他同類 T003 validation/admission release-integrity open decision。

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
