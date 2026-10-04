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