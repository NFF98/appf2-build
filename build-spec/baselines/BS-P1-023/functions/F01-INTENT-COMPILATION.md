# F01 — Intent Compilation + Model Gateway

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Intent Analysis、Clarification Policy、Resolved Intent、Capability Coverage coordination、Blueprint Composition 與 Model Gateway 的 Working Current Truth。
>
> 上游：APP-ARCHITECTURE、DATA-MODEL、F04-CAPABILITY-REGISTRY、DESIGN-TO-DELIVERY。
>
> 下游：F02 Blueprint Validation、F00 Experience Shell、F06 Remix / Refine、F07 Evidence、F12 Recovery、F16 Result Correction。
>
> F01 不允許一步式「Prompt → LLM 腦補 → Blueprint」。LLM 只做受控 semantic work；是否需要追問、是否可採 default、是否可進 Blueprint Composition，由 appf2-owned deterministic policy 決定。

# 1. Purpose / User Outcome

User Outcome：

> User 不必會 Prompt Engineering，也能把自然語言 Intent 可靠轉成符合自己真正意思、可被 F02 驗證的 Blueprint Candidate；資訊不夠時，appf2 只問必要問題，不偷偷腦補重要規則。

Canonical flow：

~~~text
User Intent
→ Intent Analysis
→ Structured Intent Envelope
→ Clarification Policy
   ├─ READY
   ├─ READY_WITH_VISIBLE_ASSUMPTIONS
   └─ NEEDS_CLARIFICATION
→ Resolved Intent
→ F04 Capability Coverage
→ Blueprint Composition
→ F02 Validation
   ├─ VALIDATED
   ├─ REJECTED → bounded recompose / recovery
   └─ INCOMPATIBLE → recovery
~~~

F01 成功條件：

~~~text
User meaning preserved
+ material unknowns surfaced
+ deterministic gate respected
+ only registered capabilities selected
+ candidate matches F02 contract
+ invalid candidate never bypasses F02
~~~

# 2. Scope / Non-Scope

Phase 1 定義：

- Intent lifecycle
- Structured Intent Envelope
- provenance / ambiguity / assumption model
- Clarification Policy
- question ranking
- answer merge / re-evaluation
- Resolved Intent
- F04 Capability Coverage integration
- Prompt A / Prompt B boundaries
- Model Gateway adapter
- retry / timeout policy
- Blueprint Composition
- F02 handoff
- F01 public API contracts
- DB responsibility
- error / recovery direction
- security / privacy
- evidence / cost tracking
- acceptance / tests

Phase 1 不做：

- consumer UI rendering
- F02 validation implementation
- F03 Runtime
- F04 Registry ownership
- provider SDK exposed to Client
- provider key in Browser
- external paid Capability execution
- vector retrieval
- arbitrary code generation

# 3. Intent Lifecycle

## F01-RQ-001

~~~text
RECEIVED
→ ANALYZING
→ NEEDS_CLARIFICATION
   ↘ answer submitted → ANALYZING
→ READY_WITH_VISIBLE_ASSUMPTIONS
   ↘ assumptions accepted/edited → READY
→ READY
→ COMPOSING
→ VALIDATING
→ VALIDATED

Failure:
ANALYSIS_FAILED
COMPOSITION_FAILED
VALIDATION_REJECTED
INCOMPATIBLE
CANCELLED
~~~

Rules：

1. READY 前不可執行 Prompt B。
2. NEEDS_CLARIFICATION 時不可用 LLM proposal 代替 User answer。
3. VALIDATED 只在 F02 PASSED 後成立。
4. refine/correction failure 不破壞既有 validated Blueprint。
5. Failure lifecycle owner = intent_record.lifecycle_status；compiler_run只保存 attempt detail，不可建立第二個 lifecycle truth。
6. Canonical failure transition：
   - ANALYZING technical/provider terminal-for-attempt failure → ANALYSIS_FAILED。
   - COMPOSING failure → COMPOSITION_FAILED。
   - final F02 REJECTED after allowed recompose budget → VALIDATION_REJECTED。
   - deterministic incompatibility → INCOMPATIBLE。
7. Same-body retry只可依 error taxonomy / F01-RQ-008A與 idempotency state machine執行：eligible ANALYSIS_FAILED → ANALYZING；eligible COMPOSITION_FAILED → COMPOSING；eligible VALIDATION_REJECTED → COMPOSING。INCOMPATIBLE / security / resource terminal不可 direct retry。
8. retry transition必須與新的 idempotency attempt取得同一 transaction/critical section語意；若 attempt取得失敗，lifecycle不得先行推進。

# 4. Structured Intent Envelope

## F01-DATA-001

~~~text
StructuredIntentEnvelope
├─ envelope_version
├─ goal
├─ actors[]
├─ entities[]
├─ known_inputs[]
├─ constraints[]
├─ requested_outputs[]
├─ candidate_rules[]
├─ missing_fields[]
├─ ambiguities[]
├─ assumptions[]
├─ capability_hints[]
└─ analysis_metadata
~~~

### F01-DATA-001A — Semantic Descriptor / Capability Hint machine shape

`actors[]` / `entities[]` 使用同一個 bounded descriptor，不得留 opaque object 給 implementation 猜：

~~~text
SemanticDescriptor
├─ id
├─ semantic_role
├─ description
├─ source
└─ source_ref?
~~~

`requested_outputs[]` 使用：

~~~text
RequestedOutputDescriptor
├─ id
├─ semantic_role
├─ description
├─ output_type
├─ required
├─ source
└─ source_ref?
~~~

其中 `output_type` 只可為：

~~~text
NUMBER | STRING | BOOLEAN | ENUM | LIST | RECORD
~~~

`capability_hints[]` 是 Prompt A 可輸出的 **semantic requirement hint**，不是 Capability selection，也不得帶 capability_id / capability_version：

~~~text
CapabilityHintV1
├─ hint_id
├─ semantic_need
├─ required
├─ impact_level
├─ input_types[]
├─ output_types[]
├─ interaction_class
├─ constraint_item_ids[]
└─ source_item_ids[]
~~~

Rules：

1. `hint_id`、`SemanticDescriptor.id`、`RequestedOutputDescriptor.id` 使用 canonical semantic ID grammar `^[a-z][a-z0-9_]{0,63}$`，且不得與 policy-visible item / KnownInput ID collision；同一 logical fact跨 re-analysis保持同一 ID。
2. `description` 與 `semantic_need` 都以 Unicode code point計長度，trim後必須 1..512；`semantic_need` 不得包含 provider/model metadata、Capability ID、code、module path 或 runtime handler identity。
3. `input_types[]` / `output_types[]` 只使用上列六個 canonical root value-type token，排序去重；每個 array最多 16 items。
4. `interaction_class` 必須是當前 pinned F04 compiler catalog `intent_classes[]` 已存在的 canonical semantic token；unknown token = Envelope invariant failure。F01不得自行創造另一套 interaction taxonomy。
5. `constraint_item_ids[]` 只可引用同 Envelope policy-visible constraint item；`source_item_ids[]` 只可引用同 Envelope 的 policy-visible item / KnownInput / descriptor ID。Unknown ref / self-inconsistent ref = Envelope invariant failure。
6. Prompt A 只可提出 hint；CapabilityRequirementExtractor 仍由 appf2 deterministic code擁有，LLM 不可直接輸出 final CapabilityRequirement或 selected CapabilityRef。
7. Hint 若引用尚未 CONFIRMED 的 MATERIAL truth，不得進 final CapabilityRequirement；先由 Clarification Policy解決。

Policy-visible semantic item contract：

`constraints[]`、`candidate_rules[]`、`missing_fields[]`、`ambiguities[]`、`assumptions[]` 中凡會參與 Clarification Policy 的 item，都使用以下 bounded machine-readable fields。這些欄位只把既有 Product policy 變成可機械判斷的輸入，不新增新的 clarification outcome。

~~~text
id
semantic_role
description
source
source_ref?
resolution_state
resolved_value?
expected_value_type
question_type
required_for_execution
impact_level
materiality
policy_risk_flags[]
depends_on_ids[]
confidence
can_default
proposed_default?
alternatives[]
user_visible
rationale
~~~

source：

~~~text
USER_EXPLICIT
DOMAIN_KNOWN
NFF_DEFAULT
LLM_PROPOSED
USER_ACCEPTED_PROPOSAL
~~~

source_ref（需要時）：

~~~text
policy_id?
policy_version?
origin_item_id?
~~~

resolution_state：

~~~text
CONFIRMED
UNRESOLVED
PROPOSED
~~~

expected_value_type：

~~~text
NUMBER
STRING
BOOLEAN
ENUM
LIST
RECORD
~~~

`question_type` 使用 F01-DATA-003 的固定 enum；它與 `expected_value_type` 一起決定 server 可驗證的 answer shape，不能由 Client 或 LLM 在 question emission 階段臨時發明。

materiality：

~~~text
MATERIAL
COSMETIC
~~~

policy_risk_flags：

~~~text
MONEY
PERMISSION
EXTERNAL_COST
IRREVERSIBLE
~~~

impact_level：

~~~text
LOW
MEDIUM
HIGH
CRITICAL
~~~

Rules：

- `constraints[]`、`candidate_rules[]`、`missing_fields[]`、`ambiguities[]`、`assumptions[]` 的每一個 item 都是 policy-visible；Phase 1 不允許同一批陣列中再存在一個「是否參與 policy」的 hidden subset。
- USER_EXPLICIT 優先於其他來源。
- NFF_DEFAULT 必須帶 `source_ref.policy_id` + `source_ref.policy_version`；不得只標 NFF_DEFAULT 而遺失 policy provenance。
- LLM_PROPOSED 永遠只是 proposal。
- USER_ACCEPTED_PROPOSAL 表示 User 接受 proposal，不偽裝成原本 User 自己提出；若 proposal 原本有 source_ref，接受後保留該 origin provenance。
- `resolution_state=CONFIRMED` 表示該 semantic truth 已可作為本輪 policy 的已解決輸入；`UNRESOLVED` 表示尚無可用決定；`PROPOSED` 表示已有具體 default/proposal value，但尚未完成必要的 User decision。
- `resolved_value` 是 policy-visible item 的 **唯一 canonical confirmed value**。它屬於 StructuredIntentEnvelope / `intent_record.structured_intent` semantic truth；不得另建平行 durable `user_explicit_values`、answer-value sidecar、第二份 JSON truth 或新 DB 欄位來保存同一答案。
- State/value invariant：
  - `CONFIRMED` → `resolved_value` 必須存在、shape 必須符合 `expected_value_type` / choice alternatives；`proposed_default` 必須不存在，`can_default=false`。
  - `UNRESOLVED` → `resolved_value` / `proposed_default` 都必須不存在，且 `can_default=false`。因此 `UNRESOLVED + can_default=true` 是 Envelope invariant failure，不得交 policy engine 再以 F01-ERR-014 補洞。
  - `PROPOSED` → `resolved_value` 必須不存在、`proposed_default` 必須存在且 type-valid；source 只可為 `NFF_DEFAULT` 或 `LLM_PROPOSED`。`can_default=true` 表示這個 proposal 是安全、可逆、可直接作為 CP-004 default；`can_default=false` 表示 proposal value 可被呈現/詢問但不可默認採用。
- USER_EXPLICIT / USER_ACCEPTED_PROPOSAL item 必須是 CONFIRMED 並帶 canonical `resolved_value`。LLM_PROPOSED 在 User decision 前必須是 PROPOSED。NFF_DEFAULT 在 User 接受前必須是 PROPOSED；接受後變 CONFIRMED，但 source/source_ref 保留 NFF_DEFAULT provenance，接受值移入 `resolved_value`。DOMAIN_KNOWN 不得是 PROPOSED；已知 domain fact 可為 CONFIRMED，未知則使用 UNRESOLVED 而不是偽裝成 proposal。
- `can_default=true` 代表存在安全、可逆、可具體使用的 default，且 `proposed_default` 必須存在；只有一個抽象「可以 default」旗標但沒有 value 是 Envelope invariant failure。
- `resolved_value` / `proposed_default` 必須符合 `expected_value_type`；SINGLE_CHOICE / MULTI_CHOICE 還必須落在 `alternatives[]` 合法集合內。
- 上述 state/value/source invariant 在 Clarification Policy 前先驗證：不可信 Prompt A 違反時走 F01-ERR-002；server persisted/trusted state 違反時走既有 F01-ERR-014。
- `materiality` 與 `impact_level` 是不同軸；**不得**用 LOW/MEDIUM/HIGH/CRITICAL 自行推導 MATERIAL/COSMETIC。
- `COSMETIC` 只表示 presentation/cosmetic preference；必須 `required_for_execution=false` 且 `policy_risk_flags=[]`。
- 任一 `policy_risk_flags` 命中都代表該 item 是 MATERIAL；不得標成 COSMETIC。Risk item 不得用 assumption Accept 取代 clarification；要解除 CP-003，trusted answer merge 必須得到 USER_EXPLICIT truth。
- policy-visible item `id` 與 `KnownInput.id` 在同一 Envelope 內都必須唯一且穩定。
- `ambiguities[]` 的 item 必須有至少 2 個 distinct `alternatives[]`；否則是 Envelope invariant failure，不得交 policy engine 猜「是否真的有兩個 interpretation」。
- `depends_on_ids[]` 只可引用同一 Envelope 內 policy-visible item `id` 或 `KnownInput.id`；不得 self-reference。整體 dependency graph 必須 acyclic；cycle / unknown ref 是 Envelope invariant failure，不得交 ClarificationPolicyEngine 猜測。
- `depends_on_ids[]` 表示「此 item 的 semantic/policy truth 依賴哪些 upstream fact/item」，只供 deterministic policy/re-evaluation 使用。
- 每個可能產生 clarification 的 item 都必須在 Prompt A output 時帶固定 `expected_value_type` + `question_type`。SINGLE_CHOICE / MULTI_CHOICE 必須有至少 2 個 distinct `alternatives[]`；其他 question type 不得靠 runtime 猜 answer schema。
- Question type / expected value type 固定配對：FREE_TEXT→STRING、NUMBER→NUMBER、BOOLEAN→BOOLEAN、SINGLE_CHOICE→ENUM、MULTI_CHOICE→LIST、STRUCTURED_FIELDS→RECORD；不符合即 Envelope invariant failure。
- Prompt A 可輸出上述 semantic classification；輸出仍是不可信 semantic analysis，必須先過 F01 shape/invariant validation。ClarificationPolicyEngine 只依通過驗證的 Envelope + trusted policy state 決定 outcome，LLM 不可直接指定 final clarification status。

# 5. Known Input

## F01-DATA-002

~~~text
KnownInput
├─ id
├─ key
├─ value
├─ value_type
├─ source
├─ source_ref?
├─ confidence?
└─ sensitivity
~~~

value_type：

~~~text
NUMBER
STRING
BOOLEAN
ENUM
LIST
RECORD
~~~

sensitivity：

~~~text
NORMAL
SENSITIVE
DO_NOT_PERSIST
~~~

Rules：

- `id` 是同一 logical Intent 內的 stable semantic fact ID；同一 fact 在 re-analysis / answer merge 前後保持 identity，不得因 wording normalization 任意換 ID。
- User explicit value 不被 LLM 任意改 business meaning。
- formatting normalization 可以；semantic conversion 要明確。
- DO_NOT_PERSIST 只存在 request-scoped context。
- sensitive values 不進 telemetry。
- 需要作為 no-reask upstream dependency 的 User/domain fact 必須有 stable `KnownInput.id`；沒有 stable ID 的欄位不得單獨作為「upstream changed」理由來重問。

# 6. Clarification Policy

Clarification Policy 是 deterministic appf2 code，不是 Prompt。

## F01-POL-CP-001
`missing_fields[]` 中 `resolution_state!=CONFIRMED`、`required_for_execution=true`，且沒有安全明確 default → NEEDS_CLARIFICATION。

> Machine rule：safe default 只在 `can_default=true && proposed_default is present` 時成立；否則不得把 required missing 當成「已有 default」。

## F01-POL-CP-002
`ambiguities[]` 中 `resolution_state!=CONFIRMED` 且有兩個以上合理 interpretation，結果差異 HIGH / CRITICAL → NEEDS_CLARIFICATION。

> Machine rule：`materiality=MATERIAL && alternatives.length >= 2 && impact_level in {HIGH, CRITICAL}`。Envelope invariant 已保證 ambiguity alternatives 可機械判定；COSMETIC ambiguity 不得因 impact_level 單獨升格成 clarification blocker。

## F01-POL-CP-003
任何 policy-visible item 的 `policy_risk_flags[]` 含 MONEY / PERMISSION / EXTERNAL_COST / IRREVERSIBLE，且該 material rule 的 source 不是 USER_EXPLICIT → NEEDS_CLARIFICATION。

> Machine rule：`policy_risk_flags.length > 0 && source !== USER_EXPLICIT` 必須命中 CP-003。Risk flag invariant 已保證此類 item 為 MATERIAL。

## F01-POL-CP-003A
沒有更高優先 NEEDS_CLARIFICATION rule 命中時，只要 policy-visible item 同時符合：
- `materiality=MATERIAL`
- `resolution_state in {UNRESOLVED, PROPOSED}`
- `can_default=false`

→ NEEDS_CLARIFICATION。

這是 material uncertainty 的 totality fallback；它只補上「material、尚未解決、又沒有安全 default」的既有 Product intent，不允許把該狀態偷塞進 READY 或 READY_WITH_VISIBLE_ASSUMPTIONS。

## F01-POL-CP-004
沒有更高優先 rule 命中時，`materiality=MATERIAL`、`resolution_state=PROPOSED` 且有安全可逆 default（`can_default=true`），default/proposal 會影響 outcome → READY_WITH_VISIBLE_ASSUMPTIONS。

## F01-POL-CP-005
沒有更高優先 rule 命中時，`materiality=COSMETIC`（只影響 cosmetic / presentation）→ READY；未解決的 cosmetic item 只能進 ResolvedIntent.unresolved_non_material_items，不得升格為 material truth。

> `impact_level` 只用於 consequence/ranking，不是 materiality threshold。

## F01-POL-CP-006
所有 MATERIAL policy-visible item 都已 `resolution_state=CONFIRMED`，且沒有其他 material ambiguity / blocker → READY。

Precedence：

~~~text
CP-003
> CP-001
> CP-002
> CP-003A
> CP-004
> CP-005
> CP-006
~~~

Totality rules：

1. 任一未被 suppression 排除的 NEEDS_CLARIFICATION rule 命中，overall decision 就是 NEEDS_CLARIFICATION。
2. 通過 Envelope invariant 的 policy-visible item 必須能由上列 precedence 得到唯一 outcome；若同一 item 在 precedence 後仍無 outcome，這是 F01-ERR-014 INTERNAL_INVARIANT，不得由 implementation 自行 fallback。
3. READY_WITH_VISIBLE_ASSUMPTIONS 只可來自 CP-004。
4. READY 只可在沒有任何未解決 MATERIAL item 時成立。

# 7. Question Ranking

## F01-RQ-002

~~~text
Safety / Money / Permission
> Execution Blocker
> High Outcome Divergence
> Core Business Rule
> Secondary Preference
> Cosmetic
~~~

一次最多問 3 題。

Deterministic ranking inputs：

~~~text
policy_priority
impact_level
required_for_execution
downstream_unknowns_resolved
already_asked
~~~

Canonical derivation：

- `policy_priority`：PERMISSION / IRREVERSIBLE → Safety / Permission；MONEY / EXTERNAL_COST → Money；required_for_execution → Execution Blocker；CP-002 HIGH/CRITICAL material ambiguity → High Outcome Divergence；其他 MATERIAL → Core Business Rule；其他非 cosmetic → Secondary Preference；COSMETIC → Cosmetic。
- `impact_level`：CRITICAL > HIGH > MEDIUM > LOW。
- `required_for_execution`：true > false。
- `downstream_unknowns_resolved`：整數，代表若此 target 被解決，可直接解除的 unresolved descendant 數；由 `depends_on_ids[]` DAG 機械計算，數量高者優先。
- `already_asked`：false > true；只有 relevant upstream change 重新開啟時，已問過的 question 才能重新進 eligible set。

Phase 1 sort 必須依上列欄位做 lexicographic comparison；完全同分才以 stable semantic item ID ascending 作最後 tie-break。不得另加 model score、array insertion order 或 prompt wording 作排序權重。

Question grouping：

1. Phase 1 一個 ClarificationQuestion 只對應一個 policy-visible target item；`semantic_item_ids[]` 長度固定為 1。
2. 同一 item 同時命中多個 NEEDS_CLARIFICATION rule 時，只用 precedence 最高的 rule 建立 question；該 rule 成為 `policy_rule_id`。
3. 完成 suppression 後依 canonical ranking 取前 3 題；沒有被選到的 eligible blockers保留到下一輪，不可視為已回答。

Rules：

- answered question 不重問，除非 upstream fact 改變。
- 「upstream fact 改變」必須由 trusted merge/re-evaluation 以 stable semantic item ID 機械判斷；不得用「任何 Intent edit 都可重問」的 coarse rule。
- 同分按 stable semantic item ID 排序。
- LLM 可協助把問題講人話，但不能決定 blocker priority、grouping、type、options 或 identity。

# 8. Clarification Question

## F01-DATA-003

~~~text
ClarificationQuestion
├─ question_id
├─ semantic_item_ids[]
├─ question_type
├─ prompt
├─ options[]?
├─ expected_value_type
├─ required
├─ rationale_key
└─ policy_rule_id
~~~

question_type：

~~~text
FREE_TEXT
NUMBER
BOOLEAN
SINGLE_CHOICE
MULTI_CHOICE
STRUCTURED_FIELDS
~~~

Question identity / projection：

- `question_id` 必須對同一 `policy_rule_id + sorted(semantic_item_ids[])` 保持 deterministic stable identity；可用 deterministic encoding/hash，但同一 tuple 不得產生不同 logical question。
- Phase 1 `semantic_item_ids[]` 固定只含單一 target item ID。
- `question_type = target.question_type`。
- `expected_value_type = target.expected_value_type`。
- SINGLE_CHOICE / MULTI_CHOICE 的 `options[] = target.alternatives[]`；其他 question type 的 options 省略。
- `required=true`：進入 NEEDS_CLARIFICATION 的 question 都是解除 blocker 所需的 User decision；optional preference 不應進 NEEDS_CLARIFICATION。
- `rationale_key = policy_rule_id` 的 stable presentation mapping key；User-facing copy可被 F00 humanize，但不可改變 rule identity。
- `prompt` 可由 `description` 做 deterministic template 或由受控 phrasing layer humanize；prompt wording 不參與 question identity、ranking 或 answer schema。

UI 由 F00 決定。

## F01-DATA-003A — Clarification Policy State（server-owned）

這是 appf2-owned policy engine state，不是 Prompt A / Client 可寫欄位。

Canonical location：

~~~text
StructuredIntentEnvelope.analysis_metadata.clarification_policy_state
~~~

因此 F01-AC-006 的「same Envelope + policy version」包含同一份 server-owned clarification state；不同 answered/change state 本身就是不同 Envelope truth，不構成 determinism 例外。

~~~text
ClarificationPolicyState
├─ policy_version
├─ answered_question_ids[]
└─ changed_semantic_item_ids[]
~~~

Rules：

1. `answered_question_ids[]` 只在 server 接受合法 F01-API-002 answer 後加入 stable question_id。
2. `changed_semantic_item_ids[]` 由 trusted answer merge / re-evaluation 產生，只代表**本次 evaluation 前實際改變**的 semantic items；Client / LLM 不得直接提供。
3. policy-visible item 的 description/source/source_ref/resolution_state/resolved_value/expected_value_type/question_type/required_for_execution/impact_level/materiality/policy_risk_flags/depends_on_ids/can_default/proposed_default/alternatives 等 semantic-policy truth，或 KnownInput 的 value/source/source_ref 發生實質改變，都必須把該 stable ID 記入 changed set；純 formatting normalization 不算 semantic change。
4. 每個 question 的 re-ask basis = `semantic_item_ids[]` 加上這些 target items 的遞迴 `depends_on_ids[]` closure。
5. 若 question_id 已在 answered set，且本次 `changed_semantic_item_ids[]` 與 re-ask basis **無交集** → 必須 suppress，不得重問。
6. 只有交集非空時，該已回答 question 才重新變成 eligible；policy 仍須重新跑 CP-003 > CP-001 > CP-002 > CP-003A > CP-004 > CP-005 > CP-006，不能因 upstream change 自動決定一定要問。
7. `changed_semantic_item_ids[]` 是單次 evaluation input；本次 policy evaluation 完成後不得持續當作下一輪新 change。未發生新的 relevant change 時，同一已回答 question 必須再次被 suppress。
8. unrelated item edit 不得 reopen 已回答 question。
9. accepted answer 的 trusted merge 必須先更新 target semantic truth，再把 question_id 加入 answered set。若同一未變更 target 在 merge 後仍命中同一 NEEDS_CLARIFICATION rule，表示 answer merge 沒有真正解除 blocker，必須 F01-ERR-014 INTERNAL_INVARIANT；不得回傳 NEEDS_CLARIFICATION + 空 questions[]。
10. 完成 suppression 後，只要 overall decision=NEEDS_CLARIFICATION，就必須至少有 1 個且最多 3 個 eligible questions。若存在 unsuppressed NC blocker卻無法投影合法 question，或所有 NC question 被 suppression 但 blocker semantic truth仍未解除，皆是 F01-ERR-014，不得讓 Client 卡在 zero-question clarification state。

# 9. Answer Merge / Re-evaluation

## F01-RQ-003

~~~text
Current Envelope
+ User Answers
→ validate answer types
→ source = USER_EXPLICIT
→ merge known inputs / constraints / rules
→ invalidate stale proposals
→ re-run policy
→ new decision
~~~

Rules：

- answer 不直接 patch Blueprint。
- User answer 與 LLM proposal 衝突時，User answer 優先。
- clarification answer / EDIT 的 canonical transition：target `source=USER_EXPLICIT`、`resolution_state=CONFIRMED`、`resolved_value=validated answer`、`can_default=false`，並移除 `proposed_default`。
- ACCEPT LLM_PROPOSED：把原 `proposed_default` 移入 `resolved_value`，source 變 `USER_ACCEPTED_PROPOSAL`，resolution_state=CONFIRMED，保留 origin provenance，移除 `proposed_default` 並設 `can_default=false`。
- ACCEPT NFF_DEFAULT：把原 `proposed_default` 移入 `resolved_value`，source 保持 `NFF_DEFAULT`，resolution_state=CONFIRMED，保留 policy source_ref，移除 `proposed_default` 並設 `can_default=false`。
- REJECT proposal/default：target 變 `UNRESOLVED`，清除 `resolved_value` / `proposed_default`，`can_default=false`，再重新跑 policy。
- accepted/edited clarification value 的 durable owner只有 StructuredIntentEnvelope target item 的 `resolved_value`；不得新增平行 `user_explicit_values` persistent state。後續 ResolvedIntent 由這份 canonical structured truth 投影。
- trusted merge 先計算直接 semantic change IDs，再於 policy re-evaluation 前執行 **dependent stale-proposal invalidation**：
  1. 對任何 `resolution_state=PROPOSED` 的 policy-visible item，若其 recursive `depends_on_ids[]` closure 與本次 changed set 有交集，該 proposal/default 已 stale；
  2. stale item deterministic 轉成 `UNRESOLVED`、`can_default=false`，清除 `resolved_value` / `proposed_default`，source/source_ref/id/question-shape provenance保留；
  3. 被 invalidated 的 item stable ID 加入 `changed_semantic_item_ids[]`；
  4. 以上步驟以新增 changed IDs 繼續往 downstream 做 fixpoint，直到沒有新的 PROPOSED item 被 invalidated；
  5. `depends_on_ids[]` 交集本身**不得**自動刪除 CONFIRMED USER_EXPLICIT / USER_ACCEPTED_PROPOSAL truth；若 trusted re-evaluation 真正判定該 User truth 已不再適用，必須先形成新的 semantic truth，再由一般 no-reask 規則決定是否重新提問。
- trusted merge 必須以 stable semantic item ID 產生本次 `changed_semantic_item_ids[]`；只有落在已回答 question re-ask basis 的 changed fact 才可重新打開該 downstream ambiguity。
- unrelated fact change 不得重開已回答 question。
- provenance 必須保留。
- re-evaluation 記 policy_version + triggered_rule_ids。
- Client 不得在 F01-API-002 直接提交 `resolved_value`、`answered_question_ids[]`、`changed_semantic_item_ids[]` 或直接標示「可重問」來繞過 trusted merge。Prompt A 可從 User 原始輸入抽取 USER_EXPLICIT / DOMAIN_KNOWN 的候選 `resolved_value`，但仍屬 untrusted analysis，必須通過 F01-DATA-001 invariant validation，不能直接覆寫 server trusted state。

# 10. Visible Assumptions

## F01-DATA-004

~~~text
FACT
DEFAULT
PROPOSAL
UNKNOWN
~~~

Canonical classification：

- FACT：`resolution_state=CONFIRMED` 的 USER_EXPLICIT / DOMAIN_KNOWN / USER_ACCEPTED_PROPOSAL truth；呈現值來自 `resolved_value`，internal provenance仍保留，不因 User-facing label 而改寫 source。
- DEFAULT：尚待 User decision 的 NFF_DEFAULT；呈現值來自 `proposed_default`。
- PROPOSAL：尚待 User decision 的 LLM_PROPOSED；呈現值來自 `proposed_default`。
- UNKNOWN：`resolution_state=UNRESOLVED`，且依 invariant 不得帶 `resolved_value` / `proposed_default`。

READY_WITH_VISIBLE_ASSUMPTIONS 必須把 material DEFAULT / PROPOSAL 顯示給 User；MATERIAL UNKNOWN 不得走 assumption review，必須由 NEEDS_CLARIFICATION 解決。

F00 必須能 edit / accept / reject。

Assumption decision：

- Accept LLM_PROPOSED → `resolved_value=proposed_default`、source=USER_ACCEPTED_PROPOSAL、resolution_state=CONFIRMED，保留 origin provenance，並清除 proposed_default。
- Accept NFF_DEFAULT → `resolved_value=proposed_default`、resolution_state=CONFIRMED，source仍為 NFF_DEFAULT，保留 policy source_ref，清除 proposed_default，接受事實記入 accepted_assumptions。
- Edit → `resolved_value=edited_value`、source=USER_EXPLICIT、resolution_state=CONFIRMED，並清除 proposed_default。
- Reject → 原 proposal/default 不得進 Resolved Intent；target 轉 UNRESOLVED、清除 resolved/proposed value，再重新跑 policy。
- 含 policy_risk_flags 的 MATERIAL item不可用 assumption Accept 解決；必須經 clarification answer形成 USER_EXPLICIT truth。

# 11. Resolved Intent

## F01-DATA-005

~~~text
ResolvedIntent
├─ resolved_intent_version
├─ intent_id
├─ goal
├─ actors[]                       // SemanticDescriptor[]
├─ entities[]                     // SemanticDescriptor[]
├─ inputs[]                       // ResolvedInput[]
├─ constraints[]                  // ResolvedSemanticItem[]
├─ outputs[]                      // RequestedOutputDescriptor[]
├─ rules[]                        // ResolvedSemanticItem[]
├─ accepted_assumptions[]         // ResolvedAssumption[]
├─ unresolved_non_material_items[] // UnresolvedNonMaterialItem[]
├─ capability_requirements[]      // CapabilityRequirement[]
└─ provenance_map                 // map<resolved_item_id, ProvenanceEntry>
~~~

Exact Phase 1 entry shape：

~~~text
ResolvedInput
├─ id
├─ key
├─ value
├─ value_type
├─ source
├─ source_ref?
└─ sensitivity                  // NORMAL | SENSITIVE only

ResolvedSemanticItem
├─ id
├─ semantic_role
├─ value
├─ value_type
├─ source
├─ source_ref?
├─ impact_level
└─ materiality

ResolvedAssumption
├─ id
├─ semantic_role
├─ value
├─ value_type
├─ origin_source                // NFF_DEFAULT | USER_ACCEPTED_PROPOSAL
└─ source_ref?

UnresolvedNonMaterialItem
├─ id
├─ semantic_role
├─ description
├─ expected_value_type
├─ source
└─ source_ref?

ProvenanceEntry
├─ structured_item_id
├─ source
└─ source_ref?
~~~

Deterministic projection：

1. `actors[]` / `entities[]` / `outputs[]` 是通過 F01-DATA-001A invariant 的 corresponding descriptor deterministic copy；不得在 ResolvedIntent 時重新由 LLM 改寫語意。
2. `KnownInput.sensitivity in {NORMAL,SENSITIVE}` 且仍屬有效 resolved truth時投影到 `inputs[]`；保留 id/key/value/value_type/source/source_ref/sensitivity。
3. `KnownInput.sensitivity=DO_NOT_PERSIST` **永遠不得**寫入 `intent_record.resolved_intent`、compiler_run、Blueprint 或 telemetry。若本次 composition 必須使用它，只能放在 request-scoped `EphemeralResolvedContext.inputs[]` 傳給 Prompt B；request結束即丟棄。之後 retry若該 context不存在，必須要求 User重新提供，不能從 durable truth猜回。
4. `constraints[]` / `rules[]` 只投影 `resolution_state=CONFIRMED` 的 corresponding policy-visible item，value必須取 canonical `resolved_value`；PROPOSED / UNRESOLVED 不得偷進。
5. accepted NFF_DEFAULT / USER_ACCEPTED_PROPOSAL 投影到 `accepted_assumptions[]`；USER_EXPLICIT edit後屬一般 resolved truth，不再偽裝 assumption。
6. `materiality=COSMETIC && resolution_state!=CONFIRMED` 只可投影到 `unresolved_non_material_items[]`，而且不得作為 Prompt B executable/material input。
7. `provenance_map` 對每個 durable resolved item ID 必須恰有一個 entry，指回 canonical StructuredIntent / KnownInput item與 source/source_ref；不得保存另一份 value truth。
8. 所有 ID-bearing arrays 按 stable `id` lexicographic order持久化；`provenance_map` key同樣 canonical sort，讓同一 semantic truth byte-stable。
9. `capability_requirements[]` 只可由 F01-RQ-004 CapabilityRequirementExtractor產生；Prompt A / Client不可直接持久化 final requirement。
10. `EphemeralResolvedContext` 不是 ResolvedIntent、不是 durable semantic record，也不參與 idempotency request digest以外的持久化 replay payload；其缺失只能 fail closed / request User重新提供。

進 Prompt B 條件：

~~~text
decision = READY
OR
decision = READY_WITH_VISIBLE_ASSUMPTIONS
AND all material assumptions accepted
~~~

Resolved Intent 禁止 required unknown、CRITICAL ambiguity、hidden material proposal、provider metadata、executable code。

# 12. Capability Requirement / Coverage

## F01-RQ-004

F01 從 Resolved Intent deterministic 產生：

~~~text
CapabilityRequirement
├─ requirement_id
├─ semantic_need
├─ required
├─ impact_level
├─ input_types[]
├─ output_types[]
├─ interaction_class
└─ constraints[]
    └─ RequirementConstraint
       ├─ semantic_item_id
       ├─ value
       └─ value_type
~~~

### F01-RQ-004A — CapabilityRequirementExtractor

Canonical input只包含：

~~~text
ResolvedIntent without final capability_requirements
+ validated StructuredIntentEnvelope.capability_hints[]
+ pinned F04 compiler_catalog intent_classes
~~~

Algorithm：

1. 只處理通過 F01-DATA-001A invariant 的 CapabilityHintV1。
2. 每個 `source_item_ids[]` 必須能 trace到本輪仍有效的 resolved truth；若 MATERIAL source尚未 CONFIRMED，extractor fail closed，不得跳過 Clarification Gate。
3. 每個 `constraint_item_ids[]` deterministic resolve到 `ResolvedIntent.constraints[]` 的 exact item；投影為 `RequirementConstraint{semantic_item_id,value,value_type}`。
4. `semantic_need / required / impact_level / input_types / output_types / interaction_class` 必須與 validated hint一致；extractor不得增添、刪除或由 capability名稱反推。
5. `requirement_id` = `sha256:` + lower-hex SHA-256 of canonical UTF-8 JSON tuple：
   `{semantic_need,required,impact_level,input_types(sorted),output_types(sorted),interaction_class,constraints(sorted by semantic_item_id)}`。
   同一 logical requirement 必須得到同一 ID；`hint_id` 不參與 identity。
6. 完全相同 `requirement_id` dedupe成一項；若同一 requirement_id 對應不同 canonical tuple，F01-ERR-014 INTERNAL_INVARIANT。
7. Extractor **不呼叫 ModelGateway**、不選 Capability ID/version、不做 fuzzy capability matching；Capability selection只由 F04 coverage resolver依 Registry semantic catalog完成。
8. final `ResolvedIntent.capability_requirements[]` 按 requirement_id sort後持久化，並交 F04 `resolveCapabilityCoverage(requirements)`。

這個 contract刻意沿用既有 Prompt A `analyzeIntent`；Phase 1不新增第三個 LLM operation。

Result：

- FULLY_SUPPORTED → 可進 Prompt B。
- PARTIALLY_SUPPORTED → 只有 preserves_semantic_core=true 且 material degradation user-visible 才可進 Prompt B。
- EXTERNAL_OR_HEAVY_REQUIRED → Phase 1 不 fake local compile。
- UNSUPPORTED → 不 compose fake Blueprint。

F01 不自己發明 Capability ID。

# 13. Prompt A — Intent Analyst

## F01-RQ-005

Input：

~~~text
raw_user_intent
conversation_or_correction_context
capsule_metadata
capability_semantic_catalog
domain_policy_metadata
prompt_version
envelope_version
~~~

Hard contract：

1. Preserve user facts。
2. Separate facts / unknowns / defaults / proposals。
3. Never invent required business values。
4. Identify material ambiguity。
5. Propose only safe/reversible defaults。
6. Mark provenance / resolution_state / resolved_value-or-proposed_default state / impact / materiality / policy_risk_flags / depends_on_ids / deterministic answer shape for every policy-visible item，並遵守 F01-DATA-001 source/resolution/value invariant。
7. Output Structured Intent Envelope only。
8. Do not output Blueprint。
9. Do not output executable code。
10. Do not decide final clarification status。

Prompt A output 先過 Envelope schema，再跑 Clarification Policy。

# 14. Prompt B — Blueprint Composer

## F01-RQ-006

Input：

~~~text
resolved_intent
ephemeral_resolved_context?          // request-scoped DO_NOT_PERSIST values only; never durable
accepted_visible_assumptions
capability_coverage_result
compiler_catalog
F02 blueprint contract
security_resource_policy
existing_blueprint?
prompt_version
schema_version
registry_version
model_adapter
evaluation_fixture_version
~~~

Hard contract：

1. Resolved Intent = semantic source of truth。
2. 不新增 material business assumption。
3. 只能使用 selected / registered Capability。
4. 只能使用 F02 allowlisted operators/actions。
5. Preserve explicit constraints / totals / invariants。
6. Output Blueprint Candidate only。
7. No arbitrary JS。
8. No provider-specific runtime config。

Prompt B output 永遠視為 untrusted Candidate，必須進 F02。

# 15. Model Gateway

## F01-RQ-007

appf2-owned interface：

~~~text
ModelGateway
├─ analyzeIntent(request)
├─ composeBlueprint(request)
└─ health()
~~~

Adapter request：

~~~text
operation
prompt_version
response_schema
input_payload
timeout_ms
trace_id
provider_policy
~~~

Adapter response：

~~~text
status
structured_output?
provider_metadata
token_usage?
latency_ms
failure?
~~~

Rules：

- provider/model 只是 operational metadata。
- provider secret server-only。
- provider SDK 不滲入 F02/F03。
- future provider switch 不改 public API / Blueprint。
- structured output / schema mode 優先。
- raw provider text 不直接當 product truth。

# 16. Timeout / Retry Policy

## F01-POL-007

Phase 1：

~~~text
Intent Analysis timeout = 15s
Blueprint Compose timeout = 20s
max provider attempts per operation = 2
~~~

Retry only：

- network transient
- provider 429
- provider 5xx
- first invalid structured output

No auto-retry：

- User cancelled
- clarification required
- unsupported capability
- security terminal
- deterministic semantic contradiction

Blueprint composition 在 F02 rejection 後最多再 recompose 1 次。

# 17. Validation Feedback Loop

## F01-RQ-008

F02 REJECTED 分類：

~~~text
SCHEMA_FIXABLE
CAPABILITY_FIXABLE
SEMANTIC_CONTRADICTION
SECURITY_TERMINAL
RESOURCE_TERMINAL
~~~

Handling：

- SCHEMA_FIXABLE → max 1 recompose。
- CAPABILITY_FIXABLE → refresh F04 coverage + max 1 recompose。
- SEMANTIC_CONTRADICTION → 回 clarification/refine。
- SECURITY_TERMINAL → 不 retry。
- RESOURCE_TERMINAL → explicit simplification / recovery。

### F01-RQ-008A — Authoritative F02 rejection classification

F02自己的 `Retry` 欄只描述 validator error本身，不授權 F01 recompose。F01 唯一 canonical mapping：

| F02 error | F01 rejection class | F01 action |
|---|---|---|
| F02-ERR-001 INVALID_JSON | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-002 SCHEMA_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-003 SCHEMA_VERSION_UNSUPPORTED | SCHEMA_FIXABLE | max 1 recompose only against the already pinned supported schema; otherwise terminal incompatible |
| F02-ERR-004 REGISTRY_INCOMPATIBLE | CAPABILITY_FIXABLE | refresh F04 once, then max 1 recompose |
| F02-ERR-005 CAPABILITY_INVALID | CAPABILITY_FIXABLE | refresh F04 once, then max 1 recompose |
| F02-ERR-006 STATE_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-007 NODE_GRAPH_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-008 BINDING_TYPE_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-009 EXPRESSION_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-010 ACTION_EVENT_INVALID | SCHEMA_FIXABLE | max 1 recompose |
| F02-ERR-011 RESOURCE_LIMIT_EXCEEDED | RESOURCE_TERMINAL | no same-body auto recompose; explicit simplify/edit |
| F02-ERR-012 PERMISSION_NOT_ALLOWED | SECURITY_TERMINAL | no retry/recompose; edit request |
| F02-ERR-013 FORBIDDEN_EXECUTABLE_CONTENT | SECURITY_TERMINAL | no retry/recompose |
| F02-ERR-014 DEGRADATION_INVALID | CAPABILITY_FIXABLE | refresh F04 once, then max 1 recompose |
| F02-ERR-015 HASH_INTEGRITY_FAILURE | SECURITY_TERMINAL | no recompose; surface F01-ERR-014 INTERNAL_INVARIANT / safe recovery |
| F02-ERR-016 BLUEPRINT_REVOKED | SECURITY_TERMINAL | no recompose |
| F02-ERR-017 BLUEPRINT_INCOMPATIBLE | CAPABILITY_FIXABLE | refresh compatibility/coverage once; no fake local success |

Rules：

1. 一個 compile logical operation的 validation-driven recompose budget總共最多 1 次；不能每 error class各重設一次。
2. CAPABILITY_FIXABLE先重跑 pinned/current F04 coverage；若結果變 UNSUPPORTED / EXTERNAL_OR_HEAVY_REQUIRED，轉 F01-ERR-008，不再 compose。
3. Fixable budget耗盡仍 REJECTED → F01-ERR-011 VALIDATION_REJECTED。
4. RESOURCE_TERMINAL → F01-ERR-011，`details.rejection_class=RESOURCE_TERMINAL`，只允許 User edit / simpler version，不得 same-body retry。
5. PERMISSION_NOT_ALLOWED / FORBIDDEN_EXECUTABLE_CONTENT / BLUEPRINT_REVOKED → F01-ERR-012 SECURITY_TERMINAL。
6. F02-ERR-015 是 integrity fault，不得包成普通 User validation rejection；F01回 F01-ERR-014並交安全 recovery。
7. `SEMANTIC_CONTRADICTION` 保留給 F01自身對 Resolved Intent / composed candidate semantic consistency的 deterministic contradiction；F02明定不從 Blueprint JSON單獨證明 Intent semantic correctness，因此 Phase 1沒有 F02 error code直接映射此 class。

F01 不偷偷 mutation F02 Candidate。

# 18. Public API Conventions

Cross-Function canonical owner：`working/common-core/API-CONVENTIONS.md`。

F01以下只列 Function-specific usage；若與 Shared API Conventions衝突，以 Shared contract為準。

Phase 1 API base：

~~~text
/api/v1
~~~

Transport：

~~~text
HTTPS
JSON UTF-8
~~~

Mutation POST headers：

~~~text
Content-Type: application/json
X-Request-Id: optional client UUID
Idempotency-Key: required
~~~

Success envelope：

~~~json
{
  "request_id": "req_123",
  "data": {}
}
~~~

Error envelope：

~~~json
{
  "request_id": "req_123",
  "error": {
    "code": "F01-ERR-...",
    "message_key": "intent.analysis_failed",
    "retryable": false,
    "details": {}
  }
}
~~~

Rules：

- details 不含 raw provider stack。
- User copy 由 F00/F12 mapping。
- API version 與 Blueprint schema version 分離。
- same Idempotency-Key + same body → same logical operation。
- same key + different body → 409 IDEMPOTENCY_CONFLICT。

## F01-API-ID-001 — Anonymous continuity binding

Canonical request identity：

~~~text
request_anonymous_id
~~~

來源規則：

1. `POST /api/v1/intents` 由 request body `anonymous_id` 提供；若 platform同時有 trusted request context identity，兩者必須 exact match，否則 400 / F01-ERR-001。
2. `POST /api/v1/intents/{intent_id}/answers` 與 `POST /api/v1/intents/{intent_id}/compile` **不得**接受 body anonymous_id；由 appf2 server-owned trusted request context提供 `request_anonymous_id`。
3. trusted request context是 server adapter boundary；可由 first-party request/session plumbing實現，但 Product contract不固定 cookie/header名稱。Client不可用 arbitrary body field覆寫它。
4. answers/compile lookup必須以 `(intent_id, request_anonymous_id)` scope，或等價 server-side equality check。若 intent不存在或存在但 `intent_record.anonymous_id != request_anonymous_id`，兩者都回相同 404 / F01-ERR-015 INTENT_NOT_FOUND；不得洩漏另一 anonymous identity是否擁有該 intent。
5. missing/invalid trusted identity context → 400 / F01-ERR-001。
6. 這個 equality gate只建立 continuity / idempotency isolation；**不是 authentication、ownership proof或 sensitive-action authorization**，不得改寫 F07 anonymous identity contract。
7. F01 idempotency scope中的 anonymous_id永遠使用本節 resolved的 `request_anonymous_id`。

# 19. API 1 — Create / Analyze Intent

## F01-API-001

~~~text
POST /api/v1/intents
~~~

Request：

~~~json
{
  "anonymous_id": "uuid",
  "intent_kind": "CREATE",
  "raw_intent": "幫我做一個公司聚餐分帳工具",
  "source": {
    "type": "DIRECT_PROMPT",
    "capsule_id": null
  },
  "context": {
    "source_blueprint_hash": null
  }
}
~~~

intent_kind：

~~~text
CREATE
REFINE
REMIX
CORRECT
~~~

Response 可能：

~~~text
NEEDS_CLARIFICATION
READY_WITH_VISIBLE_ASSUMPTIONS
READY
~~~

NEEDS_CLARIFICATION response 必須回：

~~~text
intent_id
policy_version
triggered_rule_ids[]
questions[]
visible_assumptions[]
intent_version
~~~

# 20. API 2 — Submit Answers / Assumption Decisions

## F01-API-002

~~~text
POST /api/v1/intents/{intent_id}/answers
~~~

Request：

~~~json
{
  "answers": [
    {
      "question_id": "q_bill_total",
      "value": 12500
    }
  ],
  "assumption_decisions": [
    {
      "assumption_id": "asm_1",
      "decision": "ACCEPT",
      "edited_value": null
    }
  ],
  "intent_version": 3
}
~~~

decision：

~~~text
ACCEPT
EDIT
REJECT
~~~

Rules：

- intent_version = optimistic concurrency token。
- stale version → 409 INTENT_VERSION_CONFLICT。
- answer type 必須 match expected type。
- answer provenance = USER_EXPLICIT，accepted answer value 寫入 target policy-visible item 的 canonical `resolved_value`。
- accepted proposal = USER_ACCEPTED_PROPOSAL；accepted NFF default 保留 NFF_DEFAULT provenance；兩者 accepted concrete value 都由 `resolved_value` 保存。
- 不建立獨立 durable answer-value sidecar；`intent_record.structured_intent` 是 clarification-in-progress semantic truth 的唯一 durable owner。
- REJECT proposal 可重新產生 ambiguity。
- successful answer/assumption mutation 必須先完成 dependent stale-proposal invalidation，再 re-run policy。
- response 再回 NEEDS_CLARIFICATION / READY_WITH_VISIBLE_ASSUMPTIONS / READY。

# 21. API 3 — Compile to Validated Blueprint

## F01-API-003

~~~text
POST /api/v1/intents/{intent_id}/compile
~~~

Preconditions：

~~~text
normal entry:
  intent.lifecycle_status = READY

retry entry:
  intent.lifecycle_status = COMPOSITION_FAILED | VALIDATION_REJECTED
  AND previous F01 error / F01-RQ-008A class is retry-eligible
  AND resolved_intent is still valid for current intent_version

both:
  resolved_intent exists
  coverage = FULLY_SUPPORTED
  or allowed PARTIALLY_SUPPORTED
~~~

Retry entry atomic transition：eligible failure state → `COMPOSING`；不得為了通過 precondition先偽造一個 durable READY transition。INCOMPATIBLE、SECURITY_TERMINAL、RESOURCE_TERMINAL與 CANCELLED不得 direct same-body compile retry，必須先有 explicit User edit / compatibility change / new logical mutation。

Request：

~~~json
{
  "intent_version": 4,
  "source_blueprint_hash": null,
  "client_context": {
    "locale": "zh-TW"
  }
}
~~~

Success：

~~~json
{
  "request_id": "req_456",
  "data": {
    "intent_id": "uuid",
    "status": "VALIDATED",
    "content_hash": "sha256:...",
    "schema_version": "1.0.0",
    "registry_version": "4.0.0",
    "support": {
      "coverage_status": "FULLY_SUPPORTED",
      "degradations": []
    }
  }
}
~~~

一般 consumer response 不暴露 raw Blueprint Candidate。

Internal diagnostic inspection 必須是獨立 authenticated path。

# 22. Idempotency

## F01-API-004

適用三個 mutation API。

Logical record：

~~~text
idempotency_key
anonymous_id
route
request_digest
logical_result_ref
created_at
expires_at
~~~

Phase 1 TTL：24h。

Canonical persistence：DATA-MODEL `idempotency_operation` / PostgreSQL。

Rules：

- retry 不 duplicate intent / logical compiler operation；每個 provider attempt仍可有自己的 compiler_run attempt evidence。
- compile retry 若 logical operation 已成功，直接回同 logical result。
- key 不跨 anonymous identity reuse。
- same key + same body + IN_PROGRESS 且 lease尚有效 → 409 IDEMPOTENCY_IN_PROGRESS。
- same key + same body + FAILED_RETRYABLE → 依 Shared API / DATA-MODEL canonical CAS重新取得同 logical operation，attempt_no +1，不建立第二個 intent / logical compile。
- same key + same body + IN_PROGRESS 但 lease已逾 canonical route deadline → 只允許一個 caller以 CAS takeover成新 attempt；舊 attempt任何 late completion不得覆寫新 attempt。
- same key + different body → 409 IDEMPOTENCY_CONFLICT。
- `POST /intents` 在 provider work前就必須把同 logical operation綁到唯一 `intent_record` result_ref；504/provider failure後重試沿用同 intent_id。
- compile success的 logical_result_ref可指向 admitting validation_run，再 deterministic取得 immutable Blueprint content_hash；不得保存 raw success response作第二份 truth。
- F01不得建立自己的 idempotency table / KV truth。

# 23. API Timeout / Cancellation

Server budget：

~~~text
POST /intents               <= 20s
POST /intents/{id}/answers  <= 20s
POST /intents/{id}/compile  <= 30s
~~~

超時：

~~~text
HTTP 504
F01-ERR-009 OPERATION_TIMEOUT
~~~

Phase 1 不建立 async job polling。

Client abort 可以停止等待；server 若 provider request 已發出，盡可能 cancel。Idempotency 保證 retry 不產生 duplicate logical result。

# 24. HTTP Status Mapping

~~~text
200 success
400 malformed request / invalid answer type
404 intent not found
409 version / idempotency conflict
422 semantically not allowed
429 quota / pressure
500 internal invariant
502 provider unavailable / invalid upstream response
504 timeout
~~~

User 不看裸 HTTP error。

# 25. Internal Service Boundaries

~~~text
IntentAnalyzer
ClarificationPolicyEngine
IntentResolver
CapabilityRequirementExtractor
CapabilityCoverageClient
BlueprintComposer
ModelGateway
IntentRepository
CompilerRunRepository
BlueprintValidatorClient
~~~

Provider adapters只是 implementation，例如 OpenAI-compatible / Groq-compatible；不得改 domain interface。

# 26. Data / DB

F01 讀：

- anonymous_identity
- intent_record
- F04 compiler catalog / coverage
- existing blueprint_content when refine/remix/correct
- F02 validation contract metadata

F01 寫：

- intent_record
- compiler_run

F01 不直接寫：

- blueprint_content bypassing F02
- validation_run
- Runtime Instance
- share
- raw product_event payload

Rules：

- clarification progress 可更新同 intent_record。
- refine/remix/correct 建新 intent_record。
- F01 不 mutation immutable Blueprint。

# 27. F00 Interaction Contract

F01 向 F00 提供 UI states：

~~~text
ANALYZING
NEEDS_CLARIFICATION
READY_WITH_VISIBLE_ASSUMPTIONS
READY
COMPOSING
VALIDATING
VALIDATED
RECOVERABLE_FAILURE
TERMINAL_FAILURE
~~~

F00 必須能：

- 顯示 1–3 questions
- 顯示 provenance
- edit/accept/reject material assumptions
- 保留 raw input
- compile loading / cancel
- failure 保留 context
- VALIDATED 後進 Runtime

Visual layout 由 F00 決定。

# 28. Error Taxonomy

| ID | Meaning | Retry | Preserve |
|---|---|---|---|
| F01-ERR-001 | INVALID_REQUEST | NO | raw input |
| F01-ERR-002 | INTENT_ANALYSIS_SCHEMA_INVALID | CONDITIONAL | raw input |
| F01-ERR-003 | CLARIFICATION_ANSWER_INVALID | NO | current intent |
| F01-ERR-004 | INTENT_VERSION_CONFLICT | YES | current intent |
| F01-ERR-005 | MODEL_PROVIDER_RATE_LIMITED | YES | current intent |
| F01-ERR-006 | MODEL_PROVIDER_UNAVAILABLE | YES | current intent |
| F01-ERR-007 | MODEL_OUTPUT_INVALID | CONDITIONAL | current intent |
| F01-ERR-008 | CAPABILITY_UNSUPPORTED | NO | resolved intent |
| F01-ERR-009 | OPERATION_TIMEOUT | YES | operation identity |
| F01-ERR-010 | BLUEPRINT_COMPOSITION_FAILED | CONDITIONAL | resolved intent |
| F01-ERR-011 | VALIDATION_REJECTED | CONDITIONAL | resolved intent / previous Blueprint |
| F01-ERR-012 | SECURITY_TERMINAL | NO | safe context |
| F01-ERR-013 | IDEMPOTENCY_CONFLICT | NO | existing operation |
| F01-ERR-014 | INTERNAL_INVARIANT | NO | trace context |
| F01-ERR-015 | INTENT_NOT_FOUND | NO | safe request context |

# 29. Recovery

Provider transient：

~~~text
preserve raw Intent
→ bounded retry
→ if fail, retry/edit
~~~

Invalid clarification：

~~~text
keep current answers
→ identify invalid field
→ resubmit
~~~

Unsupported：

~~~text
do not fake compile
→ show unsupported / degradation
→ edit Intent
~~~

Validation rejection：

~~~text
preserve Resolved Intent
+ preserve existing Blueprint
→ max 1 fixable recompose
→ otherwise clarification/recovery
~~~

# 30. Security / Privacy

- F01-SEC-001 Provider keys server-only。
- F01-SEC-002 Raw Intent = USER_CONTENT。
- F01-SEC-003 Raw Intent 不自動進 telemetry。
- F01-SEC-004 LLM output 一律 untrusted。
- F01-SEC-005 LLM 不可覆蓋 Clarification Policy。
- F01-SEC-006 Model output 不可指定 executable code / secret。
- F01-SEC-007 Client 不可直接送 resolved_intent 繞過 policy。
- F01-SEC-008 Client 不可自稱 F02 VALIDATED。
- F01-SEC-009 Sensitive / DO_NOT_PERSIST 依 policy 不 durable。
- F01-SEC-010 Debug raw payload 必須 bounded retention + access control。
- F01-SEC-011 Prompt injection text 只作 user content。
- F01-SEC-012 System policy / Registry metadata 與 user content 分離。

# 31. Evidence / Economics

Event seed：

~~~text
F01-EVT-001 intent_received
F01-EVT-002 intent_analysis_completed
F01-EVT-003 clarification_required
F01-EVT-004 clarification_answered
F01-EVT-005 visible_assumption_shown
F01-EVT-006 visible_assumption_accepted
F01-EVT-007 resolved_intent_ready
F01-EVT-008 capability_coverage_resolved
F01-EVT-009 composition_started
F01-EVT-010 composition_succeeded
F01-EVT-011 composition_failed
F01-EVT-012 validation_recompose
F01-EVT-013 intent_validated
F01-EVT-014 provider_failure
~~~

Evidence source ownership：

~~~text
product_event common envelope
├─ function_id = F01
├─ intent_id when applicable
├─ error_code when applicable
└─ trace_id when applicable

F01 event properties
├─ intent_kind
├─ policy_version
├─ prompt_version
├─ blueprint_schema_version
├─ registry_version
├─ model_adapter
├─ attempt_no
├─ latency_ms
└─ coverage_status

compiler_run
├─ input_tokens
├─ output_tokens
└─ estimated_cost

F01 policy semantic / API truth
└─ triggered_rule_ids[]
~~~

Rules：

- `triggered_rule_ids[]` 是 clarification / policy diagnostic truth，不複製成 product_event property。
- token usage / estimated_cost 的 canonical durable owner 是 `compiler_run`；product_event 不建立第二份 economics truth。
- event `schema_version` 只代表 Evidence event schema；Blueprint / Composer target schema 必須使用 `blueprint_schema_version`。
- Raw Intent / raw model response 不進 telemetry by default。

`compiler_run` 支援 cost_per_successful_intent 的計算。

# 32. Acceptance Criteria

Semantic / Policy：

- F01-AC-001 User fact 不被 LLM proposal 覆蓋。
- F01-AC-002 required missing + no safe default → NEEDS_CLARIFICATION。
- F01-AC-003 money/permission/cost rule 未 USER_EXPLICIT → NEEDS_CLARIFICATION。
- F01-AC-004 material proposal 必須 visible。
- F01-AC-005 answered question 不重問，除非 upstream condition 改變。
- F01-AC-006 same Envelope + policy version → same decision。
- F01-AC-007 Prompt B 不得在 gate pass 前執行。

Capability / Blueprint：

- F01-AC-008 unknown Capability 不可由 LLM 創造並進 Blueprint。
- F01-AC-009 Unsupported / External 不 fake local success。
- F01-AC-010 Prompt B output 100% 經 F02。
- F01-AC-011 F02 rejection 不可 bypass。
- F01-AC-012 validation-driven recompose 最多 1 次。

API：

- F01-AC-013 POST /intents retry 不 duplicate intent。
- F01-AC-014 POST /compile retry 不 duplicate logical compile。
- F01-AC-015 stale intent_version → 409。
- F01-AC-016 error envelope 永遠有 request_id + stable code。
- F01-AC-017 Client 無法送 resolved_intent 繞過 policy。
- F01-AC-018 Provider secret 不出 Client / Blueprint。

Reliability / Evidence：

- F01-AC-019 provider retry bounded。
- F01-AC-020 timeout 保留 Intent，可 retry。
- F01-AC-021 compile failure 不破壞 existing Blueprint。
- F01-AC-022 prompt/schema/registry/model adapter version 可追。
- F01-AC-023 Raw Intent 不要求進 telemetry。
- F01-AC-024 token/cost/latency 可按 compiler_run 量測。

# 33. Test Mapping Seed

~~~text
F01-AC-001 → TEST-F01-001 provenance precedence
F01-AC-002 → TEST-F01-CP-001 required missing
F01-AC-003 → TEST-F01-CP-003 money/permission gate
F01-AC-004 → TEST-F01-004 visible proposal
F01-AC-005 → TEST-F01-005 no repeat
F01-AC-006 → TEST-F01-006 deterministic policy
F01-AC-007 → TEST-F01-007 no Prompt B before gate
F01-AC-008 → TEST-F01-008 unknown capability blocked
F01-AC-010 → TEST-F01-010 mandatory F02
F01-AC-012 → TEST-F01-012 bounded recompose
F01-AC-013 → TEST-F01-API-001 create idempotency
F01-AC-015 → TEST-F01-API-002 optimistic concurrency
F01-AC-016 → TEST-F01-API-003 error envelope
F01-AC-017 → TEST-F01-SEC-007 bypass prevention
F01-AC-019 → TEST-F01-019 bounded retry
F01-AC-021 → TEST-F01-021 preserve previous Blueprint
~~~

# 34. Dependencies

Upstream：

- DATA-MODEL intent_record / compiler_run
- F04 compiler catalog / coverage
- Model Gateway server boundary

Downstream：

- F02 Validation
- F00 Clarification UX
- F06 Remix / Refine
- F07 Evidence
- F12 Recovery
- F16 Correction

# 35. Release / Migration

Phase 1：

~~~text
Prompt A
+ deterministic Clarification Policy
+ Prompt B
+ one production Model Gateway adapter
+ API v1
+ F04 coverage
+ mandatory F02 validation
~~~

Version fields：

~~~text
prompt_version
envelope_version
policy_version
schema_version
registry_version
model_adapter
evaluation_fixture_version
api_version
~~~

# 36. Open Decisions

目前沒有阻擋 F00 / F05 / F06 Detailed Design 的 architecture-level open decision。

後續：

已閉合：

- F00 Clarification / assumption UX已建立。
- Idempotency persistence = DATA-MODEL idempotency_operation / PostgreSQL / 24h。
- Retention = DATA-MODEL + F07 shared privacy matrix。
- F12 recovery contract已建立。
- F06/F16 source context已建立。
- Shared API conventions已進 Gate Closure，F01不再作跨 Function owner。

仍可迭代：Model provider selection可 A/B，但不改 public contract。

# Conclusion

F01 Current Truth：

~~~text
Natural Language Intent
→ Prompt A extracts meaning / unknowns
→ deterministic Clarification Policy
→ User resolves material uncertainty
→ Resolved Intent
→ F04 Capability Coverage
→ Prompt B creates untrusted Blueprint Candidate
→ F02 validates / admits
→ validated immutable Blueprint
~~~

API lifecycle：

~~~text
POST /api/v1/intents
→ analyze / clarification decision

POST /api/v1/intents/{id}/answers
→ merge User truth / re-evaluate

POST /api/v1/intents/{id}/compile
→ coverage / compose / F02 validate
~~~

> LLM 負責理解與提案；appf2 Policy 負責決定資訊何時足夠；F02 負責決定 Blueprint 是否可以被信任執行。

---

## Closed Working Delta — F01 Creation Progress Checkpoint Contract

> 狀態：**WORKING_DELTA_CLOSED（2026-09-23） / STEP2_RECONCILED**
>
> 來源：S02 Create Workspace High-fi + O05 High-fi Step 1 + `SD-20260922-002`。
>
> STEP2 reconciliation：此 delta 已整合回 canonical F01 sections；Build Freeze直接讀整合後 Working truth。

### F01-DATA-009 — CREATE Compiler Checkpoint Plan v1

Phase 1 `intent_kind = CREATE` 使用固定、finite、ordered 的 F01 compiler checkpoint plan：

~~~text
F01-CREATE-CP-01  INTENT_ANALYZED
F01-CREATE-CP-02  POLICY_EVALUATED
F01-CREATE-CP-03  INTENT_RESOLVED
F01-CREATE-CP-04  CAPABILITY_COVERAGE_RESOLVED
F01-CREATE-CP-05  BLUEPRINT_COMPOSED
F01-CREATE-CP-06  BLUEPRINT_VALIDATED
~~~

Completion truth：

- `INTENT_ANALYZED`：有效 Structured Intent Envelope 已產生並通過 shape validation。
- `POLICY_EVALUATED`：appf2-owned Clarification Policy 至少完成一次 deterministic evaluation。
- `INTENT_RESOLVED`：所有 required / material unknown 已解決，material assumptions 已完成 User decision，Intent 真正進入 READY。
- `CAPABILITY_COVERAGE_RESOLVED`：F04 coverage result 已成立，且允許進 composition。
- `BLUEPRINT_COMPOSED`：已產生符合 Prompt B output contract 的 Blueprint Candidate；仍不代表可執行。
- `BLUEPRINT_VALIDATED`：F02 已 PASS；只有此時 F01 可宣告 VALIDATED。

Rules：

1. checkpoint completion 必須 monotonic；同一 progress operation 內完成後不得撤回。
2. checkpoint 只表示已完成 work milestone，不表示剩餘時間。
3. Provider latency、elapsed time、animation timer 不得推進 checkpoint。
4. validation-driven bounded recompose 不回退已完成 checkpoint；`BLUEPRINT_VALIDATED` 仍要等最終 F02 PASS。
5. F01 不擁有 Runtime hydration / APP_READY completion truth。

### F01-RQ-009 — Plan Freeze / Clarification Semantics

CREATE v1 的六個 F01 checkpoints 在 creation flow 開始時即固定；Clarification round 不新增或刪除 checkpoint，因此 denominator 不因「多問一輪」改變。

~~~text
ANALYZING
→ INTENT_ANALYZED
→ POLICY_EVALUATED
→ NEEDS_CLARIFICATION / READY_WITH_VISIBLE_ASSUMPTIONS
→ waiting for User
→ re-analyze / re-evaluate as needed
→ INTENT_RESOLVED only when READY
~~~

等待 User 時：

- processing 不繼續推進。
- completed checkpoint set 保持最後真實值。
- 不因等待時間增加百分比。
- 新 clarification round 不重置 plan。

若 User 明確修改 original Intent，使先前 semantic work 不再有效：

> 視為 **new logical creation progress operation**。

新 operation 重新建立 progress projection；不得沿用舊 operation 的 completed count 假裝接續。

### F01-API-005 — Creation Progress Projection

F01 對 F00 提供 machine-readable progress snapshot；O05 / S02 不可自行猜 checkpoint。

CREATE response 可包含：

~~~json
{
  "progress": {
    "plan_version": "f01-create-v1",
    "mode": "DETERMINATE",
    "planned_checkpoint_ids": [
      "F01-CREATE-CP-01",
      "F01-CREATE-CP-02",
      "F01-CREATE-CP-03",
      "F01-CREATE-CP-04",
      "F01-CREATE-CP-05",
      "F01-CREATE-CP-06"
    ],
    "completed_checkpoint_ids": [],
    "lifecycle_state": "ANALYZING",
    "waiting_for_user": false
  }
}
~~~

Contract：

- `POST /intents`、`POST /intents/{id}/answers`、`POST /intents/{id}/compile` 的 CREATE success response 應回目前 progress snapshot。
- Phase 1 **不因此新增 async polling / SSE / WebSocket**。
- request in-flight 時，F00只可維持最後已知 checkpoint truth + truthful current stage；不得估算中間完成度。
- response 一次完成多個 checkpoints 時，可以一次跳升多個真實 milestones。
- 非 CREATE intent_kind 不被本 Delta 強制套用此 plan；Refine / Remix / Correct 由各 host Function 自己擁有 cross-flow progress semantics。

### F01-RQ-010 — Retry / Cancel / Failure

Network retry：

- same Idempotency-Key + same body = same logical operation。
- 不重複完成 checkpoint。
- 不因 HTTP retry 增加 progress。

User-triggered retry after recoverable failure：

- 建立新的 logical **progress operation**；這不等於建立新的 API idempotency logical operation。
- 若 request body未變，mutation retry必須沿用原 Idempotency-Key，並由 Shared idempotency `FAILED_RETRYABLE / expired-IN_PROGRESS takeover`規則取得新 attempt。
- 可重新使用仍然有效的 durable Intent / Resolved Intent truth；`DO_NOT_PERSIST` ephemeral context若已消失，必須要求 User重新提供。
- accepted retry由失敗 lifecycle state直接進對應 work state（例如 COMPOSITION_FAILED / eligible VALIDATION_REJECTED → COMPOSING），不得先偽造 READY。
- completed checkpoints 必須從仍有效的 Function truth重新 derive，不得直接複製前一失敗 operation 的百分比。
- security/resource/incompatible terminal state沒有 direct same-body retry；User edit / compatibility change後是新的 logical mutation，必須使用新的 Idempotency-Key。

Cancel：

- current progress operation 結束。
- 未完成 checkpoints 永不因 Cancel 標 completed。
- preserved Intent / Blueprint semantics沿既有 F01/F00 contract。

Failure / timeout：

- progress 停在最後真實 completed set。
- 交 F12 / O03 recovery。
- 不把 failure 自動補成 100%。

### F01 / F00 / F03 Handoff Boundary

F01只擁有六個 compiler checkpoints。

S02 的「準備 App」與最終 100% 必須等 F03 hydration / APP_READY truth；F01 `VALIDATED` 不等於整個 App Ready。

Canonical ownership：

~~~text
F01 compiler checkpoints 1–6
→ F02 PASS / F01 VALIDATED
→ F00 keeps Create progress surface
→ F03 hydrate
→ F03 READY
→ F00 marks composite APP_READY checkpoint
→ 100%
~~~

### Evidence Impact

本 Delta **不新增 F01 Evidence Event ID**。

理由：

- 既有 `F01-EVT-002 intent_analysis_completed`
- `F01-EVT-007 resolved_intent_ready`
- `F01-EVT-008 capability_coverage_resolved`
- `F01-EVT-010 composition_succeeded`
- `F01-EVT-013 intent_validated`

已足以對應主要 lifecycle observability；progress projection 是 Function/API contract，不要求另建一套 telemetry event stream。

### F01 Acceptance Delta

新增：

- **F01-AC-025** CREATE v1 必須使用固定六 checkpoint plan；completed set 在同一 progress operation 內 monotonic。
- **F01-AC-026** Clarification / Assumption waiting 不改 denominator、不推進 progress；material Intent edit 必須開始新的 logical progress operation。
- **F01-AC-027** CREATE API success response 必須提供可驗證 progress snapshot；UI 不得依 elapsed time補進度。
- **F01-AC-028** network retry 不重複 checkpoint；User-triggered retry建立新 progress operation並只重建仍有效 truth。
- **F01-AC-029** validation-driven recompose 不回退 completed checkpoint；只有 F02 PASS 才完成 `BLUEPRINT_VALIDATED`。

### F01 Test Mapping Delta

~~~text
F01-AC-025 → TEST-F01-PROG-001 fixed create checkpoint plan + monotonic completion
F01-AC-026 → TEST-F01-PROG-002 clarification freeze + material edit new progress operation
F01-AC-027 → TEST-F01-PROG-003 API progress snapshot truth / no elapsed-time inflation
F01-AC-028 → TEST-F01-PROG-004 retry / idempotency checkpoint lifecycle
F01-AC-029 → TEST-F01-PROG-005 recompose monotonicity + validated only after F02 PASS
~~~

### Status

> **APPROVED WORKING CURRENT TRUTH — STEP2_RECONCILED / BUILD_FREEZE_READY**

