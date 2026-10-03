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

Public request只攜帶 path `content_hash`。Client不得在 body/query/header提供 `trust_status`、`executable`、`runtime_version`、`registry_version`、`registry_digest` 或 Registry object來覆寫 trusted decision。

Server flow：

~~~text
content_hash
→ load immutable Blueprint + current blueprint trust_status
→ server selects exact pinned Registry snapshot for Blueprint.registry_version
→ server selects deployment current execution Registry snapshot
→ construct trusted ExecutionRuntimeContext
→ F02 assertExecutable(contentHash, runtimeContext)
→ schema / pinned snapshot integrity / runtime compatibility
→ re-check every CapabilityRef against current execution snapshot
→ admission response
~~~

Trusted internal context：

~~~text
ExecutionRuntimeContext = {
  runtime_version: SemVer,
  supported_blueprint_schema_range: SemVerRange,
  registry_snapshot: {
    registry_version: SemVer,
    registry_digest: sha256,
    validator_registry: trusted generated Registry v6 snapshot
  },
  current_registry_snapshot: {
    registry_version: SemVer,
    registry_digest: sha256,
    validator_registry: trusted generated Registry v6 snapshot
  },
  now: trusted server time
}
~~~

`ExecutionRuntimeContext` 只能由 appf2 server/deployment truth建立；public caller沒有 authority選 snapshot或版本。

BF-039 dual-snapshot rule：

- `registry_snapshot` = Blueprint pinned historical interpretation truth。
- `current_registry_snapshot` = deployment current execution authority；可以是較新的 Registry version。
- revoke/disable必須透過發布新的 Registry version/digest進入 current snapshot；禁止原地改 historical snapshot或保留舊 digest。
- current snapshot lookup/integrity若因 infrastructure失敗 → E08 503；不得用 pinned snapshot fallback成 allow。
- same exact CapabilityRef在 current vs pinned snapshot的 `execution_contract_digest` 必須一致；只有 `availability` / `execution_status` 可在不 bump Capability version下改變。

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
    "registry_version": "6.0.0",
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

# 9. Failure / Denial Precedence

Fresh admission使用以下 deterministic precedence；第一個成立的 denial結束本次 request，不繼續找「比較好看的」allow path：

~~~text
E01 content_hash unknown
    → HTTP 404

E02 blueprint_content.trust_status = REVOKED
    → F02-ERR-016 / F12 terminal-safe recovery

E03 blueprint_content.trust_status = INCOMPATIBLE
    → F02-ERR-017 / F12 compatibility recovery

E04 trust_status != VALIDATED
    → deny fail-closed

E05 Blueprint schema outside server supported range
    → F02-ERR-017

E06 Blueprint pinned Registry snapshot unavailable
    OR pinned registry_version/digest integrity mismatch
    → F02-ERR-017

E07 current execution Registry snapshot is valid, but any referenced Capability current eligibility fails:
    current snapshot missing exact direct ref
    direct ref execution_contract_digest != pinned snapshot same ref digest
    current availability != ENABLED
    current execution_status = REVOKED
    execution_class unsupported
    Blueprint schema or trusted runtime outside current capability compatibility range
    required dependency has no recursively eligible version

    required dependency resolution:
      collect current-snapshot versions matching versionRange
      sort SemVer descending
      first candidate that is ENABLED + ACTIVE + supported execution_class
        + schema compatible + runtime compatible
        + all transitive required dependencies recursively eligible
      satisfies requirement
      if none qualifies → parent CAPABILITY_DEPENDENCY_UNAVAILABLE

    → F02-ERR-017
      (internal diagnostics may retain exact nested F04 reason/ref; public execution authority remains denied)

E08 current execution Registry snapshot lookup/integrity failure
    OR other admission infrastructure temporary failure
    → HTTP 503 / retry, never executable=true

otherwise
    → executable=true admission, expires_at <= issued_at + 30 seconds
~~~

Capability REVOKED 在 fresh execution check造成 Blueprint **currently incompatible to execute**，使用 F02-ERR-017；F02-ERR-016只保留給 blueprint_content 自身 durable trust_status=REVOKED，避免兩種 revocation identity混淆。

Current Registry policy update不得偷偷覆寫 same-version snapshot：例如 `6.0.0/digest-A ACTIVE` 要 revoke時，必須發布 policy PATCH snapshot `6.0.1/digest-B REVOKED`（execution_contract_digest不變）並將其設為 deployment current execution snapshot。Test fixture也必須遵守此規則；禁止「改 execution_status但保留同 registry_version/digest」。

Temporary admission failure不得 fallback成 allow。Content body cache hit、Share ACTIVE、validation曾經PASSED、same-hash content REUSED都不是 allow substitute。

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
- Deployment current execution Registry snapshot中任一 referenced Capability變成 DISABLED / REVOKED / dependency unavailable / dependency schema-runtime incompatible / runtime incompatible時，即使 immutable body過去已VALIDATED，fresh Runtime仍不能hydrate。
- Same exact direct CapabilityRef若 current snapshot的 execution_contract_digest與 Blueprint pinned snapshot不同，fresh Runtime不能hydrate。
- Current execution snapshot取得/驗證暫時失敗時回 E08，不得退回 pinned old policy allow。
- Client提供假的 `trust_status=VALIDATED` / `executable=true` / version / digest不能改變 server decision。
- Same-hash content reuse不重設 durable REVOKED/INCOMPATIBLE trust，也不自動產生 execution authority。
- admission temporary failure不fail-open。
- normal Runtime interaction READY後不需要每次event重查admission。

# Conclusion

Immutable body可以快取；是否現在可以執行，永遠是fresh mutable decision。