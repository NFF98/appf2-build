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

1. 每個 `allowed_properties[]`名稱必須能解析到唯一 `property_schemas{}` contract。
2. `event_property_constraints{}`只能收窄 base property schema，不得放寬。
3. Registry必須完整表達 server intake所需的 type / enum / format / bounds，不得要求 Cursor / collector自行發明。
4. Generated registry不手改，不是第二份人工 SSOT；Working registry是 approved Fxx / F07 truth 的 machine-readable projection。

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

同名 property的共用 schema由 registry單一定義；若同名 property因 Function owner具有不同 enum，可用 function-scoped constraint收窄，但不得放寬 base schema。Event-specific constraint可再收窄合法值。

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

# 24. Event Intake Validation

## F07-RQ-009

Server validate：

1. request / event size
2. event_id UUID
3. schema_version supported
4. event_type registered
5. function_id matches registry
6. context identifier format
7. allowed_properties only
8. property schema type / enum / format / bounds + event/function-specific narrowing constraints
9. forbidden user-content fields
10. occurred_at parseability + clock sanity；parse failure拒絕，future skew >10m依 F07-RQ-008 accepted + diagnostic，不得混成 rejection
11. collection class production policy
12. anonymous identity ensure when present

Invalid event不使整 batch rollback。

# 25. Anonymous Identity on Ingestion

有 anonymous_id：

~~~text
validate UUID
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
90 days
~~~

After 90 days：

- delete raw event rows
- 可保留非識別 aggregate counts / rates
- aggregate不保留 event_id / anonymous_id / session_id / free-form content

Local unsent queue：

~~~text
24 hours
~~~

Operational debug logs若含 raw provider/request payload，Phase 1 maximum retention = 7 days，且 access-controlled。

# 28.1 Shared User-Content Retention Matrix

## F07-POL-009A

F07與 DATA-MODEL共同固定 Phase 1 privacy retention：

| Data | Value-bearing retention | Expiry action |
|---|---:|---|
| Browser prompt / clarification / correction / recovery draft | 7 days | delete local record |
| raw_intent | 30 days after terminal intent state | set raw_intent = NULL |
| result_snapshot input/output values | 30 days | redact values, keep bounded metadata row |
| product_event raw row | 90 days | delete row; aggregate may remain |
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

Phase 1 default：

~~~text
schema_version = 1.0.0
~~~

BF-007 material delta後，F03 event family因 `runtime_stage` breaking split為 `runtime_status + operation_status`，使用：

~~~text
F03-EVT-* schema_version = 2.0.0
~~~

其他未改 event meaning / shape的 Phase 1 event維持各自 registry所列 schema_version。

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
- allowed property缺 property_schemas contract → fail
- event_property_constraints放寬 base schema → fail
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

F07本身也要量測：

~~~text
event_batch_accept_rate
event_rejection_rate
duplicate_retry_rate
local_queue_drop_count
offline_expired_event_count
unknown_event_type_count
clock_invalid_rate
~~~

Evidence pipeline壞掉時，不能把「沒有 event」誤讀成「User沒做」。

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
EvidenceMetricQuery
~~~

Flow：

~~~text
Browser emit
→ local validation
→ queue
→ batch
→ Edge/API intake
→ server validation
→ identity ensure
→ event_id dedupe
→ semantic dedupe where required
→ product_event insert
→ metric query / evidence review
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
- F07-AC-004 anonymous_id不能授權 owner-only action。
- F07-AC-005 last_seen不因每個 event同步 write。

Evidence Envelope：

- F07-AC-006 unknown event_type被拒絕。
- F07-AC-007 function_id / event_type prefix mismatch被拒絕。
- F07-AC-008 forbidden property，或不符合 registry property type / enum / format / bounds / narrowing constraint 的 property value，不能進 product_event。
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
- F07-AC-018 pagehide可 best-effort flush。

Metrics：

- F07-AC-019 Share Open與Restore Ready分開量。
- F07-AC-020 Runtime Ready與Meaningful Use分開量。
- F07-AC-021 technical Successful Intent與Useful Intent分開量。
- F07-AC-022 anonymous repeat不用 fingerprint修正。
- F07-AC-023 cost per successful/useful intent可從 canonical evidence計算。
- F07-AC-024 semantic mismatch可與原 intent / Blueprint關聯。
- F07-AC-025 recovery success可與 recovery episode關聯。

Retention / Quality：

- F07-AC-026 raw product_event 90-day retention可執行。
- F07-AC-027 non-identifying aggregate可在 raw deletion後保留。
- F07-AC-028 evidence rejection/drop/queue expiry本身可觀測。
- F07-AC-029 DEBUG_ONLY不默認 durable到 production product_event。
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
