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

missing / ambiguity / assumption 共用欄位：

~~~text
id
semantic_role
description
source
required_for_execution
impact_level
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

impact_level：

~~~text
LOW
MEDIUM
HIGH
CRITICAL
~~~

Rules：

- USER_EXPLICIT 優先於其他來源。
- NFF_DEFAULT 必須帶 policy ID/version。
- LLM_PROPOSED 永遠只是 proposal。
- USER_ACCEPTED_PROPOSAL 表示 User 接受 proposal，不偽裝成原本 User 自己提出。

# 5. Known Input

## F01-DATA-002

~~~text
KnownInput
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

- User explicit value 不被 LLM 任意改 business meaning。
- formatting normalization 可以；semantic conversion 要明確。
- DO_NOT_PERSIST 只存在 request-scoped context。
- sensitive values 不進 telemetry。

# 6. Clarification Policy

Clarification Policy 是 deterministic appf2 code，不是 Prompt。

## F01-POL-CP-001
必要執行值缺失且沒有安全明確 default → NEEDS_CLARIFICATION。

## F01-POL-CP-002
有兩個以上合理 interpretation 且結果差異 HIGH / CRITICAL → NEEDS_CLARIFICATION。

## F01-POL-CP-003
涉及 money / permission / external cost / irreversible action，material rule 不是 USER_EXPLICIT → NEEDS_CLARIFICATION。

## F01-POL-CP-004
有安全可逆 default，但會影響 material outcome → READY_WITH_VISIBLE_ASSUMPTIONS。

## F01-POL-CP-005
只影響 cosmetic / presentation → READY。

## F01-POL-CP-006
資訊完整且無 material ambiguity → READY。

Precedence：

~~~text
CP-003
> CP-001
> CP-002
> CP-004
> CP-005
> CP-006
~~~

任一 NEEDS_CLARIFICATION rule 命中，overall decision 就是 NEEDS_CLARIFICATION。

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

Rules：

- answered question 不重問，除非 upstream fact 改變。
- 同分按 stable semantic item ID 排序。
- LLM 可協助把問題講人話，但不能決定 blocker priority。

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

UI 由 F00 決定。

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
- changed fact 可重新打開 downstream ambiguity。
- provenance 必須保留。
- re-evaluation 記 policy_version + triggered_rule_ids。

# 10. Visible Assumptions

## F01-DATA-004

~~~text
FACT
DEFAULT
PROPOSAL
UNKNOWN
~~~

READY_WITH_VISIBLE_ASSUMPTIONS 必須把 material DEFAULT / PROPOSAL 顯示給 User。

F00 必須能 edit / accept / reject。

accepted proposal 轉成 USER_ACCEPTED_PROPOSAL 後才能進 Resolved Intent。

# 11. Resolved Intent

## F01-DATA-005

~~~text
ResolvedIntent
├─ resolved_intent_version
├─ intent_id
├─ goal
├─ actors[]
├─ entities[]
├─ inputs[]
├─ constraints[]
├─ outputs[]
├─ rules[]
├─ accepted_assumptions[]
├─ unresolved_non_material_items[]
├─ capability_requirements[]
└─ provenance_map
~~~

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

F01 從 Resolved Intent 產生：

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
~~~

交 F04 resolveCapabilityCoverage。

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
6. Mark provenance / impact。
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
- answer provenance = USER_EXPLICIT。
- accepted proposal = USER_ACCEPTED_PROPOSAL。
- REJECT proposal 可重新產生 ambiguity。
- response 再回 NEEDS_CLARIFICATION / READY_WITH_VISIBLE_ASSUMPTIONS / READY。

# 21. API 3 — Compile to Validated Blueprint

## F01-API-003

~~~text
POST /api/v1/intents/{intent_id}/compile
~~~

Preconditions：

~~~text
intent.status = READY
resolved_intent exists
coverage = FULLY_SUPPORTED
or allowed PARTIALLY_SUPPORTED
~~~

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
    "registry_version": "1.0.0",
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

- retry 不 duplicate intent / compiler run。
- compile retry 若 logical operation 已成功，直接回同 logical result。
- key 不跨 anonymous identity reuse。
- same key + same body + IN_PROGRESS → 409 IDEMPOTENCY_IN_PROGRESS。
- same key + different body → 409 IDEMPOTENCY_CONFLICT。
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

Minimum dimensions：

~~~text
intent_id
intent_kind
policy_version
triggered_rule_ids
prompt_version
schema_version
registry_version
model_adapter
attempt_no
latency_ms
token_usage / estimated_cost
coverage_status
error_code
trace_id
~~~

Raw Intent / raw model response 不進 telemetry by default。

compiler_run 支援 cost_per_successful_intent 的計算。

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

User-triggered retry after terminal/recoverable failure：

- 建立新的 logical progress operation。
- 可重新使用仍然有效的 durable Intent / Resolved Intent truth。
- completed checkpoints 必須從仍有效的 Function truth重新 derive，不得直接複製前一失敗 operation 的百分比。

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

