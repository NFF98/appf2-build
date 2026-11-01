# appf2 Execution Admission Contract

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED / Phase 1 — Working Current Truth。
> Build Freeze / implementation boundary：`working/common-core/DESIGN-TO-DELIVERY.md`。
> Canonical Role：把 immutable Blueprint content、有效的 Share/Intent 讀取權限及 mutable current execution trust 分成三道不同閘門，防止舊快取或洩漏的 hash 繞過 revoke / incompatibility。

# 1. Problem

Blueprint body以 content_hash 指定 immutable 內容，**但必須先驗證讀取權限、禁止公共 CDN body cache**；blueprint_content.trust_status 仍可變。

因此：

~~~text
Possessing a Blueprint Hash / Cached Body
≠
Current Permission To Read
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

Read requires a valid, server-verified Share or Original Intent authorization (§8.1); no account login is required merely to receive a public Share. Hash alone is NEVER sufficient.

Public request path包含 `content_hash`，另外必須提交 §8.1 的有效 Share context 或 Intent access grant。Client不得在 body/query/header提供 `trust_status`、`executable`、`runtime_version`、`registry_version`、`registry_digest` 或 Registry object來覆寫 trusted decision。

Server flow：

~~~text
content_hash
→ load immutable Blueprint + current blueprint trust_status
→ verify persisted body/content_hash/schema_version/registry_version integrity
→ select exact pinned Registry v7 release bundle for Blueprint.registry_version + admitted registry_digest
→ select deployment current execution Registry v7 release bundle
→ verify both bundles against trusted append-only RegistryReleaseLedger
→ verify pinned RuntimeRegistry artifact + direct Node registration keys against actual TrustedRuntimeHandlerCatalog
→ construct trusted ExecutionRuntimeContext
→ F02 assertExecutable(contentHash, runtimeContext)
→ schema / pinned release identity / runtime compatibility
→ re-check full Blueprint execution reference set against current release
→ admission response
~~~

Trusted internal context：

~~~text
RegistryReleaseIdentity = {
  registry_version: SemVer,
  registry_digest: sha256,
  validator_registry_digest: sha256,
  runtime_registry_digest: sha256
}

RegistryReleaseBundle = {
  identity: RegistryReleaseIdentity,
  validator_registry: trusted generated ValidatorRegistry v7,
  runtime_registry: trusted generated RuntimeRegistry v7
}

ExecutionRuntimeContext = {
  runtime_version: SemVer,
  supported_blueprint_schema_range: SemVerRange,
  registry_snapshot: RegistryReleaseBundle,
  current_registry_snapshot: RegistryReleaseBundle,
  trusted_release_ledger: trusted append-only RegistryReleaseLedger,
  trusted_runtime_handler_catalog: server/deployment-owned actual bundled handler keys,
  now: trusted server time
}
~~~

`ExecutionRuntimeContext` 只能由 appf2 server/deployment truth建立；public caller沒有 authority選 release bundle、版本、任何 digest、Registry artifact或 release ledger。

BF-040 dual-release rule：

- `registry_snapshot` = Blueprint pinned historical interpretation + Runtime binding truth。
- `current_registry_snapshot` = deployment current execution authority；可以是較新的 Registry version。
- 每個 bundle identity = `registry_version + registry_digest + validator_registry_digest + runtime_registry_digest`，全部必須存在於 trusted append-only release ledger，且 validator/runtime artifact digest可由 exact artifact body重算成立。
- revoke/disable必須透過發布新的 Registry version + full digest tuple進入 current release；禁止原地改 historical artifact或保留舊 release identity。
- current release lookup/load/integrity若失敗 → E08 503；不得用 pinned release fallback成 allow。
- same exact Blueprint execution ref在 current vs pinned若都存在，`execution_contract_digest` 與 `runtime_binding_digest` 都必須一致；只有 `availability` / `execution_status` 可在不 bump Capability version下改變。
- pinned RuntimeRegistry是 old Blueprint實際 handler binding；current release只做 eligibility，不可換掉 pinned handler。

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
    "registry_version": "7.0.0",
    "registry_digest": "...",
    "validator_registry_digest": "...",
    "runtime_registry_digest": "...",
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

Protected body must NOT use public CDN cache. Return `Cache-Control: private, no-store` with authorization-sensitive Vary; admission maintains its existing §5 freshness/cache semantics.

### 8.1 Human-approved private hash-read authorization — Option A, 2026-10-11

**Binding ruling:** User/Human approved: `GET /b/{content_hash}` only after validating an effective Share or original Intent permission; `content_hash` is content identity, **never bearer authorization**. The same rule applies to `GET /api/v1/blueprints/{content_hash}/execution-admission` to prevent leaking private trust/eligibility metadata. Authorization must precede any response with body or trust details.

1. **Share recipient:** Same-origin request header `X-Appf2-Share-Id: <share_id>`, with server verified ShareStore lookup on **every request**: canonical v4 Share ID, ACTIVE, not expired, exact `blueprint_hash === requested content_hash`, and server-approved trust status. `share_id` is an intentionally distributed public sharing reference and permits reading **only the referenced Blueprint**; it is not an arbitrary hash. Missing, mismatched, expired or revoked Share fails closed. No User may create a new Share for an arbitrary known hash (F05 owner `F05-API-001`).
2. **Original Intent holder:** The existing F01 scoped cookie `Path=/api/v1/intents/<intent_id>/` is retained (never loosen it to `/`). The first-party browser calls `GET /api/v1/intents/{intent_id}/blueprint-access-grant?content_hash=<hash>` with valid scoped cookie and per-intent P-256 signed read proof (see F01-API-ID-001B). Server checks durable F01→F02 admitting lineage for the exact intent and hash, then may issue server-signed `intent_blueprint_access_grant` with `intent_id, content_hash, key_thumbprint, expires_at<=now+60s, audience={blueprint:read,share:create}`. Keep token browser memory-only, never URL/log/telemetry. For the existing `/b/{hash}` and execution-admission endpoint, send `Authorization: Bearer <intent_blueprint_access_grant>`. Server validates signature, expiry, audience `blueprint:read`, F01/F02 lineage and current permissions on **every read**. Grant is not F03 execution admission.
3. F01 signed GET read-proof: `X-Appf2-PoP-Key` (SPKI DER base64url), `X-Appf2-PoP-Signature` (P1363 64-byte ECDSA signature base64url), `X-Appf2-PoP-Timestamp` (canonical epoch millisecond decimal). Signed UTF-8 exact JSON array `["APPF2_READ_PoP_V1","GET",actualURL.pathname,content_hash,timestampMs]` with timestamp safe-integer Number, clock ±90s. Server checks verified P-256 key association, cookie/intent/hash, first-party Origin/fetch metadata and exact query (only content_hash). This GET is read access, **no mutation idempotency key** and no second intent.
4. Denials for hash-only, missing/expired/revoked/mismatch Share, foreign Intent, invalid signature/cookie/grant, or unknown hash all return indistinguishable `404 / API-RESOURCE-NOT-FOUND` (no resource/ownership leak). If a trusted DB/identity/share dependency fails, `503 / API-ADMISSION-TEMPORARILY-UNAVAILABLE`, never cached allow or false 404. The HTTP distinction is dependent on verified authoritative lookup, not attacker-provided status.
5. Authorized `/b/{hash}` returns immutable canonical JSON and hash-consistent body with `Cache-Control: private, no-store`, `Vary: Authorization, X-Appf2-Share-Id`, `Referrer-Policy: no-referrer`. Neither shared CDN nor third-party/proxy cache may reuse the body. Existing `5 admission result freshness `Cache-Control: private, max-age=0, must-revalidate` persists **after** authorization with corresponding Vary. Access permission and fresh `executable=true` are separate gates; valid Share/body does not override revocation.
6. **Mandatory negative proofs:** hash-only, foreign/mismatched/expired/revoked Share, Share creation using only known hash/UUID, cookie-only, PoP-only, foreign intent, lost key, forged/expired read grant, CDN cross-user cache, DB read failure, revoked execution while body exists. Positive proofs: live ACTIVE Share→same hash body; original signed Intent→only its own hash; neither can hydrate F03 without fresh independent admission.

**Scope:** This changes legacy public hash read/CDN assumptions; no automatic migration/old-client bypass. F05/Shared API/F01/F12 are required co-owners. This Draft is not a Build Freeze or shipped access-control implementation.

# 9. Failure / Denial Precedence

Fresh admission使用以下 deterministic precedence；第一個成立的 denial結束本次 request，不繼續找「比較好看的」allow path：

~~~text
E01 content_hash unknown
    → HTTP 404

E02 blueprint_content.trust_status = REVOKED
    → F02-ERR-016 / F12 terminal-safe recovery

E03 blueprint_content.trust_status = INCOMPATIBLE
    → F02-ERR-017 / F12 compatibility recovery

E04-A trust_status != VALIDATED
    → deny fail-closed

E04-B durable content integrity failure after a successful repository read:
      canonical body re-hash != content_hash
      OR persisted schema_version != body.schema_version
      OR persisted registry_version != body.registry_version
    → F02-ERR-015 HASH_INTEGRITY_FAILURE
    → non-retryable / never executable=true

E05 Blueprint schema outside server supported range
    → F02-ERR-017

E06 deterministic pinned release incompatibility:
      trusted release ledger has no pinned release for body.registry_version + admitted registry_digest
      OR returned pinned release identity/artifact digest does not match that immutable ledger entry
      OR pinned Registry machine major is unsupported (no explicit adapter)
    → F02-ERR-017

E07 current release bundle is valid, but current execution eligibility fails.

    BlueprintExecutionRefSet =
      unique(nodes[].capability ∪ support.degradations[].capability_refs[])

    for every ref in BlueprintExecutionRefSet:
      current release missing exact ref
      OR current execution_contract_digest != pinned same-ref digest
      OR current runtime_binding_digest != pinned same-ref digest
      OR current availability != ENABLED
      OR current execution_status = REVOKED
      OR execution_class unsupported
      OR Blueprint schema / trusted runtime incompatible
      → deny

    required dependency resolution:
      collect current-release versions matching versionRange
      sort SemVer descending
      candidate must be ENABLED + ACTIVE + supported execution_class
      + schema/runtime compatible + transitively eligible
      if same exact candidate ref also exists in pinned release:
        execution_contract_digest AND runtime_binding_digest must match pinned
      if candidate exact version is new and absent from pinned:
        it may satisfy requirement when versionRange + current eligibility pass
      first fully eligible candidate satisfies requirement
      if none qualifies → parent CAPABILITY_DEPENDENCY_UNAVAILABLE

    → F02-ERR-017
      (internal diagnostics may retain exact nested F04 reason/ref; public execution authority remains denied)

E08 temporary/deployment infrastructure failure at any admission read/load boundary:
      blueprint repository read throws/times out
      OR pinned release lookup/load throws/times out
      OR current release lookup/load/integrity verification fails
      OR trusted release ledger cannot be loaded/verified
      OR pinned RuntimeRegistry / TrustedRuntimeHandlerCatalog verification cannot be completed
    → HTTP 503 / retry, never executable=true

otherwise
    → executable=true admission, expires_at <= issued_at + 30 seconds
~~~

Capability REVOKED 在 fresh execution check造成 Blueprint **currently incompatible to execute**，使用 F02-ERR-017；F02-ERR-016只保留給 blueprint_content 自身 durable trust_status=REVOKED，避免兩種 revocation identity混淆。

Current Registry policy update不得偷偷覆寫 same-version release：例如 `7.0.0/release-A ACTIVE` 要 revoke時，必須發布 PATCH release `7.0.1/release-B REVOKED`；execution_contract_digest / runtime_binding_digest不變，但 registry/validator/runtime artifact digests形成新的 immutable ledger entry。Test fixture也必須遵守；禁止「改 lifecycle但保留同 release tuple」。

Temporary admission failure不得 fallback成 allow。Content body cache hit、Share ACTIVE、validation曾經PASSED、same-hash content REUSED都不是 allow substitute。

### 9.1 Option A — public HTTP denial mapping (PG001/T006 L2 review delta)

本節把 §9 已有的 E01–E08 判斷順序具體化為 HTTP contract；不改 durable trust precedence、≤30 秒 admission freshness 或 §5 既有快取規則。所有 denial 都不得包含 `executable=true`，client 不得覆寫任一 server decision。

| First-matching condition | HTTP | Stable public error code | retryable | Recovery |
|---|---:|---|---|---|
| E01 content_hash 不存在 | 404 | `API-RESOURCE-NOT-FOUND` | false | 不揭露其他 resource 狀態 |
| E02 durable trust REVOKED | 410 | `F02-ERR-016` | false | F12 terminal-safe restart |
| E03 durable trust INCOMPATIBLE | 422 | `F02-ERR-017` | false | F12 compatibility recovery |
| E04-A durable trust 非 VALIDATED（且不屬 E02/E03） | 422 | `F02-ERR-017` | false | fail closed；不可用 stale body allow |
| E04-B durable content hash/schema/registry mismatch | 500 | `F02-ERR-015` | false | integrity terminal；不回傳 sensitive diagnostics |
| E05 blueprint schema unsupported | 422 | `F02-ERR-017` | false | F12 compatibility recovery |
| E06 pinned release identity/ledger 不符 | 422 | `F02-ERR-017` | false | F12 compatibility recovery |
| E07 current runtime release/dependency 不可執行 | 422 | `F02-ERR-017` | false | F12 compatibility recovery |
| E08 trusted dependency temporary unavailable | 503 | `API-ADMISSION-TEMPORARILY-UNAVAILABLE` | true | retry，不能 fallback allow |
| allow | 200 | n/a | n/a | fresh admission `expires_at <= issued_at + 30s` |

Denial 統一採 Shared API §6 `{request_id,error:{code,message_key,retryable,retry_after_seconds,details}}`；`details` 只能有 bounded non-sensitive diagnostic key，不能帶 SQL、stack、internal Registry bundle、secrets 或另一 intent 的 existence/lineage。E08 才是 transient retryable；E04-B integrity failure 不得假扮 E08。所有路徑維持 `Cache-Control: private, max-age=0, must-revalidate`，禁止 stale executable allow。

F12 必須為既有 `F02-ERR-015/016/017` 與新增兩個 Shared API code 提供可見的 terminal/compatibility/retry recovery，不能把未支援的 recovery route 當作已實作；本 Review PR 不直接修改 F12 owner。

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
- Deployment current execution release中任一 Node/degradation CapabilityRef變成 DISABLED / REVOKED / dependency unavailable / dependency schema-runtime incompatible / runtime incompatible時，即使 immutable body過去已VALIDATED，fresh Runtime仍不能hydrate。
- Same exact execution ref若 current release的 execution_contract_digest **或** runtime_binding_digest與 pinned不同，fresh Runtime不能hydrate。
- Same exact dependency candidate若 pinned/current雙方都有該 exact ref但任一 identity digest drift，該 candidate不得滿足 dependency。
- Current release取得/驗證暫時失敗時回 E08，不得退回 pinned old policy allow。
- Same-version lifecycle mutation即使 per-Capability execution_contract_digest不變，也必須因 validator_registry_digest / trusted release-ledger mismatch被拒絕。
- pinned RuntimeRegistry或 direct Node handler completeness無法證明時不得發 executable=true。
- persisted canonical body hash/schema/registry metadata不一致 → F02-ERR-015；repository temporary failure → E08，兩者不得混用。
- Client提供假的 `trust_status=VALIDATED` / `executable=true` / version / digest不能改變 server decision。
- Same-hash content reuse不重設 durable REVOKED/INCOMPATIBLE trust，也不自動產生 execution authority。
- admission temporary failure不fail-open。
- normal Runtime interaction READY後不需要每次event重查admission。

# Conclusion

Immutable body可以快取；是否現在可以執行，永遠是fresh mutable decision。BF-040 之後，這個 decision必須同時證明 durable content integrity、pinned v7 release identity/handler binding與current v7 eligibility；任何一層無法證明都不得 executable=true。