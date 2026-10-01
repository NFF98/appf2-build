# appf2 Execution Admission Contract

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED / Phase 1 — Working Current Truth。
> Build Freeze / implementation boundary：`working/common-core/DESIGN-TO-DELIVERY.md`。
> Canonical Role：把 immutable Blueprint content delivery 與 mutable current trust / compatibility decision分開，確保 CDN舊body不能繞過 revoke / incompatibility。

# 1. Problem

Blueprint body以 content_hash immutable CDN cache；但 blueprint_content.trust_status可變。

因此：

~~~text
Cached Blueprint Body
≠
Current Permission To Execute
~~~

# 2. Canonical Rule

每次建立 fresh Runtime Instance前，F03必須持有 fresh ExecutionAdmission。

~~~text
Blueprint body by content_hash
+
fresh ExecutionAdmission for same content_hash
→ hydrate allowed
~~~

沒有 admission、expired admission、hash mismatch、revoked/incompatible → 不進 READY。

# 3. Admission Endpoint

~~~text
GET /api/v1/blueprints/{content_hash}/execution-admission
~~~

Public read；不要求 account。

Server flow：

~~~text
content_hash
→ F02 assertExecutable(contentHash, runtimeContext)
→ current blueprint trust_status
→ schema compatibility
→ registry compatibility
→ runtime compatibility
→ admission response
~~~

# 4. ExecutionAdmission Shape

~~~json
{
  "request_id": "req_...",
  "data": {
    "admission_version": "1.0.0",
    "admission_id": "uuid",
    "content_hash": "sha256:...",
    "executable": true,
    "trust_status": "VALIDATED",
    "schema_version": "1.0.0",
    "registry_version": "1.0.0",
    "registry_digest": "...",
    "runtime_version": "...",
    "issued_at": "...",
    "expires_at": "..."
  }
}
~~~

Denied response使用 source F02/F03/F04 stable error semantics，不返回 executable=true。

# 5. Freshness

Phase 1 admission validity：

~~~text
30 seconds maximum
~~~

HTTP：

~~~text
Cache-Control: private, max-age=0, must-revalidate
Edge internal metadata cache <= 15 seconds
no stale-if-error for executable=true
~~~

Security/admin revoke應觸發 resolver metadata cache purge；即使purge失敗，最晚15秒後重新讀 durable truth。

# 6. F03 Hydration Requirement

create/hydrate Runtime必須驗：

~~~text
admission.executable = true
admission.content_hash = Blueprint content_hash
now < admission.expires_at
trust_status = VALIDATED
schema / registry / runtime compatibility match
~~~

Runtime不得：

- 只因 body hash正確就執行；
- 使用昨天/上次session admission；
- network failure時沿用expired executable=true；
- silent recompile incompatible Blueprint。

# 7. F05 Share Restore

Share resolve只負責：

~~~text
share_id → content_hash
~~~

Recipient hydrate前仍取得 fresh ExecutionAdmission。

Share mapping ACTIVE不等於 Blueprint executable；兩個 gate都要通過。

# 8. Direct Blueprint Delivery

~~~text
GET /b/{content_hash}
~~~

只交付 immutable canonical body；它不是 execution authorization endpoint。

因此 CDN可長快取 body，而 admission保持fresh。

# 9. Failure

~~~text
unknown hash → 404
REVOKED → F02-ERR-016 / F12 terminal-safe recovery
INCOMPATIBLE → F02-ERR-017 / F12 compatibility recovery
registry/runtime mismatch → typed F02/F03/F04 error
admission service temporary failure → 503 / retry
~~~

Temporary admission failure不得 fallback成 allow。

# 10. Evidence

至少：

~~~text
F02-EVT-010 execution_admission_requested
F02-EVT-011 execution_admission_allowed
F02-EVT-012 execution_admission_denied
F02-EVT-013 execution_admission_failed
~~~

正式 event ID 以 `working/detailed-design/registries/evidence-event-registry.json` 為 Current Truth；Build Freeze 時投影到 appf2-build locked baseline。

# 11. Acceptance

- Cached Blueprint body存在但trust_status=REVOKED時，fresh Runtime不能hydrate。
- Expired admission不能hydrate。
- Admission hash mismatch不能hydrate。
- Share ACTIVE但Blueprint INCOMPATIBLE時不能hydrate。
- admission temporary failure不fail-open。
- normal Runtime interaction READY後不需要每次event重查admission。

# Conclusion

Immutable body可以快取；是否現在可以執行，永遠是fresh mutable decision。