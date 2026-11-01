# F07 — Anonymous Identity & Evidence

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Anonymous Identity continuity、Session identity、Evidence Envelope、Event Ingestion、Batch / Retry / Dedupe、Privacy / Retention 與 Core Proof Metrics 的 Working Current Truth。
>
> 上游：DATA-MODEL、BUSINESS-PLAN、F00–F06 Function contracts、DESIGN-TO-DELIVERY。
>
> 下游 / collaborators：F08 Durable Identity、F10 Reuse、F12 Recovery、F16 Result Correction，以及所有需要 Product Evidence 的 Function。
>
> F07 的目的不是建立 telemetry firehose，而是在不要求註冊、不 fingerprint、不複製 raw user content 的前提下，讓 appf2 能回答：「核心循環有沒有成立？哪裡失敗？值不值得進下一 Phase？」

# 1. Purpose / User Outcome

User Outcome：

> User 不需要先登入，也能在同一 Browser 持續建立、分享、Remix；同時 appf2 能用最少必要 Evidence 判斷產品是否真的有用，而不是只知道頁面有沒有打開。

Phase 1 Evidence 必須回答：

~~~text
Intent 是否成功變成可用 App？
花多久得到 First Useful App？
Runtime 成功後是否仍有 Semantic Mismatch？
Recovery 是否真的把 User 救回來？
User 是否會 Share？
Recipient 是否真的 Restore + Use？
Recipient 是否 Remix？
Anonymous User 是否會回來？
每個 Successful Intent 成本是多少？
~~~

# 2. Scope / Non-Scope

F07 Phase 1 負責：

- anonymous_id generation / storage / lifecycle
- session_id semantics
- no-fingerprinting rule
- server identity ensure / bounded last_seen
- common Evidence Event Envelope
- event schema versioning
- event catalog ownership
- evidence source precedence
- meaningful-event collection policy
- browser event buffer
- batch ingestion API
- retry / offline queue
- network retry dedupe
- semantic dedupe
- event validation
- property allowlist / payload bounds
- retention / privacy
- Core Proof metrics
- Evidence pipeline quality metrics
- errors / acceptance / tests

F07 不做：

- account authentication
- durable ownership
- authorization based on anonymous_id
- browser fingerprinting
- cross-site tracking
- session replay / screen recording
- every-click analytics
- every-render / timer-tick telemetry
- raw Prompt warehouse
- raw Result warehouse
- analytics warehouse in Phase 1
- vector / embedding analytics

# 3. Identity Model

Phase 1：

~~~text
anonymous_id
= Browser continuity correlation

session_id
= browser-session evidence context

durable user_id
= NOT Phase 1; F08 only
~~~

重要：

> anonymous_id 不是登入憑證、不是 ownership proof、不是 authorization token。

# 4. Anonymous ID Generation

## F07-RQ-001

Browser 第一次需要 appf2 identity 時：

~~~text
crypto.randomUUID()
→ anonymous_id
→ first-party browser storage
~~~

Canonical browser key：

~~~text
appf2.anonymous_id.v1
~~~

Rules：

1. UUID v4 / Web Crypto quality random。
2. 不由 email、IP、User-Agent、timezone、canvas、device traits衍生。
3. Browser storage缺失時建立新 ID。
4. User清除 site data後建立新 identity；不得 fingerprint 找回舊 ID。
5. Client只把 anonymous_id當 correlation identifier。
6. Server不可用 anonymous_id授權敏感 action。
7. F08 account claim前，不把 anonymous identity描述成 durable ownership。
8. Function可以用 trusted request context中的 anonymous_id做 continuity equality / idempotency scope（例如 F01 intent mutation只允許同 anonymous_id continuity）；這種 equality gate不是 authentication或 ownership proof。
9. 對 opaque resource做 continuity mismatch時，Function應使用自身 not-found/non-disclosure contract，不得因 anonymous_id mismatch洩漏另一 anonymous identity的資源是否存在。

### F07-SEC-003 — Anonymous continuity ≠ F01 mutation authority (PG001 L2 review delta)

F07-RQ-001 `anonymous_id` 只識別 browser continuity/correlation，與伺服器接受某個 private Intent mutation 的授權無關。F01 的 per-logical CREATE WebCrypto P-256 proof、意圖 scoped continuity cookie、每次 answers/compile PoP 的 wire/驗證細節，唯一 Function owner 是 `F01-API-ID-001A`；Shared HTTP 例外由 `API-CONVENTIONS.md` `12.2 擁有。F07 identity ensure 不產生認證、不能憑同一 UUID 分享私有 Intent、不能以 global cookie 代替 signed PoP。

證據收集仍遵守最少資料原則：任何 F01 PoP private key、signature、scoped cookie、DB role credentials 都不能出現在 F07 telemetry 或原始產品事件內。已建立的 F07 UUID rotation、server ensure、事件去重邊界保持不變。這是 F01 mutation security 的跨 owner 約束，不加入 F07 bootstrap network round trip。

# 5. Server Ensure / Identity Row

## F07-RQ-002

Phase 1 不增加 bootstrap identity round trip。

首次 meaningful server interaction：

~~~text
F01 request
or F05 share creation
or F07 event batch
→ AnonymousIdentityRepository.ensure(anonymous_id)
~~~

ensure：

- valid UUID + row不存在 → create ACTIVE / WEB_PHASE1
- row存在 ACTIVE → continue
- row DISABLED → client rotate
- invalid UUID → reject field / rotate locally

這樣 First Value 不因 Identity 多一個 blocking API。

# 6. last_seen_at Policy

## F07-POL-001

last_seen_at 最多：

~~~text
once per anonymous_id per 24 hours
~~~

目的：

- continuity evidence
- anonymous repeat estimate
- 避免 hot-row write amplification

last_seen update失敗不得阻斷產品流程。

# 7. Identity Rotation

## F07-POL-002

Rotation條件：

- local anonymous_id missing / invalid
- server明確回 IDENTITY_DISABLED
- future explicit privacy reset

Rotation：

~~~text
discard old local ID
→ create new random anonymous_id
→ do not auto-link old/new IDs
~~~

Phase 1 不做 hidden identity stitching。

# 8. Session ID

## F07-RQ-003

session_id 使用 random UUID，存在：

~~~text
appf2.session_id.v1
→ sessionStorage / equivalent
~~~

Semantics：

- same tab reload盡量保留
- new independent browser session可得到新 ID
- session_id不是 durable identity
- session_id不是 security credential
- browser對 tab/sessionStorage 的特殊複製行為只影響 analytics precision，不影響產品 correctness

# 9. Evidence Source Precedence

## F07-POL-003

appf2 不把所有 Evidence 都塞進 product_event。

Canonical precedence：

~~~text
1. Durable domain lifecycle tables
2. product_event meaningful product events
3. operational logs / traces
~~~

Examples：

~~~text
compiler cost / attempts → compiler_run
F02 pass / reject → validation_run
share durable existence → share
correction outcome → correction_record
User saw clarification / chose recovery / opened Remix → product_event
stack trace → operational logs
~~~

原則：

> 不為 analytics方便建立第二份 durable business truth。

# 10. Common Evidence Event Envelope

## F07-DATA-001

~~~text
EvidenceEvent
├─ event_id
├─ event_type
├─ schema_version
├─ occurred_at
├─ anonymous_id?
├─ session_id?
├─ function_id
├─ intent_id?
├─ blueprint_hash?
├─ share_id?
├─ capability_id?
├─ error_code?
├─ policy_rule_id?
├─ trace_id?
└─ properties?
~~~

Server adds：

~~~text
received_at
~~~

Persistent mapping符合 DATA-MODEL product_event。

A0 / BF-022 canonical ownership：

- Common envelope 是 `event_id / event_type / schema_version / occurred_at / anonymous_id / session_id / function_id / intent_id / blueprint_hash / share_id / capability_id / error_code / policy_rule_id / trace_id` 的唯一 event-level truth。
- Server-added `received_at` 也是 reserved envelope field。
- `properties` **不得再次使用任何 reserved envelope field name**；同一 event 不可同時有 envelope `error_code` 與 properties `error_code` 等雙重真相。
- 若 Function 需要不同語意的同類值，必須使用不同名稱，例如 Blueprint contract version = `blueprint_schema_version`；event `schema_version` 永遠只表示 Evidence event schema。
- Registry / server intake 必須 fail closed 拒絕 reserved-envelope property collision。

# 11. Stable Event Type

## F07-RQ-004

event_type 使用 Function stable Event ID：

~~~text
F00-EVT-001
F01-EVT-003
F05-EVT-007
F06-EVT-008
...
~~~

Rules：

1. event_type一旦進 Spec不得重用成不同 meaning。
2. function_id必須與 event_type prefix一致。
3. unknown event_type → reject。
4. deprecated event保留 ID，不重用。
5. breaking event schema → schema_version major bump。

Human-readable event name留在 Function event definition，不作 DB identity。

# 12. Event Catalog Ownership

## F07-RQ-005

SSOT分工：

~~~text
F07
→ common envelope / ingestion / privacy / retention / collection rules

Each Fxx
→ its event meaning / trigger / function-specific allowed properties
~~~

F07 不複製所有 Fxx event definitions。

CI / build可由 Fxx event definitions生成：

~~~text
generated/evidence/event-registry.json
~~~

Logical registry structure：

~~~text
registry_version
reserved_envelope_fields[]
envelope_field_schemas{}
property_schemas{}
event_property_constraints{}
entries[]:
  event_type
  event_name
  function_id
  schema_version
  collection_class
  required_context[]
  allowed_properties[]
  retention_class
  metric_tags[]
  deprecated
~~~

Rules：

1. 每個 common envelope field 必須能解析到唯一 `envelope_field_schemas{}` contract。
2. `reserved_envelope_fields[]` 不得出現在任何 `entries[].allowed_properties[]`。
3. 每個 `allowed_properties[]`名稱必須能解析到唯一 `property_schemas{}` contract。
4. `event_property_constraints{}`只能收窄 base property schema，不得放寬；若 property requirement 依賴 envelope field，必須使用 explicit envelope-aware constraint，不得假設同名 property。
5. Registry必須完整表達 server intake所需的 envelope/property type / enum / format / bounds，不得要求 Cursor / collector自行發明。
6. Generated registry不手改，不是第二份人工 SSOT；Working registry是 approved Fxx / F07 truth 的 machine-readable projection。

# 13. Collection Classes

## F07-DATA-002

~~~text
CORE_OUTCOME
RELIABILITY
PRODUCT_SAMPLE
DEBUG_ONLY
~~~

CORE_OUTCOME：
- 直接回答 Core Proof / PMF gate
- production durable
- default unsampled

RELIABILITY：
- meaningful failure / recovery / trust / compatibility
- production durable
- failure events default unsampled

PRODUCT_SAMPLE：
- discovery / UX exposure
- 可 deterministic sample

DEBUG_ONLY：
- high-frequency implementation detail
- production product_event預設不 durable

# 14. Phase 1 Collection Policy

## F07-POL-004

CORE_OUTCOME examples：

~~~text
intent submitted
intent validated / app ready
clarification completed
semantic mismatch requested
correction accepted / rejected / reverted
share created
share opened
share restore ready
meaningful use
remix child accepted
recovery succeeded / abandoned
~~~

RELIABILITY examples：

~~~text
compile terminal failure
validation rejection
runtime fatal
share restore failure
capability gap
recovery failure
~~~

PRODUCT_SAMPLE examples：

~~~text
shell opened
capsule viewed
share overlay opened
remix overlay opened
~~~

DEBUG_ONLY examples：

~~~text
every action committed
every render
every timer tick
every state mutation
focus / pointer movement
~~~

F03 action_committed這類高頻 seed，Phase 1 production預設不 durable，除非明確 bounded sampling / investigation。

# 15. Event Properties

## F07-DATA-003

properties必須 event-type allowlisted，且每個 allowlisted property都必須在 Working Evidence Registry的 `property_schemas` 有 machine-readable type / enum / format / bound contract；不得只列名稱而把合法值留給 implementation猜。

`properties` namespace 與 common envelope namespace 必須分離：

- reserved envelope field name 一律禁止出現在 properties；
- common correlation / identity / error / trace 值只放 envelope；
- Function-specific version若不是 event schema，使用明確名稱，例如 `blueprint_schema_version`；
- 任何 collector / server 發現 reserved collision 必須拒絕該 event，而不是挑一份當 truth。

同名非-reserved property的共用 schema由 registry單一定義；若同名 property因 Function owner具有不同 enum，可用 function-scoped constraint收窄，但不得放寬 base schema。Event-specific constraint可再收窄合法值。

Allowed categories：

- enum
- boolean
- bounded integer / number
- stable version string
- approved bounded identifier
- duration / count
- coarse outcome class

禁止：

- raw Intent / Prompt
- raw model response
- free-form correction text
- arbitrary Result value
- full Runtime state
- full Blueprint JSON
- email / phone / account identifier
- IP address copied into product_event
- raw User-Agent
- arbitrary nested object dump

# 16. Payload Bounds

## F07-POL-005

~~~text
max one event serialized size = 8 KB
max properties size = 4 KB
max batch events = 50
max batch request = 256 KB
max nested property depth = 2
max string property length = 256 chars
~~~

一個 event超限時只拒絕該 event，不 rollback整批 valid events。

# 17. Client Event Buffer

## F07-RQ-006

Browser EvidenceCollector：

~~~text
emit(event)
→ local registry validation
→ enqueue
→ batch flush
~~~

Flush triggers：

~~~text
queue size >= 20
OR 10 seconds elapsed
OR visibility hidden
OR pagehide
OR important outcome flush
~~~

pagehide優先用 sendBeacon / fetch keepalive equivalent。

### Phase 1 terminal handoff precedence

Human-approved T007 decision（2026-10-05）：

- `pagehide` / terminal lifecycle 優先建立 synchronous browser-safe handoff；不得把「先完成另一輪 IndexedDB / cross-tab async verification」當成 terminal handoff 的前置條件。
- 只可 handoff 本 collector 當下仍持有、未超過 24h TTL、且已通過 privacy contract 的 immutable event snapshot。
- normal flush / retry 仍必須以 shared durable queue 的 latest observable membership 為準；shared durable queue 的 200 events / 1 MB hard bound、priority eviction 與 TTL 不因 pagehide 放寬。
- Narrow race exception：若另一 tab 在本 tab 最後一次 reconcile 後、pagehide handoff 前剛好因 shared overflow 淘汰同一 event，本 tab 仍可 handoff 該 stale local copy。此 exception **只限 terminal lifecycle handoff**，不得擴張成一般 retry / flush 規則。
- Server 仍以 `event_id` dedupe；Evidence 不是 Product truth，這個 race 不得改變 ownership、authorization、Blueprint、entitlement 或其他 Product state。
- Browser-safe handoff 必須遵守 sendBeacon / fetch keepalive 的可接受 transport budget；被 browser 拒絕或未 handoff 的 record 在頁面仍存活時保留於 queue。

Evidence upload失敗不得阻斷 User workflow。

# 18. Offline / Unsent Queue

## F07-POL-006

Recommended Phase 1：

~~~text
IndexedDB / equivalent
TTL = 24 hours
max queued events = 200
max queue bytes = 1 MB
~~~

Rules：

- queue只含已通過 privacy contract 的 event
- overflow先丟 DEBUG_ONLY / PRODUCT_SAMPLE
- CORE_OUTCOME / RELIABILITY優先保留
- 超過24h丟棄
- queue不是 durable product truth

# 19. Network Retry

## F07-POL-007

Immediate retry：

~~~text
attempt 1
→ about 1s bounded jitter
→ attempt 2
→ about 5s bounded jitter
→ attempt 3
~~~

若仍失敗：

- 保留 local queue
- online / next flush再試
- 不 aggressive infinite retry
- 4xx schema/privacy rejection不 retry
- 429 / 5xx / network transient可 later retry

# 20. Retry Idempotency

## F07-RQ-007

每個 occurrence第一次 emit時產生 event_id UUID。

Retry：

> 同一 occurrence永遠重用同一 event_id。

product_event.event_id 是 PK。

~~~text
same event_id received again
→ first insert wins
→ duplicate acknowledged
→ no duplicate durable row
~~~

Batch endpoint是 Shared API idempotency exception：不需要 Idempotency-Key；以每個 event_id作 dedupe identity。

# 21. Semantic Dedupe

## F07-POL-008

Network retry dedupe不等於 business outcome dedupe。

Phase 1 rules：

### Share Open

~~~text
same session_id
+ same share_id
+ share_open
+ within 5 minutes
→ one meaningful share_open
~~~

### Restore Ready

~~~text
same session_id
+ same share_id
+ same blueprint_hash
+ within 5 minutes
→ one restore_ready
~~~

### Create App Ready

~~~text
same intent_id
+ same blueprint_hash
→ one successful create outcome
~~~

### Refine / Remix Child Accepted

~~~text
same intent_id
+ same child blueprint_hash
→ one accepted outcome
~~~

Rules：

- 用 stable domain keys，不只 timestamp
- 不跨 anonymous identity做 hidden stitching
- Spec時固定 dedupe在 ingest或 metric query層的實作位置

# 22. Event Time

## F07-RQ-008

occurred_at：
- Client UTC occurrence time

received_at：
- Server UTC ingest time；對 durable inserted event，第一次成功 INSERT 的 received_at 是 canonical ingest time，duplicate retry 不得改寫。

Canonical aggregate time：

~~~text
effective_event_at =
  if occurred_at > received_at + 10 minutes
    then received_at
    else occurred_at
~~~

Rules：

- offline backlog最多24h。
- parseable client occurred_at 若 **嚴格大於** server received_at + 10 minutes → `clock_invalid`。
- `occurred_at = received_at + 10 minutes` 仍視為 valid；只有 `>` threshold 才是 clock_invalid。
- clock_invalid event **仍 accepted**；不得只因 client clock future skew 丟掉 Evidence。
- clock_invalid event保留原始 occurred_at，也保留 server received_at；不得 normalize / rewrite 原始 occurred_at。
- clock_invalid event的 analytics / aggregate canonical time = received_at；其他 event = occurred_at。
- `effective_event_at` 是由 durable `occurred_at + received_at` deterministic derive 的 logical value，Phase 1 不新增第二個 durable timestamp truth。
- duplicate event_id retry沿用首次 durable row；不得以 retry request的新 server time重算 clock classification、改寫 received_at或改變 effective_event_at。
- 不上傳完整 device time configuration。

# 23. Batch Ingestion API

## F07-API-001

~~~text
POST /api/v1/events/batch
~~~

不要求登入。

Request：

~~~json
{
  "batch_id": "uuid",
  "events": [
    {
      "event_id": "uuid",
      "event_type": "F05-EVT-007",
      "schema_version": "1.0.0",
      "occurred_at": "2026-09-21T01:23:45.000Z",
      "anonymous_id": "uuid",
      "session_id": "uuid",
      "function_id": "F05",
      "intent_id": null,
      "blueprint_hash": "sha256:...",
      "share_id": "uuid",
      "capability_id": null,
      "error_code": null,
      "policy_rule_id": null,
      "trace_id": null,
      "properties": {
        "share_mode": "DURABLE_REFERENCE"
      }
    }
  ]
}
~~~

Response：

~~~json
{
  "request_id": "req_...",
  "data": {
    "accepted": 1,
    "duplicates": 0,
    "rejected": 0,
    "rejections": [],
    "diagnostics": [
      {
        "event_id": "uuid",
        "code": "F07-ERR-013",
        "field": "occurred_at",
        "action": "USE_RECEIVED_AT"
      }
    ]
  }
}
~~~

Partial acceptance允許。

`rejections[]` 與 `diagnostics[]` 是不同 contract：

- `rejections[]` = event 未被接受 / 未形成新 durable event。
- `diagnostics[]` = event 已被接受，但 server intake偵測到 non-rejecting canonical condition。
- `F07-ERR-013 EVENT_CLOCK_INVALID` 只出現在 accepted INSERT 的 `diagnostics[]`；不得放進 `rejections[]`，也不得增加 `rejected`。
- clock-invalid accepted INSERT仍增加 `accepted`。
- duplicate retry增加 `duplicates`；不得用 retry request的新 server time重新 clock-classify，也不產生新的 clock diagnostic。
- diagnostic item Phase 1 canonical shape = `event_id + code + field + action`；BF-011 的 action 固定為 `USE_RECEIVED_AT`。

### Phase 1 Evidence-quality report extension

`/api/v1/events/batch` 可額外帶一個 optional、non-identifying、bounded `quality_report`：

~~~json
{
  "batch_id": "uuid",
  "events": [],
  "quality_report": {
    "report_id": "uuid",
    "local_queue_drop_count": 3,
    "offline_expired_event_count": 1
  }
}
~~~

Canonical rules：

1. `quality_report` 不是 Product Event，不進 Evidence Registry，也不建立 F07-EVT-*；避免用 Evidence event 監控 Evidence pipeline 自己而形成 recursion。
2. `report_id` 是 quality-report idempotency identity，不是 User / session / event identity。
3. 兩個 count 都必須是 non-negative safe integer，至少一個 > 0；不得夾帶 anonymous_id / session_id / event_id / intent_id / share_id / trace_id / free-form content / raw properties。
4. Browser 只回報自上次 confirmed HTTP 2xx acknowledge 後累積的 queue-quality delta；同一 sealed report 的 retry 永遠重用同一 `report_id` 與相同 counts。
5. `sendBeacon()` 只代表 browser 接受 handoff，不代表 server confirmed；因此 pagehide beacon 不得清除 pending quality report。後續 foreground / normal flush 可重送同一 `report_id`，server 必須 idempotent dedupe。
6. Server 對 duplicate `report_id` 必須 `first durable receipt wins / ON CONFLICT DO NOTHING`，不得 double count，也不得改寫 first durable `received_at`。
7. 允許 `events=[]` 的 quality-only batch；但若 events 為空且沒有有效 quality_report，視為 `F07-ERR-003 EVENT_SCHEMA_INVALID`。
8. batch request 256 KB hard bound 必須包含 quality_report bytes；quality report 不得繞過既有 request bound。

# 24. Event Intake Validation

## F07-RQ-009

Server validate：

1. request / event size
2. envelope against `envelope_field_schemas{}`，包括 event_id / anonymous_id / session_id / share_id 的 canonical UUID v4要求
3. schema_version supported
4. event_type registered
5. function_id matches registry
6. context identifier format
7. properties不得包含任何 `reserved_envelope_fields[]`
8. allowed_properties only
9. property schema type / enum / format / bounds + event/function-specific narrowing constraints
10. envelope-aware cross-field constraints（例如 envelope error_code 觸發 property requirement）
11. forbidden user-content fields
12. occurred_at parseability + clock sanity；parse failure拒絕，future skew >10m依 F07-RQ-008 accepted + diagnostic，不得混成 rejection
13. collection class production policy：production intake 若 registry entry 為 `DEBUG_ONLY`，該 event 必須 fail closed 以 `F07-ERR-016 DEBUG_ONLY_PRODUCTION_REJECTED` 作為 non-retryable event rejection；不得 silent durable、不得轉成其他 collection class、不得先 ensure identity / insert product_event
14. anonymous identity ensure when present

Invalid event不使整 batch rollback。

# 25. Anonymous Identity on Ingestion

有 anonymous_id：

~~~text
validate canonical UUID v4
→ ensure anonymous_identity
→ bounded last_seen
→ insert product_event
~~~

Server lifecycle event若能由 intent/trace取得 identity，也可填 anonymous_id。

Infrastructure event可 anonymous_id = null。

# 26. Privacy Boundary

F07沿用 DATA-MODEL：

~~~text
PUBLIC_ARTIFACT
PRODUCT_INTERNAL
USER_CONTENT
SENSITIVE_USER_CONTENT
OPERATIONAL_METADATA
~~~

product_event預設只允許：

~~~text
OPERATIONAL_METADATA
+ explicitly approved non-sensitive categorical context
~~~

USER_CONTENT / SENSITIVE_USER_CONTENT不可直接進 properties。

# 27. No Fingerprinting

## F07-SEC-001

明確禁止用以下資料重建 identity：

- canvas / WebGL / audio fingerprint
- installed font list
- screen/device trait hash
- persistent raw IP as product identity
- raw User-Agent + device traits composite
- cross-site identifiers

Infra security logs若依法/安全需要短期IP，不得自動複製到 product_event，也不得拿來做 identity stitching。

# 28. Retention

## F07-POL-009

Phase 1 raw product_event：

~~~text
retention = 90 days from first durable received_at
eligible_for_deletion =
  received_at < maintenance_now_utc - 90 days
~~~

Rules：

1. retention anchor = **first durable `received_at` only**；client `occurred_at` 不控制 privacy retention。
2. duplicate `event_id` retry 不得改寫 `received_at`，因此也不得延長 90-day retention。
3. clock-invalid event 的 analytics bucket仍依 `effective_event_at`，但 deletion cutoff仍只看 `received_at`。
4. raw deletion前必須先 materialize / verify §DATA-MODEL `evidence_daily_aggregate` 所需的 bounded non-identifying counts/rates。
5. aggregate watermark未涵蓋 cutoff時 fail closed：不刪除尚未安全聚合的 eligible raw rows。
6. aggregate不保留 event_id / anonymous_id / session_id / intent_id / share_id / trace_id / free-form content。
7. `EvidenceRetentionMaintenance` 是 semantic owner；default once per UTC day，由可替換 scheduled trigger 呼叫。
8. provider-specific cron只決定「何時呼叫」，不得擁有 retention / aggregation semantics。
9. maintenance 重跑必須 idempotent；失敗可 retry，不阻斷 Consumer workflow。

Local unsent queue：

~~~text
24 hours
~~~

Operational debug logs若含 raw provider/request payload，Phase 1 maximum retention = 7 days，且 access-controlled。

Evidence-quality operational sources：

- `evidence_intake_observation`：90 days from first durable `received_at`；在刪除前 materialize / verify 對應 quality aggregate watermark。
- `evidence_client_quality_report`：90 days from first durable `received_at`；duplicate `report_id` 不延長 retention；在刪除前 materialize / verify queue-quality aggregate watermark。
- 這兩個 source 都只能保存 bounded operational counts/status，不得保存 User/session/event identity 或 raw event content。

# 28.1 Shared User-Content Retention Matrix

## F07-POL-009A

F07與 DATA-MODEL共同固定 Phase 1 privacy retention：

| Data | Value-bearing retention | Expiry action |
|---|---:|---|
| Browser prompt / clarification / correction / recovery draft | 7 days | delete local record |
| raw_intent | 30 days after terminal intent state | set raw_intent = NULL |
| result_snapshot input/output values | 30 days | redact values, keep bounded metadata row |
| product_event raw row | 90 days from first durable received_at | EvidenceRetentionMaintenance先 materialize/verify bounded aggregate，再 delete eligible row |
| local unsent event queue | 24 hours | delete unsent event |
| idempotency_operation | 24 hours | delete expired operation row |
| raw provider/request debug payload when explicitly enabled | max 7 days | delete payload |

Rules：

- SENSITIVE / DO_NOT_PERSIST可比表中更短，不能更長。
- DO_NOT_PERSIST value永不進 durable snapshot / local durable draft。
- retention change屬 Material privacy change，需要 Review。
- Function文件只引用此 matrix，不建立不同 retention數字。

# 29. Anonymous Identity Retention

## F07-POL-010

F07不自動 hard-delete anonymous_identity row，因可能被 Intent / Share / Evidence FK引用。

Continuity metric：

- last_seen超過180天不算 active repeat cohort
- Browser若仍持 ID可重新活躍
- privacy deletion / anonymization需 explicit policy
- 不把 anonymous_id升格成永久人物檔案

# 30. Event Schema Version

## F07-RQ-010

Phase 1 original default：

~~~text
schema_version = 1.0.0
~~~

BF-007 material delta曾使 F03 family進入 v2。A0 / BF-022 將 common envelope 與 properties ownership徹底分離，屬 breaking event schema change，因此 clean replacement baseline 使用：

~~~text
F00-EVT-* = 2.0.0
F01-EVT-* = 2.0.0
F02-EVT-* = 2.0.0
F03-EVT-* = 3.0.0
F04-EVT-* = 2.0.0
F05-EVT-* = 2.0.0
F06-EVT-* = 2.0.0
F16-EVT-* = 2.0.0
F12-EVT-* = 1.0.0  // 無 reserved-envelope property collision，維持原 shape
~~~

Working Evidence Registry因此升為 `registry_version = 3.0.0`。

任何未列 family若未改 event meaning / shape，維持 registry所列 schema_version。

SemVer：

- PATCH：不改 meaning / required shape
- MINOR：backward-compatible optional extension
- MAJOR：breaking envelope / meaning change

Unknown major → reject，不猜。

# 31. Generated Evidence Registry

## F07-RQ-011

由 Fxx definitions生成：

~~~text
generated/evidence/event-registry.json
~~~

CI rules：

- duplicate event_type → fail
- prefix / function mismatch → fail
- reserved envelope field缺 envelope_field_schemas contract → fail
- reserved envelope field出現在 allowed_properties → fail
- allowed property缺 property_schemas contract → fail
- event_property_constraints放寬 base schema → fail
- envelope-aware constraint引用不存在 / 不允許的 envelope field → fail
- `property_schemas.*.pattern` 採 JSON string encoding，但 JSON parse 後必須直接是可交給 RegExp engine 的 logical pattern；不得多保留一層 backslash escaping；canonical Capability ID smoke set 必須包含帶 underscore 的既有 ID（至少 `data.table_basic`）
- canonical regex smoke examples（例如 `layout.container`、`1.0.0`、`F04-ERR-001`、`F12-POL-001`、`F04`）必須在 Freeze Audit / CI 通過
- hash 類 Evidence property 採 `sha256:<64 lowercase hex>` canonical string representation
- CORE_OUTCOME缺 trigger / metric mapping → fail
- DEBUG_ONLY不得被 production collector默認 durable
- generated registry不得手改

# 32. Core Outcome Catalog

F07不重新定義每個 Fxx event meaning；Release 1 必須有 evidence覆蓋：

| Outcome | Canonical Owner / Source |
|---|---|
| Prompt / Create submitted | F00 / F01 |
| Clarification required / completed | F00 / F01 |
| Intent validated | F01 + F02 lifecycle |
| Runtime ready | F00 / F03 |
| Meaningful use | F03 + F07 milestone rule |
| Semantic mismatch raised | F16 / F16-EVT-001 |
| Correction generated / accepted / rejected / reverted | F16 event set + correction_record |
| Share created | F05 |
| Share opened | F05 |
| Share restore ready | F05 |
| Remix started / child accepted | F06 |
| Recovery shown / recovered / abandoned | F12 |
| Capability gap | F04 |
| Cost / latency / attempts | compiler_run |
| Validation failure class | validation_run |

# 33. Meaningful Use

## F07-POL-011

Open不等於Use。

Base rule：

~~~text
Runtime READY
AND
(
  at least one Capability-declared meaningful interaction
  OR intentional result use/evaluation milestone
)
~~~

不計：

- render
- focus / hover
- automatic timer tick
- shell open

F03/F04 implementation需標記哪些 capability events屬 meaningful_interaction。

F07每個 Runtime Instance / session最多記一次 meaningful_use milestone。

# 34. Successful Intent

## F07-POL-012

Technical Successful Intent：

~~~text
intent_kind = CREATE
AND F01 reaches VALIDATED
AND F03 reaches READY
~~~

Product Useful Intent：

~~~text
Technical Successful Intent
AND meaningful_use
~~~

兩者必須分開。

Runtime ready不等於 semantic / product success。

# 35. Time to First Useful App

## F07-METRIC-001

~~~text
start = prompt_submitted
end = first meaningful_use
linked through same create intent / resulting Blueprint chain
~~~

Report：

- median
- p75
- p90

不只看 compile latency。

# 36. Semantic Mismatch Rate

## F07-METRIC-002

Numerator：

~~~text
unique intent / active Blueprint
with F16 semantic mismatch or correction requested
within same session or 24h attribution window
~~~

Phase 1報兩種 denominator：

- Runtime Ready Intents
- Product Useful Intents

避免單一 denominator造成誤讀。

# 37. Recovery Success Rate

## F07-METRIC-003

~~~text
unique recovery episodes reaching intended safe continuation
/
unique recoverable recovery episodes shown
~~~

F12需定 stable recovery episode grouping。

User關掉頁面不算成功。

# 38. Share Funnel

## F07-METRIC-004

~~~text
Used App
→ Share Created
→ Share Opened
→ Restore Ready
→ Meaningful Use
→ Remix Started
→ Remix Child Accepted
~~~

每層分開，不把 click當 success。

# 39. Anonymous Repeat

## F07-METRIC-005

~~~text
same anonymous_id
has meaningful product activity
on 2+ distinct UTC dates
within rolling 30 days
~~~

限制：

- clear site data會低估 repeat
- shared device可能高估 person repeat
- 所以它是 product signal，不是精準 person count
- 不用 fingerprint修正

# 40. Cost per Successful Intent

## F07-METRIC-006

~~~text
Cost per Technical Successful Intent
=
sum compiler/model estimated cost
/
technical successful intents
~~~

~~~text
Cost per Useful Intent
=
sum compiler/model estimated cost
/
product useful intents
~~~

來源：compiler_run + intent/Blueprint linkage + Runtime/use milestone。

# 41. Capability Gap Evidence

## F07-METRIC-007

F04 gap evidence要能回答：

~~~text
哪些 semantic requirement常 unsupported？
哪些 gap造成 abandon？
哪些 gap值得進 roadmap？
~~~

只記 stable gap/category/capability IDs，不記 raw Intent描述。

# 42. Evidence Quality Metrics

F07本身也要量測，而且 Phase 1 的每個 quality metric 必須有唯一 source、bucket、numerator / denominator 與 idempotence semantics；不得只留 metric name 給 implementation 猜。

| metric_key | canonical source | bucket_date | numerator_count | denominator_count |
|---|---|---|---:|---:|
| event_batch_accept_rate | evidence_intake_observation | source received_at UTC day | batch_accepted=true 的 request attempts | 所有 /api/v1/events/batch request attempts |
| event_rejection_rate | evidence_intake_observation | source received_at UTC day | rejected_count sum | event_received_count sum |
| duplicate_retry_rate | evidence_intake_observation | source received_at UTC day | duplicate_count sum | event_received_count sum |
| unknown_event_type_count | evidence_intake_observation | source received_at UTC day | unknown_event_type_count sum | NULL |
| local_queue_drop_count | evidence_client_quality_report | first durable report received_at UTC day | local_queue_drop_count sum | NULL |
| offline_expired_event_count | evidence_client_quality_report | first durable report received_at UTC day | offline_expired_event_count sum | NULL |
| clock_invalid_rate | product_event | F07 effective_event_at UTC day | clock-invalid accepted durable rows | accepted durable rows in same aggregate logical key |

Additional canonical rules：

1. `event_count` 仍由 product_event derive；它與上述七個 quality metrics 共同構成 DATA-MODEL §6.11 Phase 1 minimum aggregate support。
2. pre-service malformed / oversized / batch-too-large request 只影響 `event_batch_accept_rate`；因沒有 canonical event candidates，不得假造 event_rejection_rate denominator。
3. `event_rejection_rate` / `duplicate_retry_rate` 的 denominator = `event_received_count = accepted + duplicates + rejected`；denominator 0 時不得產生 percentage。
4. `F07-ERR-004` event-level rejection同時增加 `rejected_count` 與 `unknown_event_type_count`。
5. `F07-ERR-016 DEBUG_ONLY_PRODUCTION_REJECTED` 增加 `rejected_count`，但不增加 `unknown_event_type_count`。
6. operational quality aggregate 的 optional dimensions `function_id / event_type / collection_class` Phase 1 一律 NULL；不得從 malformed / rejected input 猜 dimension。
7. Browser queue drop / expiry 只透過 bounded quality_report 上送；不得建立 recursive Product Event。
8. 每個 source table 的 raw/source row 只能在它所擁有的 metric aggregate watermark 覆蓋 deletion cutoff 後刪除；一個 source class 的 failure 不得假造另一 source class 的 coverage。
9. Evidence pipeline壞掉時，不能把「沒有 event」誤讀成「User沒做」。

# 43. Frontend Behavior

F07幾乎沒有 Consumer UI。

User不看：

- anonymous_id
- session_id
- event_id
- queue / retry

Evidence upload failure silent / non-blocking by default。

# 44. Backend Processing

Canonical services：

~~~text
AnonymousIdentityService
EvidenceCollector
EvidenceRegistry
EvidenceIngestionService
EvidenceRepository
EvidenceQualityRecorder
EvidenceMetricQuery
~~~

Flow：

~~~text
Browser emit
→ local validation
→ queue
→ bounded quality counter accumulation
→ batch + optional quality_report
→ Edge/API intake
→ EvidenceQualityRecorder records the request attempt before any pre-service return
→ server validation
→ collection-class production policy
→ identity ensure
→ event_id dedupe
→ semantic dedupe where required
→ product_event insert
→ EvidenceQualityRecorder records event-level intake result / dedupes quality_report
→ metric materialization / evidence review

Production rule：`EvidenceQualityRecorder` 是 appf2-owned mandatory production dependency；production batch handler 不得以 optional/null observer 作為 canonical wiring。Test-only no-op 可存在，但不得成為 production default。
~~~

Phase 1不需要 event streaming platform。

# 45. API Security / Abuse

## F07-SEC-002

Public batch endpoint可被偽造，因此：

- product_event不是 authorization / security audit truth
- strict schema validation
- bounded abuse rate limit
- invalid / oversized payload拒絕
- event不能觸發 product behavior
- anonymous_id不能提升權限
- metrics可排除 obvious abuse
- security-sensitive truth使用 domain table / server logs

# 46. Rate Limits

## F07-POL-013

Phase 1 abuse ceiling：

~~~text
max batch requests / anonymous_id = 60 per minute
max accepted events / anonymous_id = 500 per 10 minutes
~~~

正常產品應遠低於此值。

超限：

- HTTP 429
- Client不 aggressive retry
- product workflow不受影響

# 47. Error Taxonomy

| ID | Meaning | Retry | Product Impact |
|---|---|---|---|
| F07-ERR-001 | ANONYMOUS_ID_INVALID | CONDITIONAL | rotate |
| F07-ERR-002 | ANONYMOUS_ID_DISABLED | ROTATE | new identity |
| F07-ERR-003 | EVENT_SCHEMA_INVALID | NO | drop invalid event |
| F07-ERR-004 | EVENT_TYPE_UNKNOWN | NO | instrumentation bug |
| F07-ERR-005 | EVENT_PROPERTY_FORBIDDEN | NO | drop invalid event |
| F07-ERR-006 | EVENT_TOO_LARGE | NO | drop invalid event |
| F07-ERR-007 | EVENT_BATCH_TOO_LARGE | NO | split/drop |
| F07-ERR-008 | EVENT_RATE_LIMITED | YES_LATER | retain queue |
| F07-ERR-009 | EVENT_INGEST_UNAVAILABLE | YES | retain queue |
| F07-ERR-010 | EVENT_STORAGE_FAILED | YES | retry if possible |
| F07-ERR-011 | LOCAL_QUEUE_FULL | NO | priority drop |
| F07-ERR-012 | LOCAL_QUEUE_EXPIRED | NO | drop |
| F07-ERR-013 | EVENT_CLOCK_INVALID | NO | accepted ingestion diagnostic；preserve occurred_at + received_at；aggregate uses received_at |
| F07-ERR-014 | EVIDENCE_REGISTRY_MISMATCH | NO | deployment issue |
| F07-ERR-015 | INTERNAL_INVARIANT | NO | diagnostics |
| F07-ERR-016 | DEBUG_ONLY_PRODUCTION_REJECTED | NO | instrumentation bug；drop event / never durable |

這些錯誤預設不打擾 Consumer UI。

# 48. Privacy / Security

- F07-SEC-003 No fingerprinting。
- F07-SEC-004 Anonymous ID不是 auth credential。
- F07-SEC-005 Raw Intent不進 product_event。
- F07-SEC-006 Raw Result / Runtime State不進 product_event。
- F07-SEC-007 Properties只能 event allowlist。
- F07-SEC-008 Provider secret / token永不進 Evidence。
- F07-SEC-009 Local event queue只保存 approved telemetry payload。
- F07-SEC-010 Raw product_event retention = 90 days。
- F07-SEC-011 Anonymous repeat不做 cross-device stitching。
- F07-SEC-012 Client Evidence不可改 Blueprint / entitlement / ownership。
- F07-SEC-013 F08 account migration必須 explicit claim，不以 telemetry推斷身份。

# 49. Acceptance Criteria

Identity：

- F07-AC-001 First Value前不需 account。
- F07-AC-002 first-party random anonymous_id不使用 fingerprint。
- F07-AC-003 clear site storage後不嘗試重建舊 identity。
- F07-AC-004 anonymous_id不能授權 owner-only action；〔BD-025 安全 proof 補強，Review 候選〕anonymous_id 僅 continuity，不授權 F01 private read、F05 Share CREATE、owner action；不得 global-cookie fallback。
- F07-AC-005 last_seen不因每個 event同步 write。

Evidence Envelope：

- F07-AC-006 unknown event_type被拒絕。
- F07-AC-007 function_id / event_type prefix mismatch被拒絕。
- F07-AC-008 envelope identifier / UUID version、reserved-envelope separation、property allowlist，以及 registry type / enum / format / bounds / narrowing constraint 任一不合法，該 event不能進 product_event。
- F07-AC-009 raw Intent / raw Result不需要進 Evidence。
- F07-AC-010 event retry使用同 event_id且不 duplicate durable row。
- F07-AC-011 one invalid event不 rollback整個 valid batch。
- F07-AC-012 payload limits在 server enforce。

Batch / Reliability：

- F07-AC-013 normal local Runtime interaction不逐 action發 network request。
- F07-AC-014 batch最多50 events。
- F07-AC-015 transient ingest failure不阻斷 product flow。
- F07-AC-016 unsent queue最多保留24h。
- F07-AC-017 queue overflow優先保留 CORE_OUTCOME / RELIABILITY。
- F07-AC-018 pagehide可 best-effort flush；terminal handoff 不以 fresh cross-tab async verification 為前置，並遵守 browser-safe sendBeacon / fetch keepalive transport budget。

Metrics：

- F07-AC-019 Share Open與Restore Ready分開量。
- F07-AC-020 Runtime Ready與Meaningful Use分開量。
- F07-AC-021 technical Successful Intent與Useful Intent分開量。
- F07-AC-022 anonymous repeat不用 fingerprint修正。
- F07-AC-023 cost per successful/useful intent可從 canonical evidence計算。
- F07-AC-024 semantic mismatch可與原 intent / Blueprint關聯。
- F07-AC-025 recovery success可與 recovery episode關聯。

Retention / Quality：

- F07-AC-026 raw product_event 以 first durable received_at 為 cutoff anchor，透過 appf2-owned EvidenceRetentionMaintenance 可執行 90-day retention。
- F07-AC-027 bounded non-identifying evidence_daily_aggregate 可在 source deletion後保留 event_count + 七個 F07 Evidence-quality metric 的 canonical count/rate truth；aggregate 不含 event/user/session/intent/share/trace identity 或 raw content，且每個 source deletion 都受自己的 aggregate watermark fail-closed 保護。
- F07-AC-028 evidence rejection / batch rejection、local queue drop、offline queue expiry 必須經 appf2-owned production EvidenceQualityRecorder / bounded quality_report 成為可持久化與可 aggregate 的 observable；只證明 optional callback 可注入不算 PASS。
- F07-AC-029 DEBUG_ONLY 不默認 durable 到 production product_event：client production collector 不 admission；server 即使收到 registered DEBUG_ONLY 也必須以 F07-ERR-016 non-retryable reject，且不得 ensure identity / insert product_event。
- F07-AC-030 parseable occurred_at > received_at + 10m 的 event仍 accepted；保留兩個原始時間，response以 diagnostics[]回 F07-ERR-013 / occurred_at / USE_RECEIVED_AT，且不得增加 rejected。
- F07-AC-031 effective_event_at必須由 durable occurred_at / received_at deterministic derive：clock-invalid用 received_at，其餘用 occurred_at；exactly +10m valid；duplicate retry不得改寫 received_at或以新的 retry time重算 classification。

# 50. Test Mapping Seed

~~~text
F07-AC-002 → TEST-F07-002 no fingerprint identity
F07-AC-003 → TEST-F07-003 no hidden identity recovery
F07-AC-004 → TEST-F07-004 anonymous not authorization
F07-AC-006 → TEST-F07-006 unknown event rejection
F07-AC-008 → TEST-F07-008 property allowlist + type / enum / format / bounds
F07-AC-009 → TEST-F07-009 no raw content telemetry
F07-AC-010 → TEST-F07-010 retry dedupe
F07-AC-011 → TEST-F07-011 partial batch acceptance
F07-AC-013 → TEST-F07-013 no per-action network telemetry
F07-AC-014 → TEST-F07-014 batch bound
F07-AC-016 → TEST-F07-016 queue TTL
F07-AC-017 → TEST-F07-017 priority overflow
F07-AC-019 → TEST-F07-019 share funnel separation
F07-AC-020 → TEST-F07-020 ready vs meaningful use
F07-AC-022 → TEST-F07-022 no identity stitching
F07-AC-026 → TEST-F07-026 retention job
F07-AC-029 → TEST-F07-029 debug production guard
F07-AC-030 → TEST-F07-030 accepted clock-invalid diagnostic
F07-AC-031 → TEST-F07-031 effective event time + duplicate clock stability
~~~

# 51. Dependencies

Upstream：

- DATA-MODEL anonymous_identity / product_event
- BUSINESS-PLAN Core Proof questions
- F00–F06 lifecycle / event seeds

Downstream：

- F08 account claim / ownership
- F10 reuse evidence gate
- F12 Recovery metrics
- F16 semantic mismatch / correction metrics
- roadmap Evidence Gates

# 52. Release / Migration

Phase 1：

~~~text
Browser random anonymous ID
+ browser session ID
+ EvidenceCollector
+ generated Evidence Registry
+ POST /api/v1/events/batch
+ PostgreSQL product_event
+ 90-day raw retention
+ SQL / application metric queries
~~~

不引入：

- third-party tracking provider as semantic truth
- Kafka / event streaming
- dedicated warehouse
- fingerprint service
- cross-device identity graph
- session replay

未來若換 analytics provider：

> Provider只能是 sink / adapter；F07 Event Contract仍是 appf2-owned。

# 52.1 Machine-readable Event Registry

Phase 1 Working registry：

~~~text
working/detailed-design/registries/evidence-event-registry.json
~~~

它把各 Fxx stable Event ID 轉成可供 CI / instrumentation 使用的 event_type、function_id、collection_class、required_context、allowed_properties、retention_class 與 metric_tags。Event meaning仍由各 Fxx擁有；F07擁有 shared envelope / privacy / ingestion policy。

# 53. Open Decisions

目前沒有阻擋 Phase 1 Core Evidence 的 architecture-level open decision。

已閉合：

- F12 已定 recovery_episode_id 與 recovered / abandoned / terminated semantics。
- F16 已定 semantic mismatch、correction generated / accepted / rejected / reverted events與 Result privacy。

後續：

1. F08定 anonymous → account explicit claim，不回頭用 telemetry推斷 ownership。
2. Product Evidence Review可調 PRODUCT_SAMPLE sampling rate，但 CORE_OUTCOME meaning不能隨意改。
3. 若90日 raw retention因法規/市場需要變更，屬 Material privacy change，需 Review。
4. **Phase 4 Architecture Review 必須重新評估 centralized browser Evidence delivery coordinator**（例如 Service Worker / single-owner sender），目標是同時取得 shared eviction finality 與 terminal lifecycle handoff。若 Phase 4 review 未明確提前納入，**預設 Phase 5 implementation**；這項升級不得回灌 Phase 1–3 scope。

# Conclusion

F07 Current Truth：

~~~text
No login
→ random first-party anonymous identity
→ meaningful events only
→ batched / idempotent evidence
→ strict allowlist / no raw user content
→ bounded retention
→ Core Proof metrics
→ Evidence decides next Phase
~~~

> No Registration 不等於 No Evidence；但有 Evidence 也不代表要把 User變成可追蹤的人物檔案。
