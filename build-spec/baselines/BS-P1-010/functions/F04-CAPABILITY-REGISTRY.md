# F04 — Capability Registry / Resolution

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Concrete Capability Registry 的 Working Current Truth。
>
> 上游：APP-ARCHITECTURE、APP-DETAILED-DESIGN-OVERVIEW、CAPABILITY-FABRIC、DATA-MODEL、INFRA-ARCHITECTURE、DESIGN-TO-DELIVERY。
>
> 本文件把 Capability Fabric 的概念模型落成 Compiler / Validator / Runtime 共用的具體 Registry Contract。完整 LegoSpec / Blueprint executable contract 由 F02 承接。

# 1. Purpose / User Outcome

F04 的結果不是讓 User 看見 Registry，而是：

> User 的 Intent 只能被組成 appf2 真正會、安全會、目前可執行的能力；Compiler 不幻想不存在的能力，Validator 與 Runtime 也不各自有不同答案。

Canonical flow：

~~~text
Resolved Intent
→ Capability Resolution
→ Coverage Result
→ Blueprint Composition
→ F02 Validation
→ F03 Runtime
~~~

共同真相：

~~~text
One Canonical Registry Source
        ↓
Compiler Metadata
Validator Contract
Runtime Registration
Compatibility Metadata
Docs / Tests
~~~

# 2. Scope / Non-Scope

Phase 1 必須提供：

- stable Capability ID 與 per-capability version
- Registry snapshot version / digest
- semantic meaning / selection hints
- typed props / state contract reference
- actions / events / bindings
- runtime registration key
- determinism / replay class
- permissions / resource budget
- serialization / shareability / remixability
- compatibility / degradation
- maturity / availability
- capability dependencies
- Coverage Resolution contract
- deterministic generated artifacts
- drift prevention
- Registry error / evidence / acceptance

Phase 1 不做：

- Registry database service
- Marketplace / third-party provider registry
- dynamic remote capability installation
- user-uploaded executable plugin
- arbitrary JavaScript capability
- runtime network discovery
- paid provider execution
- semantic vector retrieval

Future External / Paid Capability 必須延伸同一 Contract，不能另建第二套執行語意。

# 3. Registry Architecture

## F04-RQ-001 — Single Canonical Source

Phase 1 Registry：

> versioned source artifact in code repository → deterministic generated artifacts

Target implementation layout：

~~~text
src/platform/capabilities/
├─ schema/
│  └─ capability-definition.ts
├─ definitions/
│  ├─ layout.container.ts
│  ├─ content.text.ts
│  ├─ input.number.ts
│  └─ ...
├─ registry.ts
└─ generate-registry.ts
~~~

Generated outputs：

~~~text
generated/capabilities/
├─ registry-manifest.json
├─ compiler-catalog.json
├─ validator-registry.ts
├─ runtime-registry.ts
└─ compatibility-manifest.json
~~~

規則：

1. definitions + CapabilityDefinition schema 是唯一人工維護 source。
2. generated files 不得手工修改。
3. CI / build 必須可從 canonical source 重建相同 artifacts。
4. Compiler、Validator、Runtime 不得各自維護 allowlist。
5. Phase 1 Registry 不存 PostgreSQL。

# 4. Identity / Versioning

## F04-RQ-002 — Capability ID

格式：

~~~text
namespace.name
~~~

例：

~~~text
layout.container
content.text
input.number
logic.random
system.notice
~~~

規則：

- exact grammar = `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`
- namespace / name 各自以 lowercase ASCII letter 開頭，可包含 lowercase ASCII digit / underscore
- `data.table_basic` / `data.chart_basic` 是合法 canonical Capability ID
- semantic identity 不包含 vendor
- ID 一旦進正式 Spec / Released snapshot，不得改作另一種語意
- breaking semantic change 使用新 major version

## F04-RQ-003 — Capability Version

Capability 使用 SemVer：

~~~text
1.0.0
1.1.0
2.0.0
~~~

PATCH = 不改 Blueprint contract 的修正。
MINOR = backward-compatible extension。
MAJOR = breaking contract / semantic change。

Blueprint 必須引用 capability_id + capability_version，不能引用模糊 latest。

## F04-RQ-004 — Registry Version

Registry snapshot 同時具有：

~~~text
registry_version
registry_digest
~~~

規則：

1. registry_version 是人類可理解 release version。
2. registry_digest 是 canonical source / manifest deterministic digest。
3. Registry digest 在 Evidence / wire / persisted reference 中的 canonical string representation = `sha256:<64 lowercase hex>`；內部 hash helper 可持有 bare 64-hex，但跨 contract boundary 前必須正規化為帶 `sha256:` prefix 的 canonical representation。
4. 相同 registry_version 不得對應兩個不同 digest；CI 必須拒絕。
5. Blueprint durable record 保存 registry_version；validation/debug 可同時保存 digest。
6. Registry source material change 必須 version bump；純 serialization defect correction 使用 PATCH bump。

# 5. Canonical Capability Definition

Canonical source logical schema：

~~~text
CapabilityDefinition
├─ id
├─ version
├─ family
├─ displayName
├─ semantic
│  ├─ meaning
│  ├─ intentClasses[]
│  ├─ selectionHints[]
│  └─ rejectionHints[]
├─ contract
│  ├─ kind
│  ├─ propsSchema
│  ├─ stateSchema
│  ├─ inputs[]
│  ├─ outputs[]
│  ├─ actions[]
│  ├─ events[]
│  ├─ bindings
│  ├─ operators[]
│  └─ validator              // exact ValidatorContract source owned by §5.1
├─ runtime
│  ├─ execution
│  ├─ registrationKey
│  ├─ deterministic
│  ├─ replayClass
│  ├─ permissionClass
│  ├─ resourceBudget
│  └─ resourceUsage

├─ product
│  ├─ shareability
│  ├─ remixability
│  ├─ persistenceClass
│  ├─ sensitiveFields[]
│  ├─ socialPotential
│  └─ costClass
├─ compatibility
│  ├─ minRuntimeVersion
│  ├─ maxRuntimeVersion
│  ├─ blueprintSchemaRange
│  └─ dependencies[]
├─ degradation
│  ├─ allowed
│  ├─ alternatives[]
│  └─ preservesSemanticCore
└─ lifecycle
   ├─ targetHorizon
   ├─ maturity
   ├─ availability
   ├─ executionStatus
   └─ releaseRequirement
~~~

> **BF-031 remediation：Executable machine shape 不得留給 Cursor / implementation 自行決定。** Working 必須先固定 validator 可消費的 field/type/composition contract；TypeScript/Zod 只做機械翻譯，不得新增 Product semantics。

Registry machine-source rule（v2+，current v5）：

- `CapabilityDefinition.contract.validator` 是 executable Validator machine truth 的 canonical source field。
- `propsSchema` / `stateSchema` 可保留供 semantic/documentation/runtime schema reference，但 **不得**取代或覆蓋 `contract.validator`。
- ENABLED Phase 1 Core Capability 缺少 `contract.validator` → generation hard fail。
- generator 對 `contract.validator` 做 deterministic normalization / validation，再投影到 §9 generated `validator-registry.ts`；不得從 prose Card、runtime handler 或 legacy ref反向猜 contract。

## 5.1 Phase 1 Validator Machine Contract Vocabulary

F04 與 F02 共用同一 typed vocabulary；F04 不建立第二套 state/value type system。

Canonical value types：

~~~text
NUMBER
STRING(max_length)
BOOLEAN
ENUM(allowed exact domain)
LIST<T>(max_length)
RECORD<declared fields>
ONE_OF<T...>
~~~

其中 NUMBER / STRING / ENUM / LIST / RECORD 的 exact descriptor semantics 由 F02 §8.1.1 擁有。

每個 Capability 的 executable validator contract 必須使用以下 **exact logical machine shape**；欄位名稱與 nesting 是 canonical，TypeScript/Zod 只能等價翻譯，不得改名或拆成第二套語意：

~~~text
validator = {
  props: map<key, FieldContract>,
  bindings: map<key, BindingContract>,
  events: map<event_name, EventContract>,
  actions: map<action_name, ActionContract>,
  composition: {
    children: boolean,
    repeat: boolean,
    repeat_required?: boolean
  },
  capability_state: TypeDescriptor | NONE,
  invariant_ids: InvariantId[]
}

FieldContract = {
  required: boolean,
  matcher: TargetMatcher,
  source_kinds: SourceKind[],
  invariant_ids: InvariantId[]
}

BindingContract = {
  required: boolean,
  matcher: TargetMatcher,
  source_kinds: SourceKind[],
  mutable_state_required: boolean,
  reference: ACTION_ID | NODE_ID | NONE,
  invariant_ids: InvariantId[]
}

EventPayloadDescriptorResolver
= { kind: "STATIC", descriptor: TypeDescriptor }
| { kind: "BOUND_STATE_DESCRIPTOR", binding_key: string }
| { kind: "BOUND_STRING_NARROWED_BY_PROP", binding_key: string, prop_key: string }

EventContract = {
  payload: EventPayloadDescriptorResolver,
  invariant_ids: InvariantId[]
}

ActionContract = {
  args: map<arg_name, FieldContract>,
  invariant_ids: InvariantId[]
}
~~~

Canonical defaults：

- omitted optional syntax in human-readable card is normalized into explicit machine fields before generation。
- `invariant_ids` is always an array；none = `[]`。
- `mutable_state_required` is always boolean；default `false`。
- `reference` is always explicit；default `NONE`。
- `source_kinds` is always explicit in generated machine truth。Human-readable §13.1 prop shorthand defaults to `[LITERAL]` only；**action arg shorthand has no implicit source-kind default**，每個 action arg 必須在 §13.1 明示。
- event `payload` 一律使用 `EventPayloadDescriptorResolver`；`STATIC` 直接攜帶完整 payload-root concrete F02 TypeDescriptor。§13.1 human-readable `payload.value = T` / `payload = {}` 只是不改語意的 shorthand，canonical source 必須 normalize 成 `STATIC(RECORD{...})`；node-dependent payload 只能使用本節列出的 resolver kind，不得由 implementation 自創 resolver token。
- empty props / bindings / events / actions are `{}`，never omitted。
- `capability_state` must be explicit resolved TypeDescriptor or `NONE`。Human-readable RECORD field suffix `?` is canonical shorthand only for F02 `constraints.optional_fields[]`：generator 必須把所有 `field?` normalize 成 lexicographically sorted unique optional_fields；不得 invent nullable/undefined union 或第二種 state schema。
- `composition.children` and `composition.repeat` are always explicit booleans；`repeat_required` exists only when repeat=true and is otherwise omitted。
- field/action/capability `invariant_ids` may all be used；each ID must resolve to §5.2 canonical invariant semantics。

`source_kinds` 只可來自：

~~~text
LITERAL STATE RULE OP EVENT SCOPE
~~~

Reference-bearing fields另外宣告：

~~~text
reference = ACTION_ID | NODE_ID | NONE
~~~

Rules：

1. `children` / `repeat` 是 F02 structural fields；**不得**塞進 `bindings[]` 後再靠 magic name 推導 composition。
2. `Node.events` 是 event → Blueprint Action 的唯一 dispatch reference；Capability prop 不再建立 executable `action_ref` 捷徑。
3. ENABLED Capability 的 props / bindings / events / actions / composition / capability_state 必須是 resolved machine contract；只有 `capability://...` ref 而無可解析 schema = Registry generation failure。
4. Optional field 缺失與 explicit null 不等價；Phase 1 machine contract原則上不用 null。
5. Unknown prop / binding / action arg / event payload field → F02 reject。
6. Capability-specific cross-field relation可以用 canonical named invariant，但 invariant ID + semantics 必須在本 Working 固定，implementation 不得自創。
7. `capability_state` 是 Runtime-local schema，不是 Blueprint app state；其 RECORD optional field唯一 machine representation = F02 TypeDescriptor `constraints.optional_fields[]`。absence 由 F03 internal ABSENT/initialization semantics處理，不得序列化成 Blueprint null/undefined。Blueprint app-state RECORD Phase 1不得使用 optional_fields。
8. action arg `source_kinds` 若包含 SCOPE，其 admission typing context完全由 F02 §9.2 all-dispatch-site lexical scope contract擁有；F04 只宣告 source kind，不得另建 scope semantics。

### 5.2 BF-034 Canonical Target Matcher / Named Invariant Contract

F04 不擴張 F02 `TypeDescriptor`。Capability machine contract 可以使用 **target matcher** 來描述「可接受哪一類 concrete F02 descriptor」；matcher 本身不是 Runtime value type，Admission 後仍保留 concrete F02 descriptor。

Canonical target matcher：

~~~text
EXACT(TypeDescriptor)
ONE_OF<matcher...>
ANY_ENUM
ANY_RECORD
LIST_OF(matcher, max_length?)
~~~

Exact machine representation：

~~~text
TargetMatcher
= { kind: "EXACT", descriptor: TypeDescriptor }
| { kind: "ONE_OF", options: TargetMatcher[] }
| { kind: "ANY_ENUM" }
| { kind: "ANY_RECORD" }
| { kind: "LIST_OF", item: TargetMatcher, max_length?: integer }

InvariantId = one of the canonical IDs listed below
SourceKind = LITERAL | STATE | RULE | OP | EVENT | SCOPE
~~~

Event payload resolver rules：

1. `STATIC`：generated artifact 已攜帶完整 concrete F02 TypeDescriptor；F02 直接使用。
2. `BOUND_STATE_DESCRIPTOR`：`binding_key` 必須指向同一 node 已驗證、`source_kinds=[STATE]` 且可解析為 concrete mutable state descriptor 的 binding；resolver 的 **payload root** 固定產生 `RECORD{ value: <bound concrete descriptor> }`。
3. `BOUND_STRING_NARROWED_BY_PROP`：`binding_key` 必須解析為 concrete mutable STRING descriptor；`prop_key` 必須是同 node 已驗證的 LITERAL NUMBER prop，且其 canonical invariant 保證為合法 max_length。resolver 的 **payload root** 固定產生 `RECORD{ value: STRING(max_length = prop value) }`；若該值大於 bound STRING max_length，node validation reject。
4. resolver 解析發生在 F02 node props/bindings 驗證之後、EVENT dispatch-site typing 之前；任何 unresolved / wrong-kind / non-concrete descriptor → F02 reject。
5. resolver 只是 generated Validator machine metadata，不可序列化進 Blueprint、state、Rule、Result 或 Runtime value。
6. 同一 node/event 在相同 Blueprint + Registry snapshot 下必須 deterministic resolve 為同一 concrete TypeDescriptor。

Target matcher rules：

1. `EXACT(D)` 使用 F02 §8.1.2 `Assignable(source,D)`。
2. `ONE_OF`：source 至少 assignable / match 一個 branch。
3. `ANY_ENUM`：只 match concrete F02 ENUM descriptor；domain 不可省略於實際 source descriptor。
4. `ANY_RECORD`：只 match concrete F02 RECORD descriptor；declared fields 不可省略於實際 source descriptor。
5. `LIST_OF(P,n)`：source 必須是 concrete LIST descriptor、source.max_length <= n（若 n 存在），且 item descriptor match P。
6. matcher 不得被寫進 Blueprint state / Rule / Result；它只存在 generated Validator machine contract。
7. Composite LITERAL 仍受 F02 §9.1 限制：若 matcher 無法在 validation 前提供唯一 concrete expected TypeDescriptor，該位置不得接受 LITERAL。

Canonical named invariant IDs：

~~~text
NUM_INTEGER
NUM_GT_ZERO
NUM_GTE_ZERO
NUM_INT_RANGE_0_8192
NUM_INT_RANGE_0_500
INPUT_NUMBER_BOUNDS
INPUT_TEXT_BOUND
SELECT_ENUM_DOMAIN
STAT_FORMAT
TABLE_COLUMNS
TABLE_ROWS_BOUND
RANDOM_MIN_MAX
SCORE_BOUNDS
~~~

Semantics：

- `NUM_INTEGER`：value 必須是 finite integer。
- `NUM_GT_ZERO`：finite NUMBER 且 > 0。
- `NUM_GTE_ZERO`：finite NUMBER 且 >= 0。
- `NUM_INT_RANGE_0_8192`：integer 且 0 <= value <= 8192。
- `NUM_INT_RANGE_0_500`：integer 且 0 <= value <= 500。
- `INPUT_NUMBER_BOUNDS`：min/max/step finite；min<=max；step 若存在 >0；bound state NUMBER constraints authoritative，props 只能收窄有效輸入，不可放寬 state contract。
- `INPUT_TEXT_BOUND`：bound state 必須是 mutable STRING；prop.max_length <= bound state's max_length；event payload effective bound = prop.max_length。
- `SELECT_ENUM_DOMAIN`：Phase 1 `input.select` is STRING-valued only。options 每個 `value` 必須是 STRING(max 8192)、value unique；E = exact ordered-insensitive STRING option-value domain；bound state 必須是 mutable ENUM whose members are STRING values，且 `allowed` domain == E。NUMBER/BOOLEAN-valued select 不屬於 Phase 1 contract。
- `STAT_FORMAT`：NUMBER/PERCENT/CURRENCY_DISPLAY 只接受 NUMBER；TEXT 接受 NUMBER/STRING/BOOLEAN/concrete ENUM。
- `TABLE_COLUMNS`：column.key unique 且存在於 concrete row RECORD；numeric display format要求 NUMBER field。
- `TABLE_ROWS_BOUND`：rows concrete LIST max_length <= prop.max_rows。
- `RANDOM_MIN_MAX`：sample_number args.min <= args.max。Admission 必須證明 **所有** 可能的 resolved values 都滿足 relation；LITERAL 視為 singleton descriptor，dynamic NUMBER source 只有在 descriptor bounds 能證明 `max_possible(min) <= min_possible(max)` 時可 admission，任一缺失必要 bound / 無法證明 → reject。Runtime invoke 前仍以 exact resolved values 重驗，失敗則 current Action rollback。
- `SCORE_BOUNDS`：initial default 0；min<=max；initial/reset target 必須在 bounds。若 `set` 使用 dynamic source 且有 declared min/max，source NUMBER descriptor 必須是該 bounds 的安全子集合，否則 admission reject。對 `increment`，因結果依賴 current capability state，F02 只驗證 NUMBER type/source kind；F03 在 transaction pre-commit 以前以 exact current score + delta 強制檢查 result bounds，超界則 invocation failure + current Action rollback。Runtime 對 `set` / `reset` 亦重驗 exact result。

Generated validator artifact 必須攜帶 invariant ID；不得只攜帶自由文字。

# 6. Enum Contracts

Capability Family：

~~~text
LAYOUT
CONTENT
INPUT
DATA
LOGIC
GAME
MOTION
MEDIA
DEVICE
SOCIAL
SYSTEM
EXTERNAL
SPATIAL
~~~

Contract kind：

~~~text
VIEW
INPUT
LOGIC
EFFECT
SYSTEM
~~~

Phase 1 execution：

~~~text
LOCAL_REACT
LOCAL_RULE
LOCAL_EFFECT
~~~

Phase 1 禁止：

~~~text
REMOTE_PROVIDER
DYNAMIC_CODE
USER_SCRIPT
EVAL
~~~

Permission Class：

~~~text
NONE
USER_GESTURE
BROWSER_PERMISSION
ACCOUNT_REQUIRED
EXTERNAL_ENTITLEMENT
~~~

Phase 1 Core 原則上只 RELEASE NONE / USER_GESTURE。

Replay Class：

~~~text
DETERMINISTIC
SEEDED
TIME_DEPENDENT
~~~

SEEDED capability 必須使用 Runtime seed / RNG service，不得散落不可追蹤 random source。

# 7. Resource Budget / Usage Contract

每張 Capability 至少有 immutable budget：

~~~text
ResourceBudget = {
  maxInstancesPerBlueprint
  maxSerializedPropsBytes
  maxLocalStateBytes
  maxEventBindings
  maxActionBindings
  maxConcurrentTimers
  mediaAutoplayAllowed
  networkAccessAllowed
}
~~~

以及 validator可直接消費的 static resource-usage profile：

~~~text
ResourceUsageProfile = {
  timerSlotsPerInstance: integer >= 0
}
~~~

Canonical rules：

1. Budget是「上限」，Usage是「這個 Capability 每 instance 的 machine resource requirement」；兩者不得混用。
2. `timerSlotsPerInstance` 必須由 canonical Capability source explicit 宣告並投影到 Validator artifact；不得從 capability ID、`replayClass`、handler source或 prose反推。
3. Phase 1 current Core：`logic.timer@1.0.0 timerSlotsPerInstance=1`；其餘 current Core exact definitions = 0。未宣告 usage的 ENABLED Capability → Registry generation hard fail。
4. `maxInstancesPerBlueprint` / `maxSerializedPropsBytes` / `maxEventBindings` / `maxActionBindings` / `maxConcurrentTimers` 的 exact V09 measurement由 F02 §19.1/19.2擁有。
5. `maxLocalStateBytes` 是 F03 per-concrete-NodeInstanceKey dynamic guard；F03 exact measurement見 F03 §37。它不能取代 F02可 static proof的 resource checks。
6. `mediaAutoplayAllowed` / `networkAccessAllowed` 是 permission/security policy，F02 V10 / F03 enforcement共同遵守。
7. Capability Card 可以更嚴格，不能自行提高 platform global ceiling；source budget若高於 platform ceiling且該維度有 global ceiling → generation hard fail，不 clamp。

# 8. Generated Compiler Artifact

compiler-catalog.json 只包含 Compiler 需要的 semantic projection，例如：

~~~json
{
  "id": "input.number",
  "version": "1.0.0",
  "meaning": "User enters a numeric value that binds to typed runtime state.",
  "intent_classes": ["numeric_input", "calculator", "budget"],
  "selection_hints": ["use when user must edit a numeric value"],
  "rejection_hints": ["do not use for display-only values"],
  "public_parameters": ["label", "min", "max", "step", "bind"],
  "events": ["change"]
}
~~~

Compiler artifact 禁止包含：

- React component path
- implementation source
- provider secret
- unrestricted JavaScript
- internal code callback

# 9. Generated Validator Artifact

`validator-registry.ts` 必須生成同一份 canonical machine truth，top-level exact logical shape：

~~~text
ValidatorRegistry = {
  registry_version: string,
  registry_digest: "sha256:<64 lowercase hex>",
  runtime_version: string,
  capabilities: map<capability_id, map<capability_version, GeneratedCapabilityValidator>>
}

GeneratedCapabilityValidator = {
  id: capability_id,
  version: capability_version,
  validator: ValidatorContract,   // exact §5.1 shape
  permission_class: PermissionClass,
  resource_budget: ResourceBudget,
  resource_usage: ResourceUsageProfile,
  availability: DISABLED | EXPERIMENTAL | ENABLED,
  execution_status: ACTIVE | REVOKED,
  execution_class: LOCAL_REACT | LOCAL_RULE | LOCAL_EFFECT,
  compatibility: CompatibilityContract,
  degradation: DegradationContract
}
~~~

Rules：

1. `validator` 必須是 §5.1 resolved exact shape；不得只保留名稱 list、schema ref 或自由文字。
2. TargetMatcher 必須使用 §5.2 exact machine representation。
3. 所有 named invariant 必須出現在其 canonical `invariant_ids[]` location；generator 不得把 invariant semantics埋成 hand-written validator branch。
4. event `payload` 必須使用 §5.1 `EventPayloadDescriptorResolver` exact machine representation。Static event 使用 `{kind:"STATIC", descriptor: ...}`；empty payload = STATIC `RECORD{fields:{}}`，不得用 implementation-defined `{}` special case。
5. Node-dependent event payload 只允許 `BOUND_STATE_DESCRIPTOR` 或 `BOUND_STRING_NARROWED_BY_PROP`；F02 必須在 node validation 時先 resolve 為 concrete TypeDescriptor，之後才進 EVENT dispatch-site typing。
6. action `args` empty = `{}`。
7. F02 只讀此 generated `validator` contract 做 capability validation；不得維護第二份 capability schema / invariant table。
8. Generator 必須 deterministic；相同 canonical definitions輸入生成 byte-equivalent semantic artifact與相同 registry_digest。

**Ref-only artifact 不合格：**

~~~text
propsSchema: { ref: "capability://..." }
stateSchema: { ref: "capability://..." }
~~~

若 deployment artifact 只有 unresolved ref、沒有同 artifact 可直接解析的 canonical schema graph，對 ENABLED Capability 視為 `F04-ERR-007 REGISTRY_GENERATION_INVALID`。

Unknown capability ID/version → REJECT。

# 10. Generated Runtime Artifact

runtime-registry.ts 是 trusted mapping：

~~~text
CapabilityRef
→ registrationKey
→ execution class
→ trusted bundled Runtime handler
~~~

安全規則：

1. Blueprint 只攜帶 capability_id + version + declarative config。
2. Runtime 依 trusted Registry mapping 取得 handler。
3. Blueprint 不得指定 module path、JS source、function body、npm package、dynamic import URL。
4. Runtime handler 必須 build-time bundled。
5. Missing runtime handler = build / deployment failure；禁止 dynamic fallback。

# 11. Compatibility Artifact

compatibility-manifest.json 至少包含：

~~~text
registry_version
registry_digest
runtime_version
blueprint_schema range
capability id/version
availability
execution_status
execution_class
compatibility range
deprecated / replacement metadata
~~~

Compatibility outcome：

~~~text
COMPATIBLE
DEPRECATED_BUT_SUPPORTED
INCOMPATIBLE
REVOKED
~~~

`execution_status` 是 canonical current machine source：`ACTIVE | REVOKED`。REVOKED 可因 security / critical correctness 發生；它與 selection `availability` 分離。舊 Blueprint body 不修改，但 Validator / Resolver / fresh Execution Admission / Runtime 必須拒絕 current REVOKED capability並交 F12 Recovery。

# 12. Phase 1 Concrete Capability Set

## 12.1 Core — Release-blocking

| Capability ID | Version | Family | Kind | Semantic Meaning | Execution | Replay |
|---|---|---|---|---|---|---|
| layout.container | 1.0.0 | LAYOUT | VIEW | 組合子節點與基本 layout | LOCAL_REACT | DETERMINISTIC |
| content.text | 1.0.0 | CONTENT | VIEW | 呈現文字 / derived text | LOCAL_REACT | DETERMINISTIC |
| content.card | 1.0.0 | CONTENT | VIEW | 有語意群組的內容卡片 | LOCAL_REACT | DETERMINISTIC |
| content.list | 1.0.0 | CONTENT | VIEW | 呈現 bounded item list | LOCAL_REACT | DETERMINISTIC |
| action.button | 1.0.0 | INPUT | INPUT | user gesture 觸發 action | LOCAL_REACT | DETERMINISTIC |
| input.number | 1.0.0 | INPUT | INPUT | 編輯 typed number state | LOCAL_REACT | DETERMINISTIC |
| input.text | 1.0.0 | INPUT | INPUT | 編輯 bounded text state | LOCAL_REACT | DETERMINISTIC |
| input.select | 2.0.0 | INPUT | INPUT | 從 bounded STRING options 選值 | LOCAL_REACT | DETERMINISTIC |
| input.toggle | 1.0.0 | INPUT | INPUT | 編輯 boolean state | LOCAL_REACT | DETERMINISTIC |
| data.stat | 1.0.0 | DATA | VIEW | 呈現重要 value / metric | LOCAL_REACT | DETERMINISTIC |
| data.table_basic | 1.0.0 | DATA | VIEW | 呈現 bounded rows / columns | LOCAL_REACT | DETERMINISTIC |
| logic.random | 1.0.0 | LOGIC | LOGIC | seeded bounded random | LOCAL_RULE | SEEDED |
| logic.timer | 1.0.0 | LOGIC | LOGIC | bounded timer state | LOCAL_RULE | TIME_DEPENDENT |
| logic.score | 1.0.0 | GAME | LOGIC | bounded score state | LOCAL_RULE | DETERMINISTIC |
| system.notice | 1.0.0 | SYSTEM | VIEW | human-facing notice / recovery presentation | LOCAL_REACT | DETERMINISTIC |

Core target 支援：

~~~text
form / calculator / chooser / score / timer / randomizer
+ simple party utility
+ result presentation
+ recovery presentation
~~~

## 12.2 Optional — 1M POC / Evidence-gated

| Capability ID | Version | Family | Semantic Meaning |
|---|---|---|---|
| data.chart_basic | 1.0.0 | DATA | bounded chart |
| game.dice | 1.0.0 | GAME | semantic dice roll using seeded RNG |
| game.wheel | 1.0.0 | GAME | semantic bounded wheel selection |
| motion.confetti | 1.0.0 | MOTION | celebratory local effect |
| media.image | 1.0.0 | MEDIA | approved image presentation |
| media.audio_playback | 1.0.0 | MEDIA | user-controlled audio playback |
| media.video_playback | 1.0.0 | MEDIA | user-controlled video playback |

Optional capability 缺失不得阻斷 Release 1 Core Loop。

# 13. Minimum Core Card Semantics

這裡固定 Compiler / Validator / Runtime 必須共同知道的最低語意；exact LegoSpec node syntax 由 F02 定義。

layout.container：
~~~text
direction: ROW | COLUMN
gap: bounded spacing token
align: START | CENTER | END | STRETCH
F02 structural children: allowed
permission: NONE
shareability: FULL
~~~

content.text：
~~~text
text: literal or approved binding/expression reference
role: BODY | LABEL | HEADING | CAPTION
~~~

content.card：
~~~text
title?: text/binding
description?: text/binding
F02 structural children: allowed
~~~

content.list：
~~~text
F02 structural repeat.items: bounded LIST<T>
F02 structural children: declarative repeated template
repeat.max_items: platform-bounded
no bindings.items / bindings.item_template executable alias
no arbitrary template code
~~~

action.button：
~~~text
label
disabled?: boolean/binding
event: press
Blueprint Action reference = F02 Node.events.press only
permission: USER_GESTURE
~~~

input.number：
~~~text
label
bind
min?
max?
step?
required?
event: change
bound type: number
~~~

input.text：
~~~text
label
bind
max_length
placeholder?
required?
event: change
bound type: string
~~~

input.select：
~~~text
label
bind: mutable STRING-domain ENUM
options: bounded label/STRING-value list
required?
event: change
no remote option loader in Phase 1
~~~

input.toggle：
~~~text
label
bind
event: change
bound type: boolean
~~~

data.stat：
~~~text
label
value: approved binding/expression reference
format?: NUMBER | TEXT | PERCENT | CURRENCY_DISPLAY
~~~

CURRENCY_DISPLAY 只表示呈現，不授權 money movement。

data.table_basic：
~~~text
rows: bounded list binding
columns: bounded key/label/format list
max_rows: platform-bounded
no arbitrary cell renderer code
~~~

logic.random：
~~~text
actions:
- sample_number
- choose_item
replay: SEEDED
must use Runtime RNG service
~~~

logic.timer：
~~~text
state: IDLE | RUNNING | PAUSED | COMPLETE
duration_ms
remaining_ms
actions: start / pause / resume / reset
events: complete
internal tick is rate-bounded and never emitted as telemetry firehose
~~~

logic.score：
~~~text
state: bounded score
actions: increment / set / reset
event: change
~~~

system.notice：
~~~text
severity: INFO | SUCCESS | WARNING | ERROR
title?
message
action_refs?: bounded next actions
raw internal error details forbidden in consumer message
~~~


## 13.1 Exact Phase 1 Core Validator Surface

> 本節把 §13 的 semantic minimum 轉成 **Validator 必須能直接消費的 canonical machine truth**。以下未標 optional 的欄位皆 required。Props 預設只允許 `LITERAL`；Bindings 允許的 source kinds逐項列出。

### layout.container@1.0.0

~~~text
props:
  direction: ENUM[ROW,COLUMN]
  gap: ENUM[NONE,XS,SM,MD,LG,XL]
  align: ENUM[START,CENTER,END,STRETCH]

bindings: {}
events: {}
actions: {}
composition:
  children = true
  repeat = false
capability_state = NONE
~~~

### content.text@1.0.0

~~~text
props:
  role: ENUM[BODY,LABEL,HEADING,CAPTION]

bindings:
  text: STRING(8192)
        source_kinds = LITERAL | STATE | RULE | OP | SCOPE

events: {}
actions: {}
composition: children=false, repeat=false
capability_state = NONE
~~~

### content.card@1.0.0

~~~text
props: {}

bindings:
  title?: STRING(120)
  description?: STRING(500)
  source_kinds = LITERAL | STATE | RULE | OP | SCOPE

composition:
  children = true
  repeat = false

events: {}
actions: {}
capability_state = NONE
~~~

### content.list@1.0.0

~~~text
props: {}
bindings: {}
events: {}
actions: {}
composition:
  children = true
  repeat = true
  repeat_required = true
capability_state = NONE
~~~

Canonical list data source **只走 F02 node.repeat.items**；template **只走 structural children**。
`bindings.items` / `bindings.item_template` 不再是 executable syntax，避免與 F02 repeat 建立第二套 template semantics。

### action.button@1.0.0

~~~text
props:
  label: STRING(120)

bindings:
  disabled?: BOOLEAN
             source_kinds = LITERAL | STATE | RULE | OP | SCOPE

events:
  press: payload = {}

actions: {}
composition: children=false, repeat=false
capability_state = NONE
~~~

Blueprint Action reference只存在 `Node.events.press -> action_id`；不另設 capability `action_ref` prop/binding。

### input.number@1.0.0

~~~text
props:
  label: STRING(120)
  min?: NUMBER
  max?: NUMBER
  step?: NUMBER
    invariant_ids = [NUM_GT_ZERO]
  required?: BOOLEAN

bindings:
  bind: NUMBER
        source_kinds = STATE
        mutable_state_required = true

events:
  change:
    payload.value = NUMBER

actions: {}
composition: children=false, repeat=false
capability_state = NONE

invariant_ids = [INPUT_NUMBER_BOUNDS]
~~~

### input.text@1.0.0

~~~text
props:
  label: STRING(120)
  max_length: NUMBER
    invariant_ids = [NUM_INT_RANGE_0_8192]
  placeholder?: STRING(500)
  required?: BOOLEAN

bindings:
  bind: STRING
        source_kinds = STATE
        mutable_state_required = true

events:
  change:
    payload:
      kind = BOUND_STRING_NARROWED_BY_PROP
      binding_key = bind
      prop_key = max_length
    resolved shape = RECORD{ value: STRING(max_length = validated literal prop.max_length) }

actions: {}
composition: children=false, repeat=false
capability_state = NONE

invariant_ids = [INPUT_TEXT_BOUND]
~~~

### input.select@2.0.0

~~~text
props:
  label: STRING(120)
  options:
    LIST<RECORD{
      label: STRING(120),
      value: STRING(8192)
    }>(500)
    source_kinds = LITERAL
  required?: BOOLEAN

bindings:
  bind: ANY_ENUM
        source_kinds = STATE
        mutable_state_required = true

events:
  change:
    payload:
      kind = BOUND_STATE_DESCRIPTOR
      binding_key = bind
    resolved shape = RECORD{ value: bound state's concrete STRING-domain ENUM descriptor }

actions: {}
composition: children=false, repeat=false
capability_state = NONE

invariant_ids = [SELECT_ENUM_DOMAIN]
~~~

### input.toggle@1.0.0

~~~text
bindings:
  bind: BOOLEAN
        source_kinds = STATE
        mutable_state_required = true

events:
  change:
    payload.value = BOOLEAN

props: {}
actions: {}
composition: children=false, repeat=false
capability_state = NONE
~~~

### data.stat@1.0.0

~~~text
props:
  label: STRING(120)
  format?: ENUM[NUMBER,TEXT,PERCENT,CURRENCY_DISPLAY]

bindings:
  value: ONE_OF<EXACT(NUMBER),EXACT(STRING(8192)),EXACT(BOOLEAN),ANY_ENUM>
         source_kinds = LITERAL | STATE | RULE | OP | SCOPE

invariant_ids = [STAT_FORMAT]

cross-field invariant STAT_FORMAT:
  NUMBER | PERCENT | CURRENCY_DISPLAY require value type NUMBER
  TEXT accepts NUMBER | STRING | BOOLEAN | ENUM

events: {}
actions: {}
composition: children=false, repeat=false
capability_state = NONE
~~~

### data.table_basic@1.0.0

~~~text
props:
  columns:
    LIST<RECORD{
      key: STRING(64),
      label: STRING(120),
      format: ENUM[TEXT,NUMBER,PERCENT,CURRENCY_DISPLAY]
    }>(500)
    source_kinds = LITERAL
  max_rows: NUMBER
    invariant_ids = [NUM_INT_RANGE_0_500]

bindings:
  rows: LIST_OF(ANY_RECORD, 500)
        source_kinds = STATE | RULE | OP | SCOPE

events: {}
actions: {}
composition: children=false, repeat=false
capability_state = NONE

invariant_ids = [TABLE_COLUMNS, TABLE_ROWS_BOUND]
~~~

Phase 1 `rows` **不接受 LITERAL**。原因：row RECORD 必須有 concrete declared-field TypeDescriptor；F02 禁止 Validator 從 object literal shape 自創 schema。需要 literal table data 時，Compiler 必須先建立 typed state / derived value，再由 rows binding引用。

### logic.random@1.0.0

~~~text
props: {}
bindings: {}
events: {}

actions:
  sample_number:
    args.min = NUMBER
      source_kinds = LITERAL | STATE | RULE | OP | EVENT | SCOPE
    args.max = NUMBER
      source_kinds = LITERAL | STATE | RULE | OP | EVENT | SCOPE
    invariant_ids = [RANDOM_MIN_MAX]

  choose_item:
    args.items = LIST<STRING(8192)>(500)
      source_kinds = LITERAL | STATE | RULE | OP | EVENT | SCOPE

composition: children=false, repeat=false

capability_state:
  RECORD{
    last_number?: NUMBER,
    last_index?: NUMBER,
    last_item?: STRING(8192)
  }
~~~

Random result is capability-local presentation/state in Phase 1；`sample_number` 更新 last_number，`choose_item` 更新 last_index + last_item。Blueprint不藉此發明同步 function-return semantics。若 future Blueprint需要把 random outcome寫入 app state，必須另開 Human-approved Capability contract，而不是 Cursor 自行加 event/output。

### logic.timer@1.0.0

~~~text
resource_usage:
  timerSlotsPerInstance: 1

props:
  duration_ms: NUMBER
    invariant_ids = [NUM_INTEGER, NUM_GTE_ZERO]

bindings: {}

actions:
  start: {}
  pause: {}
  resume: {}
  reset: {}

events:
  complete: payload = {}

capability_state:
  RECORD{
    status: ENUM[IDLE,RUNNING,PAUSED,COMPLETE],
    duration_ms: NUMBER,
    remaining_ms: NUMBER
  }

composition: children=false, repeat=false
~~~

### logic.score@1.0.0

~~~text
props:
  initial?: NUMBER
  min?: NUMBER
  max?: NUMBER

bindings: {}

actions:
  increment:
    args.delta = NUMBER
      source_kinds = LITERAL | STATE | RULE | OP | EVENT | SCOPE
  set:
    args.value = NUMBER
      source_kinds = LITERAL | STATE | RULE | OP | EVENT | SCOPE
  reset: {}

events:
  change:
    payload.value = NUMBER

capability_state:
  RECORD{ value: NUMBER }

cross-field invariant SCORE_BOUNDS:
  initial defaults to 0
  min <= max when both present
  initial / set / increment result must stay within declared bounds when present

composition: children=false, repeat=false
~~~

### system.notice@1.0.0

~~~text
props:
  severity: ENUM[INFO,SUCCESS,WARNING,ERROR]

bindings:
  title?: STRING(120)
  message: STRING(1000)
  source_kinds = LITERAL | STATE | RULE | OP | SCOPE

  action_refs?:
    LIST<STRING(64)>(16)
    source_kinds = LITERAL
    reference = ACTION_ID

events: {}
actions: {}
composition: children=false, repeat=false
capability_state = NONE
~~~

### Canonical structural rules

1. `children` 不得出現在 generated `bindings`。
2. `items` / `item_template` 不得作為 content.list executable bindings；F02 `repeat` 是唯一 repeat data/template contract。
3. input controls 一律使用 binding key `bind`；F02 範例與 fixtures不得使用 `value` alias。
4. event payload / action args 都必須投影到 generated Validator artifact；只有名稱 list 不足以 ENABLE。
5. `action_refs` 是 data reference list，不是 executable handler；F02 必須驗證 referenced Blueprint Action IDs存在。

# 14. Capability Dependency Rules

Dependency：

~~~text
id
versionRange
required
~~~

Rules：

1. Dependency graph Phase 1 必須 acyclic。
2. Required dependency unavailable → dependent capability unavailable。
3. Optional degradation 必須 Card 明確宣告。
4. Blueprint 不自行描述 npm / package implementation dependencies。
5. Transitive dependency 由 Registry / Validator resolution。

# 15. Maturity vs Availability

Maturity：

~~~text
PROPOSED
POC
BUILT
TESTED
VALIDATED
RELEASED
~~~

Availability：

~~~text
DISABLED
EXPERIMENTAL
ENABLED
~~~

Execution Status：

~~~text
ACTIVE
REVOKED
~~~

Production Registry：

- PROPOSED / POC 不得 ENABLED
- 至少 TESTED 才可 production ENABLED
- `availability` 回答「此 snapshot是否可被正常選用」；`executionStatus` 回答「current security/correctness是否仍允許執行」。
- security / critical-correctness incident 可把 executionStatus改為 REVOKED；不得靠 availability=ENABLED 繞過。
- DISABLED / EXPERIMENTAL production-unavailable；REVOKED 在所有 context都不可執行。
- maturity 是證據；availability不是 revocation substitute。

# 16. Capability Resolution Contract

## F04-RQ-005 — Coverage Result

每次 Blueprint composition 前必須形成：

~~~text
registryVersion
registryDigest
status:
  FULLY_SUPPORTED |
  PARTIALLY_SUPPORTED |
  EXTERNAL_OR_HEAVY_REQUIRED |
  UNSUPPORTED

selected CapabilityRefs[]

requirements[]:
  requirementId
  status:
    COVERED |
    DEGRADED |
    UNSUPPORTED |
    EXTERNAL_REQUIRED
  capabilityRefs[]
  degradation?
  reason

gaps[]:
  requirementId
  description
  evidenceCode
~~~

Rules：

1. Resolver 只能選 Registry snapshot 已存在的 capability/version。
2. DISABLED 視為 unavailable。
3. EXPERIMENTAL 只允許 explicit dev/experiment context，不能偷偷進 production。
4. PARTIAL 必須逐 requirement 說明 degradation。
5. degradation 不保留 semantic core → UNSUPPORTED。
6. External / Heavy Phase 1 不得 fake local capability。
7. Coverage Result 進 F01 Blueprint Composer context。
8. LLM 可建議 capability，但不能創造 Registry 沒有的 ID。

# 17. Resolution Precedence

~~~text
1. Exact semantic match + ENABLED + compatible
2. Composition of ENABLED capabilities preserving semantic core
3. Explicit degradation preserving semantic core
4. EXTERNAL_OR_HEAVY_REQUIRED
5. UNSUPPORTED
~~~

禁止：

~~~text
Unknown capability
→ closest-looking component
→ pretend success
~~~

若多個 capability 都合法，F01 依 Resolved Intent 做 semantic composition；F04 只保證候選合法、可用、可追蹤。

# 18. Build / Generation Contract

~~~text
Capability Definitions
→ validate definition schema
→ validate IDs / versions / dependencies
→ detect duplicate ID+version
→ detect dependency cycles
→ validate registrationKey uniqueness
→ validate compatibility ranges
→ generate artifacts
→ compute registry_digest
→ verify registry_version ↔ digest
→ run registry contract tests
~~~

Build hard fail：

- duplicate capability ref
- invalid version
- duplicate registrationKey
- missing required schema
- unresolved props/state schema ref for an ENABLED capability
- missing binding type/source restriction
- declared event missing payload schema
- declared action missing args schema
- missing explicit composition metadata
- dependency cycle
- ENABLED capability missing runtime handler
- ENABLED capability missing validator schema
- same registry_version with changed digest

# 19. Frontend Behavior

F04 沒有獨立 consumer UI。

它透過：

- F00：unsupported / degraded UX
- F01：Capability Coverage
- F12：disabled / incompatible / revoked Recovery
- F16：correction 後重新 resolution

User 不看 registry_digest、registrationKey、dependency graph。

User 可以看：

~~~text
這部分目前可以做到
這部分只能用 X 方式簡化
這個能力目前不支援
~~~

# 20. Backend / Runtime Behavior

Compiler → 只讀 compiler-catalog。
Validator → 只讀 validator-registry。
Runtime → 只讀 runtime-registry trusted handler mapping。
Resolver → 讀同一 Registry snapshot 做 availability / compatibility / coverage。

四者必須帶同一 registry_version / registry_digest。

Deployment mismatch → fail fast / health check fail，不在 production 默默使用不同 snapshot。

# 21. API / Contract

Phase 1 不建立 public Capability Registry API。

Internal module boundary：

~~~text
getRegistrySnapshot()
getCapability(ref)
resolveCapabilityCoverage(requirements)
assertRegistryCompatibility(version, digest?)
~~~

F14 Dynamic Certified Provider Registry 出現後才新增 network API。

# 22. State / Data

Phase 1 Registry：

- 不存 PostgreSQL
- source 在 code repository
- generated artifacts 在 build/deployment
- Blueprint 保存 registry_version
- validation/compiler/evidence 可保存 registry_version/digest
- capability usage evidence 進 product_event.capability_id

符合 DATA-MODEL：Registry 不是 Phase 1 durable DB entity。

# 23. Error / Recovery

| ID | Internal Meaning | Retry | Direction |
|---|---|---:|---|
| F04-ERR-001 | UNKNOWN_CAPABILITY | NO | reject / recompile |
| F04-ERR-002 | UNKNOWN_CAPABILITY_VERSION | NO | compatible version / recompile |
| F04-ERR-003 | CAPABILITY_DISABLED | NO | alternative / unsupported |
| F04-ERR-004 | CAPABILITY_DEPENDENCY_UNAVAILABLE | NO | alternative / registry fix |
| F04-ERR-005 | REGISTRY_SNAPSHOT_MISMATCH | CONDITIONAL | deployment / refresh / fail-safe |
| F04-ERR-006 | RUNTIME_HANDLER_MISSING | NO | deployment failure |
| F04-ERR-007 | REGISTRY_GENERATION_INVALID | NO | build failure |
| F04-ERR-008 | SEMANTIC_CORE_NOT_PRESERVED | NO | unsupported / refine |

F12 負責 consumer-facing message；F04 只提供 classification + safe recovery direction。

# 24. Security / Permission

- F04-SEC-001 Blueprint 不能選 executable code，只能引用 trusted CapabilityRef。
- F04-SEC-002 Registry generation 拒絕 handler collision / invalid contract。
- F04-SEC-003 Capability 不得暴露 eval、new Function、arbitrary script、dynamic import URL、shell command、unrestricted network call。
- F04-SEC-004 Browser permission 必須 Card 明確宣告。
- F04-SEC-005 Provider secrets 不進 compiler artifact / Blueprint / Browser config。
- F04-SEC-006 Disabled / revoked capability 不得因舊 Blueprint 引用而繼續執行。

# 25. Telemetry / Evidence

正式 event envelope 由 F07 定義。

~~~text
F04-EVT-001 capability_selected
F04-EVT-002 capability_rejected
F04-EVT-003 coverage_full
F04-EVT-004 coverage_partial
F04-EVT-005 coverage_unsupported
F04-EVT-006 capability_gap
F04-EVT-007 registry_mismatch
F04-EVT-008 capability_runtime_failure
~~~

Minimum dimensions：

~~~text
function_id = F04
capability_id
capability_version
registry_version
coverage_status
intent_id / blueprint_hash when applicable
error_code when applicable
~~~

raw Intent 不進 event properties。

# 26. Acceptance Criteria

Technical：

- F04-AC-001 Canonical source 可 deterministic 產生 Compiler / Validator / Runtime / Compatibility artifacts。
- F04-AC-002 同一 registry_version 若 source digest 改變，build 必須 fail。
- F04-AC-003 duplicate capability ID+version 必須 fail build。
- F04-AC-004 unknown capability / version 必須被 Validator 拒絕。
- F04-AC-005 ENABLED capability 必須存在 trusted runtime handler。
- F04-AC-006 Compiler / Validator / Runtime deployment 使用同 registry version/digest。
- F04-AC-007 dependency cycle 必須 fail build。

Safety / Reliability：

- F04-AC-008 Blueprint 無法指定 JS / module path / dynamic handler。
- F04-AC-009 disabled / revoked capability 不得執行。
- F04-AC-010 Card 不可突破 platform global resource ceiling。
- F04-AC-011 required dependency 不可用時 dependent capability 不可假裝 available。

Semantic / Product：

- F04-AC-012 Coverage Result 對每個 material requirement 都有 COVERED / DEGRADED / UNSUPPORTED / EXTERNAL_REQUIRED。
- F04-AC-013 PARTIAL degradation 必須標記是否保留 semantic core。
- F04-AC-014 不保留 semantic core 時不得回 FULL / PARTIAL success。
- F04-AC-015 LLM 建議 unknown capability 不得進 Blueprint。
- F04-AC-016 Optional capability 缺失不能阻斷 Release 1 Core Loop。

Evidence：

- F04-AC-017 selected / rejected / gap / mismatch 可形成 traceable evidence。
- F04-AC-018 evidence 可辨識 capability version + registry version。
- F04-AC-019 Registry evidence 不要求 raw user intent。

# 27. Test Mapping Seed

完整 Executable Acceptance 仍由後續 Test 規格完成；先建立 mapping seed：

~~~text
F04-AC-002 → TEST-F04-002 registry version/digest immutability
F04-AC-003 → TEST-F04-003 duplicate ref rejected
F04-AC-004 → TEST-F04-004 unknown ref rejection
F04-AC-005 → TEST-F04-005 enabled handler completeness
F04-AC-007 → TEST-F04-007 dependency cycle detection
F04-AC-008 → TEST-F04-008 no executable code reference
F04-AC-009 → TEST-F04-009 disabled/revoked denial
F04-AC-012 → TEST-F04-012 coverage completeness
F04-AC-014 → TEST-F04-014 no fake semantic success
~~~

# 28. Dependencies

Upstream：

- Capability Fabric
- Data Model registry-not-in-DB boundary
- Infra static registry decision
- Design-to-Delivery traceability

Downstream：

- F02 Executable Blueprint / Validation
- F03 Runtime
- F01 Compiler / Capability Resolution
- F00 degradation UX
- F07 Evidence
- F12 Recovery
- F16 re-resolution

# 29. Release / Migration

Phase 1：

~~~text
Static Trusted Registry only
Current registry_version = 5.0.0
~~~

Deployment bind：

~~~text
app build
+ runtime version
+ registry_version
+ registry_digest
~~~

Registry update：

- compatible capability addition → MINOR
- metadata-only non-contract fix → PATCH
- breaking contract → MAJOR
- BF-034 validator-machine remediation = breaking contract；Registry `1.x → 2.0.0`
- BF-035 event-payload resolver machine shape + `input.select` STRING-only contract = breaking contract；Registry `2.0.0 → 3.0.0`，且 `input.select 1.0.0 → 2.0.0`
- BF-036 RECORD `optional_fields` TypeDescriptor machine token + Blueprint/SCOPE schema closure = breaking validator contract；Registry `3.0.0 → 4.0.0`。Core capability semantic versions不因純 Registry machine representation rebaseline自動改號。
- BF-038 execution eligibility + resource-usage Validator projection = breaking machine contract；Registry `4.0.0 → 5.0.0`。Current Core Capability semantic versions維持不變；`logic.timer@1.0.0` explicit usage=1，其餘 current Core explicit usage=0。
- old validated Blueprint 保留原 capability refs / registry_version
- compatibility layer 判斷是否仍可執行

# 30. Open Decisions

BF-030 / BF-031 / BF-034 / BF-035 / BF-036 已完成前次 remediation。

BF-038 已於 2026-10-04 Human blanket-approved through pre-Cursor re-execution：Registry v5 必須 machine-project availability、executionStatus、execution class與ResourceUsageProfile，讓 F02 V04/V09及 fresh Execution Admission不靠 implementation guess。T003 在 replacement Build Freeze、rebind 與 Activation 前保持 BLOCKED。

目前沒有其他同類 T003 F04/F02 execution-eligibility/resource machine completeness open decision。

已閉合：

- F02 exact Blueprint schema / resource ceilings。
- F03 Trusted Runtime / Rule VM / seed semantics。
- F07 capability evidence / retention。
- F12 F04 error recovery mapping與machine-readable Recovery Registry。

Optional capability是否升 CORE仍由 future evidence / release review決定，不影響 Phase 1 contract。

# Conclusion

F04 Concrete Registry Current Truth：

~~~text
One versioned canonical source
→ deterministic generated artifacts
→ same truth for Compiler / Validator / Runtime
→ exact capability ID + version only
→ no dynamic code
→ explicit compatibility / coverage / degradation
→ static trusted registry in Phase 1
~~~

Phase 1 不建立 Registry Service。

> Compiler 知道什麼時候該選、Validator 知道是否合法、Runtime 知道怎麼安全執行，而且三者永遠引用同一份能力真相。
