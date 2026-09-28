# appf2 Data Model — Detailed Design

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：Working Current Truth — consolidated multi-phase detailed owner。
>
> Phase 1 section = BUILD_FREEZE_READY candidate；Phase 2 / 3 / 4+ sections = DEFERRED baseline。Future sections 同檔存在不代表 implementation activation。

# appf2 Data Model — Phase 1 Detailed Contract

> Shared invariants / module index：`../../common-core/DATA-MODEL.md`
>
> Status：BUILD_FREEZE_READY / STEP2_REVIEWED / Phase 1 Current Truth。Phase 2+ additions 只能存在於本檔明確標示的 deferred sections，不得污染 Phase 1 contract或自動進 Build Freeze。

# 3. Phase 1 Data Zones

| Zone | Canonical location | Phase 1 | 說明 |
|---|---|---:|---|
| Durable Artifact | PostgreSQL | YES | Blueprint、lineage、share |
| Durable Evidence | PostgreSQL | YES | compiler / validation / product / correction evidence |
| Runtime Instance | Browser memory | YES | 正常 deterministic interaction |
| Local Recovery | Browser storage | YES | 未送出 input、partial progress、recovery context |
| Account / Ownership | PostgreSQL | NO | F08 後啟用 |
| Realtime Room State | Realtime provider / durable policy | NO | F09 evidence-gated |
| Vector / Embedding | PostgreSQL + pgvector first | NO | F10 evidence-gated |
| Large Media | Object storage | NO | 有真實需求再啟用 |
| Workflow State | Durable orchestration store | NO | F17 長期 |

---

# 4. Identity and Key Rules

## 4.1 Internal IDs

一般 durable entity 使用 UUID。

~~~text
anonymous_id
intent_id
compiler_run_id
validation_run_id
share_id
result_snapshot_id
correction_id
event_id
~~~

要求：

- opaque；
- 不含 user / business meaning；
- 不使用自增 ID 作 public identifier；
- API 不依賴 DB row order。

## 4.2 Blueprint Identity

Blueprint 以 canonical content 的：

~~~text
content_hash
~~~

作 immutable identity。

Hash algorithm / canonical JSON serialization 規則由 Executable Blueprint Contract 定義；Data Model 只要求：

> 相同 canonical Blueprint content 必須得到相同 content_hash；任何 semantic content change 必須產生不同 identity。

## 4.3 Time

所有 durable timestamp 使用 UTC `timestamptz`。

---

# 5. Canonical Entity Map

~~~mermaid
erDiagram
    ANONYMOUS_IDENTITY ||--o{ INTENT_RECORD : creates
    ANONYMOUS_IDENTITY ||--o{ SHARE : creates
    ANONYMOUS_IDENTITY ||--o{ PRODUCT_EVENT : emits

    INTENT_RECORD ||--o{ COMPILER_RUN : has
    COMPILER_RUN ||--o{ VALIDATION_RUN : produces

    BLUEPRINT_CONTENT ||--o{ VALIDATION_RUN : validated_as
    BLUEPRINT_CONTENT ||--o{ BLUEPRINT_LINEAGE : parent
    BLUEPRINT_CONTENT ||--o{ BLUEPRINT_LINEAGE : child
    BLUEPRINT_CONTENT ||--o{ SHARE : shared_as
    BLUEPRINT_CONTENT ||--o{ RESULT_SNAPSHOT : executes

    RESULT_SNAPSHOT ||--o{ CORRECTION_RECORD : before
    CORRECTION_RECORD }o--|| BLUEPRINT_CONTENT : base
    CORRECTION_RECORD }o--o| BLUEPRINT_CONTENT : new_version
    CORRECTION_RECORD }o--o| RESULT_SNAPSHOT : after
~~~

注意：

- `Instance` 不在 Phase 1 DB ERD，因為 normal runtime state 在 Browser。
- `Context` 不在 Phase 1 建 durable cross-app store。
- `Capability Registry` 是 versioned build artifact，不是 Phase 1 DB table。

---

# 6. Phase 1 Canonical Tables

## 6.1 anonymous_identity

目的：

> 提供 No-login continuity 與 Evidence linkage，不做 fingerprinting。

| Field | Type | Required | Rule |
|---|---|---:|---|
| anonymous_id | uuid | YES | PK；first-party random opaque ID |
| created_at | timestamptz | YES | server time |
| last_seen_at | timestamptz | YES | bounded update |
| status | text | YES | ACTIVE / ROTATED / DISABLED |
| created_source | text | YES | WEB_PHASE1 |

規則：

- 不保存 fingerprint。
- Browser 可保存 anonymous_id；server 以同一 ID 連結 meaningful events。
- Phase 1 不建立 account ownership 欄位；F08 以 migration / mapping table 加入，不污染 Blueprint。

---

## 6.2 intent_record

目的：

> 保存一個 creation / refinement / correction semantic request 的 durable identity 與 lifecycle；F01 定義其中 JSON payload 的正式 schema。

| Field | Type | Required | Rule |
|---|---|---:|---|
| intent_id | uuid | YES | PK |
| anonymous_id | uuid | YES | FK → anonymous_identity |
| intent_kind | text | YES | CREATE / REFINE / REMIX / CORRECT |
| raw_intent | text | CONDITIONAL | User content；依 privacy / retention policy |
| structured_intent | jsonb | NO | Prompt A output；schema owned by F01 |
| resolved_intent | jsonb | NO | Clarification Gate 通過後的 semantic truth |
| lifecycle_status | text | YES | RECEIVED / ANALYZING / NEEDS_CLARIFICATION / READY_WITH_VISIBLE_ASSUMPTIONS / READY / COMPOSING / VALIDATING / VALIDATED / ANALYSIS_FAILED / COMPOSITION_FAILED / VALIDATION_REJECTED / INCOMPATIBLE / CANCELLED |
| intent_version | int | YES | optimistic concurrency token；starts at 1 |
| source_blueprint_hash | text | NO | refine/remix/correct base |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | lifecycle metadata 可更新 |
| expires_at | timestamptz | NO | raw_intent value retention deadline |

規則：

1. `raw_intent` 是 user content，不得複製到 telemetry。
2. `structured_intent` / `resolved_intent` 是 semantic records，不是 Blueprint。
3. Resolved Intent 通過 F01 policy 後才能交給 Blueprint Composer。
4. exact payload schema、provenance、assumption fields 由 F01 定義。
5. correction / refine 使用新的 `intent_record`，不覆蓋原 Intent。
6. `intent_version` 每次成功修改 lifecycle / structured intent / clarification answers / assumptions / resolved intent 時 +1；stale write 必須失敗，不以 `updated_at` 猜版本。
7. `lifecycle_status` 是 Intent durable lifecycle truth；compiler_run / validation_run 保存 operation detail，不再建立第二個 clarification status truth。
8. `expires_at` 只控制 `raw_intent` value retention；到期後將 `raw_intent` 設為 NULL，intent identity / structured / resolved semantic record仍可保留。

---

## 6.3 compiler_run

目的：

> 記錄每次 Semantic Compiler / Model Gateway 執行，支援 replay、cost、failure、debug evidence。

| Field | Type | Required | Rule |
|---|---|---:|---|
| compiler_run_id | uuid | YES | PK |
| intent_id | uuid | YES | FK → intent_record |
| stage | text | YES | INTENT_ANALYSIS / BLUEPRINT_COMPOSE |
| status | text | YES | STARTED / SUCCEEDED / FAILED / TIMED_OUT |
| prompt_version | text | YES | versioned prompt |
| schema_version | text | YES | target contract version |
| registry_version | text | YES | capability snapshot |
| model_adapter | text | YES | appf2 adapter ID |
| provider_model | text | NO | operational metadata；不進 Blueprint |
| attempt_no | int | YES | >= 1 |
| started_at | timestamptz | YES | |
| finished_at | timestamptz | NO | |
| latency_ms | int | NO | |
| input_tokens | int | NO | provider support dependent |
| output_tokens | int | NO | provider support dependent |
| estimated_cost | numeric | NO | optional economics evidence |
| failure_code | text | NO | stable F01 error code |
| trace_id | text | YES | request tracing |

規則：

- 不要求永久保存完整 model raw response。
- 若為 debug 短期保存，必須走 bounded retention / redaction policy。
- provider config / secret 不得進此表。

---

## 6.4 validation_run

目的：

> 記錄 F02 Trust Admission 結果；invalid candidate 絕不因被記錄而變成可執行 Blueprint。

| Field | Type | Required | Rule |
|---|---|---:|---|
| validation_run_id | uuid | YES | PK |
| compiler_run_id | uuid | NO | FK；restore/import validation 可無 compiler run |
| candidate_digest | text | YES | candidate identity / digest |
| blueprint_hash | text | NO | 只有成功 admission 才可指向 durable validated content |
| schema_version | text | YES | |
| registry_version | text | YES | |
| status | text | YES | PASSED / REJECTED / INCOMPATIBLE |
| error_codes | jsonb | NO | stable F02 error IDs array |
| report | jsonb | NO | bounded validation metadata，不存 arbitrary secrets |
| created_at | timestamptz | YES | |
| trace_id | text | YES | |

規則：

- `PASSED` 才能形成 / 引用 `blueprint_content`。
- REJECTED candidate body 不預設 durable 保存；只留必要 digest / error evidence。
- validation report 的正式 shape 由 F02 定義。

---

## 6.5 blueprint_content

目的：

> appf2 validated App definition 的 immutable durable truth。

| Field | Type | Required | Rule |
|---|---|---:|---|
| content_hash | text | YES | PK；immutable identity |
| canonical_blueprint | jsonb | YES | validated canonical content |
| schema_version | text | YES | LegoSpec version |
| registry_version | text | YES | capability registry snapshot |
| trust_status | text | YES | VALIDATED / REVOKED / INCOMPATIBLE |
| created_at | timestamptz | YES | |
| admitted_by_validation_run_id | uuid | YES | FK → validation_run |
| byte_size | int | YES | resource / delivery evidence |

Immutable fields：

~~~text
content_hash
canonical_blueprint
schema_version
registry_version
created_at
admitted_by_validation_run_id
~~~

`trust_status` 可因 security / compatibility revocation 改變，但不能修改 Blueprint body。

規則：

- Candidate 不直接進此表。
- Runtime 只執行可接受 trust / compatibility 狀態。
- Blueprint body 不保存 ownership / creator profile / live Instance state。
- Blueprint 中可 serialization 的 config / initial state 由 Capability Contract + F02 決定。

---

## 6.6 blueprint_lineage

目的：

> 描述 immutable Blueprint 之間的衍生關係，而不是直接修改 parent。

| Field | Type | Required | Rule |
|---|---|---:|---|
| lineage_id | uuid | YES | PK |
| parent_hash | text | YES | FK → blueprint_content |
| child_hash | text | YES | FK → blueprint_content |
| relation_type | text | YES | REFINE / REMIX / CORRECT |
| intent_id | uuid | NO | 造成衍生的 semantic request |
| created_by_anonymous_id | uuid | NO | Phase 1 attribution / evidence |
| created_at | timestamptz | YES | |

Constraints：

- parent_hash != child_hash。
- `(parent_hash, child_hash, relation_type)` unique。
- 不允許 update lineage edge；錯誤 edge 以 governance / corrective record 處理，不改 Blueprint content。

Phase 1 revision semantics：

> Revision 是 lineage 上的新 immutable Blueprint，不建立可被原地覆寫的 `blueprint_revision.body`。

F08 / F10 若需要 Blueprint family / ownership，可新增 metadata layer，不改此 contract。

---

## 6.7 share

目的：

> Durable Share Reference 的 truth；Portable URL Fragment 不一定需要 DB row。

| Field | Type | Required | Rule |
|---|---|---:|---|
| share_id | uuid / opaque ID | YES | PK / public opaque ID |
| blueprint_hash | text | YES | FK → blueprint_content |
| created_by_anonymous_id | uuid | NO | |
| share_mode | text | YES | DURABLE_REFERENCE / PORTABLE_METADATA |
| status | text | YES | ACTIVE / REVOKED / EXPIRED |
| created_at | timestamptz | YES | |
| expires_at | timestamptz | NO | policy-defined |
| last_opened_at | timestamptz | NO | optional bounded update |

規則：

1. F05 決定 Phase 1 default share mode；Data Model 不提前替 F05 做產品決策。
2. sensitive runtime state 不預設塞進 share row / URL。
3. Share 指向 Blueprint；若未來分享 Instance snapshot，必須是另一個 explicit contract。
4. Public share ID 不使用可枚舉 sequence。

---

## 6.8 result_snapshot

目的：

> 支援 F16「結果不對」時保留 before / after、比較與回退；不代表每次 Runtime 都要存結果。

| Field | Type | Required | Rule |
|---|---|---:|---|
| result_snapshot_id | uuid | YES | PK |
| blueprint_hash | text | YES | FK → blueprint_content |
| anonymous_id | uuid | NO | |
| input_snapshot | jsonb | YES | correction 所需最小 inputs |
| output_snapshot | jsonb | YES | user-visible / semantic result |
| runtime_metadata | jsonb | NO | deterministic execution context |
| created_at | timestamptz | YES | |
| expires_at | timestamptz | YES | value-bearing snapshot payload retention deadline；Phase 1 = created_at + 30 days |
| redacted_at | timestamptz | NO | payload values redacted time |

規則：

- 預設只在 correction / explicit compare / product-required flow 建 durable snapshot。
- 不保存整個 React tree / component internals。
- F03 / F16 定義 input/output snapshot 的正式 contract。
- 敏感 fields 必須依 Capability / F07 policy redact 或禁止 durable persistence。
- Snapshot value-bearing payload Phase 1 最長保存 30 days；到期後 input/output value 必須 redacted，只保留 correction chain 所需的 field identity / type / sensitivity / blueprint / comparison metadata。
- `result_snapshot` row 可在 value redaction 後保留作 correction lineage evidence；不得以此 row 當可信 server execution proof。

---

## 6.9 correction_record

目的：

> 保存 F16 semantic mismatch → correction → compare / accept / revert 的 durable chain。

| Field | Type | Required | Rule |
|---|---|---:|---|
| correction_id | uuid | YES | PK |
| anonymous_id | uuid | NO | |
| base_blueprint_hash | text | YES | FK → blueprint_content |
| before_result_snapshot_id | uuid | YES | FK → result_snapshot |
| correction_intent_id | uuid | YES | FK → intent_record；intent_kind = CORRECT |
| semantic_delta | jsonb | NO | controlled delta；schema owned by F16/F01 |
| new_blueprint_hash | text | NO | correction compile success 後 |
| after_result_snapshot_id | uuid | NO | rerun success 後 |
| outcome | text | YES | REQUESTED / GENERATED / ACCEPTED / REJECTED / REVERTED / FAILED |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | lifecycle metadata |

規則：

- 原 Blueprint 永遠不被 mutation。
- FAILED correction 不影響 base Blueprint 可用性。
- ACCEPT / REVERT 改的是 correction outcome / user selection，不改兩個 Blueprint body。
- lineage relation = CORRECT 由成功 new Blueprint 建立。

---

## 6.10 product_event

目的：

> 保存 meaningful Evidence；不是 raw interaction firehose。

| Field | Type | Required | Rule |
|---|---|---:|---|
| event_id | uuid | YES | PK |
| event_type | text | YES | Fxx-EVT-* catalog 定義 |
| occurred_at | timestamptz | YES | client occurrence time |
| received_at | timestamptz | YES | server intake time |
| anonymous_id | uuid | NO | |
| session_id | text | NO | client session opaque ID |
| function_id | text | YES | F00 / F01 / ... |
| intent_id | uuid | NO | |
| blueprint_hash | text | NO | |
| share_id | uuid | NO | |
| capability_id | text | NO | |
| error_code | text | NO | |
| policy_rule_id | text | NO | |
| trace_id | text | NO | |
| properties | jsonb | NO | bounded, allowlisted properties |
| schema_version | text | YES | event schema version |

規則：

- 不記每次 render / click / timer tick。
- `properties` 不得成為任意 user-content dump。
- F07 定義 batching、retry、dedupe、event catalog、retention。
- Function-specific evidence 必須用 stable Event ID / event_type。

---

## 6.11 idempotency_operation

目的：

> 為 Phase 1 mutation API 提供跨 retry / duplicate submit 的 durable logical-operation truth；不用 Edge KV 當 source of truth。

| Field | Type | Required | Rule |
|---|---|---:|---|
| idempotency_operation_id | uuid | YES | PK |
| anonymous_id | uuid | YES | request identity scope |
| route_key | text | YES | normalized mutation route / operation class |
| idempotency_key | text | YES | client-generated opaque key |
| request_digest | text | YES | canonical request payload digest |
| status | text | YES | IN_PROGRESS / SUCCEEDED / FAILED_TERMINAL |
| result_ref_type | text | NO | INTENT / SHARE / CORRECTION / OTHER |
| result_ref_id | text | NO | logical result identity |
| http_status | int | NO | terminal response status |
| error_code | text | NO | terminal stable error code |
| created_at | timestamptz | YES | |
| updated_at | timestamptz | YES | |
| expires_at | timestamptz | YES | created_at + 24 hours |

Constraints：

~~~text
unique(anonymous_id, route_key, idempotency_key)
~~~

Rules：

1. same key + same request_digest + SUCCEEDED → return same logical result，不重做 side effect。
2. same key + same request_digest + IN_PROGRESS → 409 IDEMPOTENCY_IN_PROGRESS，retryable=true。
3. same key + different request_digest → 409 IDEMPOTENCY_CONFLICT。
4. FAILED_TERMINAL 可重放同 terminal outcome；retryable transient failure不應先鎖成 FAILED_TERMINAL。
5. cleanup 可在 expires_at 後刪除；24h idempotency window之外的 request視為新的 logical operation。
6. 不保存完整 raw request / raw user content，只保存 digest與 bounded logical result reference。
7. Phase 1 canonical persistence = PostgreSQL；Edge cache可以加速但不是 truth。

---

# 7. Browser-only Phase 1 Structures

這些是 canonical conceptual models，但 Phase 1 預設不建 durable table。

## 7.1 Runtime Instance

~~~text
Instance
- blueprint_hash
- instance_id (local/session scoped)
- current_state
- input_state
- derived_state
- runtime_status
- local_started_at
~~~

規則：

- Browser memory 為 normal runtime truth。
- state transition 不逐次寫 DB。
- refresh / local recovery 是否保存 subset，由 F03/F00 定義。
- Instance mutation 永遠不等於 Blueprint revision。

## 7.2 Recovery Context

~~~text
RecoveryContext
- raw / resolved intent reference
- unsent user input
- current blueprint_hash
- relevant instance input
- failed_stage
- recovery_action context
~~~

Phase 1 優先存 Browser local recovery storage。

只有需要跨 request / durable correction 時，才把必要部分寫入上面的 canonical durable entities。

## 7.3 Context

Approved cross-App Context 是長期概念。

Phase 1：

> 不建立 generic durable Context store。

若某 Function 必須 persistence，必須先定義 explicit data contract，不能丟進 generic JSON bucket。

---

# 8. Relationship and Lifecycle Rules

## 8.1 Create

~~~text
anonymous_identity
→ intent_record(CREATE)
→ compiler_run(INTENT_ANALYSIS)
→ resolved_intent
→ compiler_run(BLUEPRINT_COMPOSE)
→ validation_run(PASSED)
→ blueprint_content
→ Browser Instance
~~~

## 8.2 Share / Open

~~~text
blueprint_content
→ share
→ recipient open
→ resolve blueprint_hash
→ trust / compatibility check
→ Browser Instance
~~~

Open 不重新 Compile。

## 8.3 Remix / Refine

~~~text
parent blueprint
→ intent_record(REMIX / REFINE)
→ compile
→ validate
→ child blueprint
→ blueprint_lineage
~~~

## 8.4 Result Correction

~~~text
base blueprint
+ result_snapshot(before)
→ intent_record(CORRECT)
→ correction_record
→ semantic delta
→ compile / validate
→ new blueprint
→ lineage(CORRECT)
→ result_snapshot(after)
→ ACCEPT / REJECT / REVERT
~~~

---

# 9. Mutable vs Immutable Matrix

| Data | Mutable? | Why |
|---|---:|---|
| anonymous_identity lifecycle metadata | YES | continuity |
| raw / structured / resolved intent lifecycle | LIMITED | clarification progresses |
| compiler_run | APPEND / finalize only | audit / evidence |
| validation_run | APPEND / finalize only | trust evidence |
| blueprint_content body | NO | immutable artifact |
| blueprint trust_status | YES | revoke / compatibility governance |
| blueprint_lineage | NO | historical relation |
| share status / last_opened_at | YES | lifecycle |
| result_snapshot | VALUE-REDACTABLE | 30-day value retention後可 redact values；row可保留 lineage evidence |
| correction_record outcome | LIMITED | workflow lifecycle |
| product_event | NO | append-only evidence |
| Browser Instance | YES | local runtime state |

---

# 10. Minimum Referential Integrity

Required FK / logical references：

~~~text
intent_record.anonymous_id
→ anonymous_identity.anonymous_id

compiler_run.intent_id
→ intent_record.intent_id

validation_run.compiler_run_id
→ compiler_run.compiler_run_id (nullable)

blueprint_content.admitted_by_validation_run_id
→ validation_run.validation_run_id

blueprint_lineage.parent_hash / child_hash
→ blueprint_content.content_hash

share.blueprint_hash
→ blueprint_content.content_hash

result_snapshot.blueprint_hash
→ blueprint_content.content_hash

correction_record.base_blueprint_hash / new_blueprint_hash
→ blueprint_content.content_hash

correction_record.before / after snapshot
→ result_snapshot

correction_record.correction_intent_id
→ intent_record
~~~

Deletion policy：

> Phase 1 不做 cascade delete durable artifact / lineage / evidence truth。

Privacy-driven deletion / anonymization 必須走 explicit policy，不靠 accidental FK cascade。

---

# 11. Index Baseline

Phase 1 最低建議 indexes：

~~~text
intent_record(anonymous_id, created_at)
compiler_run(intent_id, started_at)
compiler_run(trace_id)
validation_run(compiler_run_id)
validation_run(status, created_at)

blueprint_content(content_hash) PK
blueprint_content(created_at)
blueprint_content(schema_version, registry_version, trust_status)

blueprint_lineage(parent_hash)
blueprint_lineage(child_hash)
blueprint_lineage(relation_type, created_at)

share(share_id) PK
share(blueprint_hash)
share(status, created_at)

result_snapshot(blueprint_hash, created_at)

correction_record(base_blueprint_hash, created_at)
correction_record(new_blueprint_hash)

product_event(function_id, occurred_at)
product_event(anonymous_id, occurred_at)
product_event(blueprint_hash, occurred_at)
product_event(event_type, occurred_at)
product_event(trace_id)
~~~

不要 Phase 1 為未證明 access pattern 建大量 indexes。

---

# 12. JSONB Boundary

JSONB 適合：

- structured_intent；
- resolved_intent；
- canonical_blueprint；
- validation report；
- result input/output snapshot；
- semantic_delta；
- bounded event properties。

Relational columns 必須保留：

- identity；
- lifecycle status；
- timestamps；
- lineage；
- foreign keys；
- schema / registry version；
- trust；
- traceability；
-主要查詢 / filter dimensions。

規則：

> 不能把整個 Database 退化成「一張 table + 任意 JSON」。

---

# 13. Privacy / Sensitive Data Boundary

## 13.1 Classification

最低分類：

~~~text
PUBLIC_ARTIFACT
PRODUCT_INTERNAL
USER_CONTENT
SENSITIVE_USER_CONTENT
OPERATIONAL_METADATA
~~~

預設：

- raw_intent = USER_CONTENT；
- result snapshot = USER_CONTENT，視 capability 可能升級為 SENSITIVE_USER_CONTENT；
- canonical Blueprint = PRODUCT_INTERNAL 或 PUBLIC_ARTIFACT，取決於 share/publish；
- telemetry = OPERATIONAL_METADATA；
- secrets / provider credentials = 禁止進以上 product tables。

## 13.2 Required Guardrails

1. raw Intent 不自動複製到 product_event。
2. Result Snapshot 不自動進 telemetry。
3. event `properties` 必須 allowlist。
4. sensitive fields 不進 portable share URL。
5. debug raw payload 若保存，必須有 bounded retention。
6. provider secrets 不進 Browser / Blueprint / telemetry / DB product JSON。
7. Phase 1 retention durations以 F07 shared privacy matrix為 canonical policy；Function可引用但不得另寫不同數字。
8. raw_intent value retention = 30 days after terminal Intent state；到期設 NULL。
9. result_snapshot value-bearing payload retention = 30 days；到期 redact values。
10. Browser local prompt / clarification / correction / recovery draft TTL = 7 days；SENSITIVE / DO_NOT_PERSIST不進 local durable draft。
11. debug raw provider/request payload若明確啟用，maximum retention = 7 days，且 access-controlled。

---

# 14. Repository Boundaries

Application code 不直接把 Supabase API 當 domain contract。

最低 appf2-owned interfaces：

~~~text
AnonymousIdentityRepository
IntentRepository
CompilerRunRepository
ValidationRepository
BlueprintRepository
LineageRepository
ShareRepository
CorrectionRepository
EvidenceRepository
IdempotencyRepository
~~~

Phase 1 可由 Supabase/Postgres adapter 實作。

未來換 DB / service，不改 Blueprint / Function semantics。

---

# 15. Phase 1 Non-Scope

目前明確不建立：

- dedicated Vector DB；
- generic embedding table；
- analytics warehouse；
- realtime state history；
- every-click event store；
- Account / Ownership tables；
- Creator profile；
- Entitlement / Transaction tables；
- large media blob table；
- workflow / queue state machine；
- generic cross-app Context store。

---

# 16. Ownership of Detailed Schemas

本文件定義 shared identity / storage / relation。

以下由 Function 定義詳細 payload：

| Contract | Canonical Owner |
|---|---|
| Structured / Resolved Intent JSON | F01 |
| LegoSpec / Blueprint JSON | F02 + Blueprint Contract |
| Runtime Instance state shape | F03 |
| Capability Card / Registry artifact | F04 |
| Share request / restore payload | F05 |
| Semantic Delta for Remix | F06 |
| Evidence event catalog / batching / retention | F07 |
| Humanized Recovery state | F12 |
| Result Snapshot semantic fields / Correction Intent / Delta | F16 |

Function 可以增加自己的欄位 / table proposal，但若跨 Function 共用或改變 durable truth，必須先回到本文 Review，不能自行建立第二份 data truth。

---

# 17. Build Freeze Handoff Constraints

當 Phase 1 Data contract 被 Human-approved Build Freeze 納入時，frozen implementation truth 必須保留：

1. canonical table / relation semantics；
2. Browser Instance 不變成 server-write-every-click；
3. Phase 1 不引入 Dedicated Vector DB；
4. Capability Registry 不變成 Phase 1 dynamic DB service；
5. Blueprint immutable model 不被修改；
6. lineage / evidence 不被 destructive cascade delete破壞；
7. relational identity 不被 arbitrary JSON 取代；
8. schema change 必須保留 migration / rollback or forward-fix safety；
9. schema change 可 trace 回 DATA / Function requirement；
10. 若 frozen Function truth 與 shared data invariant 衝突，必須回 appf2-design Review / Rebaseline。

Migration tool、SQL layout、test placement與 execution procedure由 appf2-build決定。

# 18. Canonical Data Acceptance

以下是 Shared Data Model 的 observable Product truth；stable mapping由 `working/detailed-design/registries/acceptance-test-registry.json` 與相關 Fxx Acceptance承接，test implementation由 appf2-build擁有。

1. 同一 validated Blueprint content 只能有一份 canonical durable body。
2. Blueprint body 不可原地 mutation。
3. Remix / Refine / Correct 產生新 Blueprint identity 並保留 lineage。
4. Runtime Instance change 不建立 Blueprint revision。
5. Normal Browser interaction 不逐次寫 PostgreSQL。
6. Invalid Blueprint candidate 不得成為 executable `blueprint_content`。
7. Share 可解析到 immutable Blueprint，而不依賴 current Browser memory。
8. F16 correction failure 不破壞 base Blueprint。
9. Product Event 不要求保存 raw user content。
10. Phase 1 無 Dedicated Vector DB dependency。
11. 未來 Vector index 不取代 PostgreSQL durable truth。
12. Account / Realtime / Commerce 擴張不得要求改寫 immutable Blueprint core。

# 19. Function-owned Detail / Deferred Decisions

以下 detail 由 Function canonical owner 管理，**不是 Phase 1 shared Data blocker，也不得在本文複製第二份 schema truth**：

- F01：Structured Intent / Resolved Intent exact JSON schema。
- F02：canonical JSON serialization、content hash algorithm/version、trust compatibility。
- F03：Instance / Result serialization subset。
- F07：anonymous identity issuance、event batching與 evidence ingestion detail。
- F16：Correction Delta / snapshot semantics。

Future deferred：
- F05 authenticated share expiry / revocation self-service UX 依 F08 ownership activation再設計。

Shared decisions已閉合：
- Intent durable lifecycle + `intent_version`：本文 §6.2。
- Mutation idempotency persistence：本文 §6.11，PostgreSQL，24h。
- raw_intent / result_snapshot / Browser draft retention：本文 §13 + F07 privacy matrix。

> Function-owned detail若改變跨 Function durable invariant，仍必須回本文 Review；不得由 appf2-build自行發明。

# Conclusion

Phase 1 的 Data Model 核心很簡單：

~~~text
Anonymous Identity
→ Intent / Compile / Validate
→ Immutable Blueprint
→ Lineage
→ Share
→ Result Correction
→ Meaningful Evidence
~~~

大量互動仍留在 Browser。

未來 Reuse / Identity / Realtime / Commerce / Vector 都是在這個 durable truth 上加 metadata / execution layer，而不是推翻 Blueprint 或另建第二套資料真相。

> **PostgreSQL 保存 durable truth；Browser 保存 ephemeral runtime；Vector 只做 retrieval index。**


---
