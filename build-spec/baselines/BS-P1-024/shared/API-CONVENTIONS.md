# appf2 Shared API Conventions

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED / Phase 1 — Working Current Truth。
> Build Freeze / implementation boundary：`working/common-core/DESIGN-TO-DELIVERY.md`。
> Canonical Role：所有 Phase 1 public HTTP APIs 的共同 transport、identity、idempotency、concurrency、error、rate-limit、timeout 與 versioning contract。
> Function-specific endpoint payload / semantics 仍由各 Fxx 擁有。

# 1. Ownership

Shared owner：working/common-core/API-CONVENTIONS.md。

Function文件不得再複製一整套 common API rules；只定義 endpoint-specific差異。

# 2. Base Transport

~~~text
HTTPS
UTF-8 JSON
API base = /api/v1
~~~

GET = read-only / no mutation。
POST = command / mutation / bounded processing。

Phase 1不使用 GraphQL，也不建立 async job polling作 Core dependency。

# 3. Request Identity

Request header：

~~~text
X-Request-Id: optional client UUID
~~~

Server：

- valid client request ID可沿用；
- 缺失或invalid時 server產生；
- 每個 response都回 X-Request-Id；
- request_id用於 diagnostics / trace，不作 idempotency key。

# 4. Anonymous Identity

需要 continuity / mutation scope 的 endpoint由 Function payload或trusted request context帶 anonymous_id。

Rules：

- anonymous_id是 first-party opaque identity，不是 authentication。
- public GET不要求 anonymous_id。
- anonymous_id不能提升權限。
- future F08 auth加入後，anonymous scope與account authorization分離。

# 5. Success Envelope

~~~json
{
  "request_id": "req_...",
  "data": {}
}
~~~

Binary/static asset與 canonical Blueprint content endpoint可免 envelope，例如 /b/{content_hash}。

# 6. Error Envelope

~~~json
{
  "request_id": "req_...",
  "error": {
    "code": "Fxx-ERR-...",
    "message_key": "stable.message.key",
    "retryable": false,
    "retry_after_seconds": null,
    "details": {}
  }
}
~~~

Rules：

- code使用 source Function stable error ID或shared API error ID。
- details bounded且不得含 stack / SQL / provider secret / raw user content。
- Consumer copy由 F12/F00 humanized mapping。
- 429若可重試應提供 retry_after_seconds。

# 7. Mutation Idempotency

Default：所有會建立或改變 durable logical outcome 的 POST都需要：

~~~text
Idempotency-Key: opaque client key
~~~

Canonical persistence：DATA-MODEL idempotency_operation / PostgreSQL。

Scope：

~~~text
anonymous_id + route_key + idempotency_key
~~~

Canonical status：

~~~text
IN_PROGRESS
FAILED_RETRYABLE
SUCCEEDED
FAILED_TERMINAL
~~~

Rules：

1. same key + same request digest + SUCCEEDED → replay same logical result。
2. same key + same digest + FAILED_TERMINAL → replay same terminal logical outcome。
3. same key + same digest + FAILED_RETRYABLE → caller以 atomic compare-and-swap取得新 attempt：status→IN_PROGRESS、attempt_no+1、lease_expires_at重設為該 route canonical server deadline；logical result identity不得換掉。
4. same key + same digest + IN_PROGRESS 且 `now < lease_expires_at` → HTTP 409 / API-IDEMPOTENCY-IN-PROGRESS / retryable=true。
5. same key + same digest + IN_PROGRESS 且 lease已過期 → 只允許一個 caller以 CAS takeover：attempt_no+1 + 新 lease；其他 concurrent caller看到新 IN_PROGRESS後回 409。
6. 每次 side effect / terminal state commit 必須 compare current attempt_no + IN_PROGRESS lease ownership；stale/late attempt completion不得覆寫較新的 attempt outcome。
7. retryable transient failure → FAILED_RETRYABLE，保存 bounded error_code/http_status與已建立的 logical result_ref；**不得**留永久 IN_PROGRESS，也不得假裝 FAILED_TERMINAL。
8. non-retryable terminal failure → FAILED_TERMINAL。
9. same key + different digest → HTTP 409 / API-IDEMPOTENCY-CONFLICT。
10. TTL = 24h；expired operation不再保證 replay。
11. Idempotency record不保存 raw request body / raw User content；replay由 durable logical result_ref重建。
12. `lease_expires_at` 不使用任意 hidden timeout：由 host Function已鎖定的 canonical server request budget建立。沒有 canonical budget的 mutation必須先定義它，不能自行發明 lease。
13. material User edit / new logical mutation使用新的 Idempotency-Key；network retry / same-body retry沿用原 key。

Exception：

~~~text
POST /api/v1/events/batch
~~~

F07以每個 event_id作 dedupe identity，不要求 Idempotency-Key。

# 8. Optimistic Concurrency

Idempotency防 duplicate command；Concurrency防 stale state overwrite，兩者不能互換。

Phase 1 canonical tokens：

~~~text
Intent mutation
→ intent_version

Correction decision
→ expected_outcome
~~~

Rules：

- intent_version starts at 1。
- successful intent semantic/lifecycle mutation increments version。
- stale intent_version → 409 F01-ERR-004。
- correction stale state → 409 F16-ERR-013。
- updated_at不作 concurrency token。

# 9. HTTP Status Semantics

~~~text
200 success
400 malformed request / invalid typed input
404 resource not found
409 concurrency / idempotency / state conflict
410 expired / revoked public reference
422 semantically disallowed request
429 quota / rate limit
500 unexpected internal invariant
502 upstream/provider unavailable or invalid
503 temporary durable dependency unavailable
504 synchronous operation timeout
~~~

Function可使用更窄 subset，不得重新賦予相反 meaning。

# 10. Timeout / Cancellation

Phase 1 synchronous API hard ceiling：30 seconds，除非 Function明確更低。

Function-specific examples：

~~~text
F01 analyze <= 20s
F01 answers <= 20s
F01 compile <= 30s
~~~

Rules：

- client abort只表示停止等待，不等於 server side一定取消成功。
- network retry / same-body retry mutation必須沿用原 Idempotency-Key；material User edit / new logical mutation必須使用新 key。
- retryable failure必須先 durable transition到 FAILED_RETRYABLE；不能靠刪 idempotency row放行 duplicate logical outcome。
- expired IN_PROGRESS takeover仍是同一 logical operation，只增加 attempt_no；舊 attempt late completion必須被拒絕。
- Core Phase 1不以 hidden background job完成超時 request。

# 11. Rate-limit / Cost Classes

Rate-limit是Edge/Server policy，但error semantics是Shared API Contract。

Phase 1 default ceilings：

~~~text
EXPENSIVE_LLM
POST /intents create/analyze
POST /intents/{id}/compile
POST /corrections
= 12 operations / 10 minutes / anonymous_id
burst <= 4

STANDARD_MUTATION
answers / shares / correction comparison / decisions
= 60 operations / minute / anonymous_id

PUBLIC_READ
share resolve / execution admission / Blueprint metadata gates
= 180 requests / minute / coarse edge source

EVENT_INGEST
= F07-POL-013
60 batches / minute / anonymous_id
500 accepted events / 10 minutes / anonymous_id
~~~

Rules：

- ceiling是abuse/cost guard，不是 entitlement。
- future F13 entitlement不得偷偷改 semantic contract。
- operational tuning可下調/上調，但若明顯影響正常產品行為需 Material Review。
- 429必須進 F12 RATE_LIMITED recovery class。

# 12. API Versioning

~~~text
/api/v1 = transport/public contract major version
~~~

API version與下列版本分離：

~~~text
Blueprint schema_version
Registry version
Runtime version
Evidence schema_version
Prompt / Policy version
~~~

Breaking route/request/response semantics需要新 API major或明確 migration。

# 12.1 Execution Admission Read

Fresh Blueprint execution permission由 `working/common-core/EXECUTION-ADMISSION.md` 擁有：

~~~text
GET /api/v1/blueprints/{content_hash}/execution-admission
~~~

它是 PUBLIC_READ，不是 immutable Blueprint body endpoint。

# 13. Canonical Shared API Errors

~~~text
API-IDEMPOTENCY-IN-PROGRESS
API-IDEMPOTENCY-CONFLICT
API-RATE-LIMITED
API-REQUEST-TOO-LARGE
API-UNSUPPORTED-MEDIA-TYPE
~~~

這些只處理 transport/shared concern；domain error仍使用 Fxx-ERR-*。

# 14. Request Size

Default JSON request body ceiling：512 KB。

更低的 Function / F02 ceiling優先。

F07 event batch ceiling維持 256 KB。

# 15. Security

- no secrets in Client payload。
- public identifiers opaque。
- Client不能提交 trust_status / authorization claim當 truth。
- raw user content不得放 URL query。
- CORS / CSRF策略由Web deployment實作，但 mutation endpoint不得接受跨站無約束寫入。
- request logs預設不保存 raw sensitive body；debug raw payload最多7 days且 access-controlled。

# 16. Traceability

Function endpoint必須可追：

~~~text
request_id
trace_id when server processing exists
anonymous_id when applicable
Function ID
intent/share/correction/blueprint reference when applicable
stable error code
~~~

# 17. Acceptance

- Shared API mutation遵守24h idempotency contract。
- stale concurrency token不能覆蓋新 state。
- event batch不需 Idempotency-Key但event_id dedupe有效。
- all errors符合common envelope，除static/canonical body endpoint。
- 429含stable error semantics與Retry-After資訊。
- Function不能自創第二套request_id/error envelope/versioning。

# Conclusion

Shared API規則只定 transport/control semantics；Function-specific business contract仍留在 Fxx。