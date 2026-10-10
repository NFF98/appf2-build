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

它是讀取 fresh ExecutionAdmission 的 endpoint，**須依 §12.3 先驗有效 Share/Intent read authorization**；不能因舊分類 PUBLIC_READ 就允許 hash-only 讀取。它不是 immutable Blueprint body endpoint。

# 12.2 Phase 1 F01 per-intent mutation proof (PG001/T006 L2 review delta)

這是 F01 CREATE/answers/compile 的 **Function-specific exception and explicit wire contract**，不是把全體 Shared API POST 更改為 PoP，也不將 `anonymous_id` 升級為認證。

- 對 `POST /api/v1/intents`，每個新的 logical CREATE 生成單獨非可匯出的 WebCrypto ECDSA P-256 私鑰；`Idempotency-Key` 固定為 `appf2-create-v1.<keyThumbprint>`，該 thumbprint 為公開 SPKI DER 的 SHA-256/base64url。瀏覽器以同一密鑰及同一 logical body 在 24h 重試，重新簽署新 timestamp；重試不能建立第二個 intent。
- CREATE / answers / compile 使用 `X-Appf2-PoP-Key`（SPKI DER base64url）、`X-Appf2-PoP-Signature`（P1363 64-byte raw ECDSA signature base64url）、`X-Appf2-PoP-Timestamp`（Unix epoch milliseconds decimal ASCII、無符號、不能有前置零）；signature input 是 UTF-8 `JSON.stringify(["APPF2_MUTATION_PoP_V1", method, path, base64url(sha256(rawBodyBytes)), Idempotency-Key, timestampMs])`。`timestampMs` 在 JSON transcript 中是安全整數 Number，從 header canonical decimal 嚴格解析後再序列化，不是 String；method 使用 uppercase HTTP method；path 在 Browser 與 server 都以 Web URL parser 對請求 URL 取得的 `pathname` 序列化（保留百分比編碼），由 server 依實際請求重新計算、不可採 client 自報 route；不包含 query 或 fragment。timestamp 允差 ±90s；只驗證簽章/時鐘不足以取代 idempotency。
- API host 驗證 first-party Origin + configured allowed origin，跨站、簽章/headers 缺失或不符均於 durable mutation 前拒絕。`anonymous_id` 不得作權限證明。
- CREATE 通過 PoP 後，server 發 intent scoped, signed continuity cookie，HttpOnly/Secure/SameSite=Lax 且 `Path=/api/v1/intents/<intent_id>/`，最多 24h。answers/compile 必須同時有有效 scoped cookie 與同把私鑰新簽章，且與 durable intent/anonymous continuity 完全相符；只有 cookie 或只帶任意 anonymous UUID 均不得授權。
- Legacy 無 PoP 的 client 必須先升級，再建立新的 CREATE；不靜默放行 unsigned CREATE 或用 global cookie 修補 key-loss。若本地 private key 遺失，顯示明確 restart/recreate 提示；既有 intent 不得以 UUID 猜回。這個切換屬相容性變更，須經 Human Design review/rebaseline 才能作正式 Client/Server 一起部署。
- P-256 nonextractable key 不是抵抗 XSS 的保證；在 ±90s 內攔截的有效 signed request 仍可能重播。F01 24h idempotency/CAS 必須封住 duplicate side effect；Browser 必須保持已存 key/body 的同 logical retry identity。
- 永遠不得把 PoP signature、本地 private key、cookie、DB password 或原始 User Content 放入 telemetry/GitHub Evidence。要有缺失/錯誤 PoP、wrong intent、cross-origin、replay、key loss、legacy upgrade 以及 foreign intent non-disclosure 的對應測試。

### 12.3 Private content-hash read access / Share creation gate (Human approval 2026-10-11)

Human approval: **knowing `content_hash` alone never authorizes reading the canonical Blueprint**. Existing `GET /b/{content_hash}` and `GET /api/v1/blueprints/{content_hash}/execution-admission` require a server-verified Share or original Intent access path before exposing body or private trust/eligibility metadata.

- Share recipient: `X-Appf2-Share-Id: <share_id>`, server resolves live ACTIVE non-expired Share and exact hash binding **on each read**; HTTP 404 hides unknown, invalid, revoked, expired, foreign or mismatched Share. This is a deliberate scoped public Share capability, not login or hash authorization.
- Original Intent: first-party `GET /api/v1/intents/{intent_id}/blueprint-access-grant?content_hash=<hash>` uses F01 intent-scoped signed cookie **plus** matching nonextractable P-256 key's fresh GET signature; successful F01→F02 admitting lineage permits a short (≤60s) signed `intent_blueprint_access_grant` with exact hash/intent/key thumbprint and `blueprint:read, share:create` audiences. Signed proof transcript and errors owned by `F01-API-ID-001B`. Browser sends `Authorization: Bearer <grant>` for allowed reads and `POST /api/v1/shares`; issuer/signature/expiry/scope/lineage/current trust must be revalidated by server.
- Share CREATE endpoint (`F05-API-001`) must require original Intent grant with `share:create` and exact `source_intent_id` / hash binding. No public anonymous-UUID/hash-only share-minting.
- Every private body response `Cache-Control: private, no-store`, `Vary: Authorization, X-Appf2-Share-Id`, `Referrer-Policy: no-referrer`; no CDN/shared proxy caching. Grant issue response also `private, no-store`. Admission retains locked `Cache-Control: private, max-age=0, must-revalidate`, but after authorization and with correct `Vary`. Content immutability is independent of public cacheability.
- Unauthorized/missing/expired/foreign credential or hash => uniform `404 / API-RESOURCE-NOT-FOUND`; trusted authority/DB unavailable => `503 / API-ADMISSION-TEMPORARILY-UNAVAILABLE`. Authz checked **before** content/trust disclosure, with no stale grant fallback. The established E02–E08 and F12 semantics apply only after authorized access.
- This is an explicit breaking API/privacy delta; follow Human-reviewed Product Freeze, client cutover and tests. Do not replace F01 PoP scoped cookie with root/global cookie or treat grant as F03 executable permission.

# 13. Canonical Shared API Errors

~~~text
API-IDEMPOTENCY-IN-PROGRESS
API-IDEMPOTENCY-CONFLICT
API-RATE-LIMITED
API-REQUEST-TOO-LARGE
API-UNSUPPORTED-MEDIA-TYPE
API-RESOURCE-NOT-FOUND
API-ADMISSION-TEMPORARILY-UNAVAILABLE
~~~

這些只處理 transport/shared concern；domain error仍使用 Fxx-ERR-*。

### 13.1 PG001 / T006 additional Shared API errors (L2 review candidate)

- `API-RESOURCE-NOT-FOUND`: E01 unknown `content_hash` OR protected hash read with unauthorized/missing/revoked/foreign Share/Intent grant (indistinguishable); HTTP 404, `retryable=false`, stable `message_key=recovery.api.resource_not_found`. 不暴露 Blueprint 是否曾存在或他人私有狀態；F12 返回 Home。
- `API-ADMISSION-TEMPORARILY-UNAVAILABLE`: E08 trusted repository/release/admission dependency failure；HTTP 503, `retryable=true`, stable `message_key=recovery.api.admission_temporarily_unavailable`. 僅可在安全邊界內 retry；不得從 stale/cached `executable=true` 降級放行。
- 兩者的 F12 恢復投影由 `working/detailed-design/registries/recovery-registry.json` 的同名 draft entries 擁有。它們不是 F01 私有 mutation 授權錯誤，也不可取代 F02 integrity / revoked / incompatible IDs。
- 此新增列入本 Draft PR 的 Design/Registry 一致性審核；**未經 Human Build Freeze/rebind 前不得冒稱為 locked Build Spec**。

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