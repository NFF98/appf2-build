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

- lowercase ASCII
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
3. 相同 registry_version 不得對應兩個不同 digest；CI 必須拒絕。
4. Blueprint durable record 保存 registry_version；validation/debug 可同時保存 digest。
5. Registry source material change 必須 version bump。

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
│  └─ operators[]
├─ runtime
│  ├─ execution
│  ├─ registrationKey
│  ├─ deterministic
│  ├─ replayClass
│  ├─ permissionClass
│  └─ resourceBudget
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
   └─ releaseRequirement
~~~

正式 TypeScript/Zod shape 在 Spec / Cursor Implementation 建立，但不得改變以上語意。

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

# 7. Resource Budget Contract

每張 Capability 至少有：

~~~text
maxInstancesPerBlueprint
maxSerializedPropsBytes
maxLocalStateBytes
maxEventBindings
maxActionBindings
maxConcurrentTimers
mediaAutoplayAllowed
networkAccessAllowed
~~~

F02 / F03 定義 platform global hard ceiling。

> Capability Card 可以更嚴格，不能自行提高 global ceiling。

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

validator-registry.ts 提供：

~~~text
capability existence
exact version existence
props schema
state / port types
allowed actions
allowed events
binding restrictions
permission class
resource budget
compatibility metadata
degradation metadata
~~~

F02 必須讀這份 generated artifact，不能維護第二份 schema。

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

REVOKED 可因 security / critical correctness 發生。舊 Blueprint body 不修改，但 Resolver / Runtime 可拒絕執行並交 F12 Recovery。

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
| input.select | 1.0.0 | INPUT | INPUT | 從 bounded options 選值 | LOCAL_REACT | DETERMINISTIC |
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
children: node refs
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
children: node refs
~~~

content.list：
~~~text
items: bounded list binding
item_template: declarative child template
max_items: platform-bounded
no arbitrary template code
~~~

action.button：
~~~text
label
action_ref
disabled?: boolean/binding
event: press
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
bind
options: bounded label/value list
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

Production Registry：

- PROPOSED / POC 不得 ENABLED
- 至少 TESTED 才可 production ENABLED
- security incident 可 DISABLED / REVOKED
- maturity 是證據；availability 是該 snapshot 能不能選

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
- old validated Blueprint 保留原 capability refs / registry_version
- compatibility layer 判斷是否仍可執行

# 30. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

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
