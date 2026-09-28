# F05 — Share / Restore

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Share Creation、Public Share Resolution、Blueprint Restore、Recipient Entry UX 與 Share Reliability 的 Working Current Truth。
>
> 上游：DATA-MODEL、INFRA-ARCHITECTURE、F00 Experience Shell、F02 Blueprint Validation、F03 Runtime、DESIGN-TO-DELIVERY。
>
> 下游 / collaborators：F06 Remix / Refine、F07 Evidence、F08 Ownership、F12 Recovery。
>
> Phase 1 的分享核心是 immutable Blueprint，不是 Runtime Instance。Share link 讓 recipient 取得同一份 validated App definition，再在自己的 Browser 建立新的 Runtime Instance。

# 1. Purpose / User Outcome

User Outcome：

> User 做好一個 App 後，可以一鍵拿到穩定連結；Recipient 不必安裝、不必登入，就能直接打開並使用同一個 App。

Phase 1 canonical flow：

~~~text
Creator APP
→ Share
→ Durable Share Reference
→ /share/{share_id}
→ Resolve immutable Blueprint hash
→ Fetch canonical Blueprint
→ Trust / Compatibility Check
→ Create fresh F03 Runtime Instance
→ Recipient APP
~~~

成功標準：

~~~text
stable link
+ no install
+ no account before first value
+ same immutable Blueprint
+ safe restore
+ recipient can actually use it
+ failure is recoverable
~~~

# 2. Phase 1 Share Mode Decision

## F05-POL-001 — Default Share Mode

Phase 1 production default：

~~~text
DURABLE_REFERENCE
~~~

User-facing route：

~~~text
/share/{share_id}
~~~

它解析到：

~~~text
share_id
→ content_hash
→ immutable canonical Blueprint
~~~

理由：

- stable URL
- non-sensitive URL
- support analytics
- support lineage / future ownership
- support revocation / security governance
- avoid encoding Runtime inputs into URL
- preserve immutable Blueprint model

## F05-POL-002 — Portable Snapshot

Portable URL Fragment 模式保留在 Infra Architecture，但 Phase 1 不作 release-blocking production default。

Phase 1 可作 experiment / dev path，但：

- 不影響 Release 1 完成
- 不得包含 sensitive Runtime state
- 不得繞過 F02 validation / trust compatibility
- 不得建立第二套 Blueprint semantics

## F05-POL-003 — Live Room

Live Room 不屬 F05 Phase 1。

Realtime share 由 F09 承接。

# 3. Share Object Semantics

F05 使用 DATA-MODEL 的 share entity。

Phase 1 logical shape：

~~~text
Share
├─ share_id
├─ blueprint_hash
├─ created_by_anonymous_id?
├─ share_mode = DURABLE_REFERENCE
├─ status
├─ created_at
├─ expires_at?
└─ last_opened_at?
~~~

status：

~~~text
ACTIVE
REVOKED
EXPIRED
~~~

Rules：

1. Share 指向 Blueprint，不指向 Runtime Instance。
2. Share row 不保存 input state / result state。
3. Share row 不保存 provider/model data。
4. created_by_anonymous_id 是 attribution/evidence，不代表 durable ownership。
5. Phase 1 anonymous creator 不因此取得 account ownership。

# 4. Share ID

## F05-RQ-001

share_id 必須：

- opaque
- non-sequential
- unguessable enough for public URL
- URL-safe

Phase 1：

~~~text
UUID v4 canonical string
~~~

不得使用：

- auto-increment integer
- short sequential code
- content hash prefix alone

share_id 是 public reference，不是 secret credential；但仍必須避免 enumeration。

# 5. Share Creation Preconditions

## F05-RQ-002

只有以下 Blueprint 可以建立 Production Share：

~~~text
blueprint_content exists
AND trust_status = VALIDATED
AND current Runtime compatibility = COMPATIBLE
~~~

拒絕：

- Candidate
- REJECTED Blueprint
- REVOKED Blueprint
- INCOMPATIBLE Blueprint
- unknown content hash

Share creation 不重新 Compile。

# 6. Creator Share UX

## F05-UX-001

F00 APP Surface 的 Share CTA 打開 Share Overlay。

State：

~~~text
CLOSED
→ CREATING
→ READY
   ├─ COPY_SUCCESS
   └─ SHARE_SHEET_OPEN
→ FAILED
~~~

Minimum UI：

~~~text
Share this App
[Create / Copy Link]

after success:
share URL
Copy Link
Native Share when supported
Close
~~~

Rules：

1. Share 失敗不離開 current App。
2. Share creation 不顯示 raw content_hash。
3. Share pending 不 lock Runtime normal interaction。
4. duplicate tap 不建立多個 logical share。
5. copy failure 只影響 copy action，不失效 share。
6. Native Web Share API 是 convenience，不是 dependency。

# 7. Phase 1 Share Privacy

## F05-SEC-001

Default share URL 只含：

~~~text
/share/{share_id}
~~~

不得附：

- Runtime input
- Result snapshot
- raw Prompt
- anonymous_id
- provider metadata
- sensitive query parameters

## F05-SEC-002

建立 Share 前，F05 不需要掃描 Runtime state，因為 Runtime state根本不進 Share。

如果未來要分享 Instance Snapshot，必須是新 explicit contract，不可擴張現有 share row偷偷做。

# 8. Public Restore State Machine

## F05-STATE-001

Recipient opening：

~~~text
OPEN_ROUTE
→ RESOLVING_SHARE
→ FETCHING_BLUEPRINT
→ CHECKING_TRUST
→ HYDRATING
→ READY
~~~

Failure：

~~~text
RESOLVING_SHARE
→ NOT_FOUND | EXPIRED | REVOKED

FETCHING_BLUEPRINT
→ BLUEPRINT_UNAVAILABLE

CHECKING_TRUST
→ INCOMPATIBLE | REVOKED | INVALID

HYDRATING
→ RECOVERABLE_FAILURE | FATAL_FAILURE
~~~

F00 將這些映射成人話；F12 提供 Recovery action。

# 9. Restore Semantics

## F05-RQ-003

Restore 不是「恢復 Creator 當時的畫面狀態」。

Restore 是：

~~~text
Share Reference
→ same immutable Blueprint
→ new fresh Runtime Instance
~~~

因此 Recipient 預設得到：

- same Blueprint definition
- same Blueprint initial state
- same Capability versions
- fresh RNG seed
- fresh timers
- no creator Runtime inputs
- no creator Result state

這是 Phase 1 privacy / reproducibility boundary。

# 10. Share Resolver Flow

## F05-RQ-004

Logical flow：

~~~text
GET /share/{share_id}
→ load appf2 Shell
→ resolve share mapping
→ verify share status
→ obtain content_hash
→ fetch /b/{content_hash}
→ fetch fresh ExecutionAdmission for content_hash
→ verify current trust / compatibility
→ F03 hydrate
~~~

Restore path 0 LLM。

Restore path不執行 F01。

# 11. Immutable Blueprint Delivery

Canonical Blueprint delivery route：

~~~text
/b/{content_hash}
~~~

Rules：

1. content_hash path resolves only admitted canonical Blueprint。
2. response body = canonical Blueprint JSON。
3. cache immutable Blueprint aggressively。
4. same hash永遠不得返回不同 body。
5. F03在 hydrate前必須取得 `working/common-core/EXECUTION-ADMISSION.md` 定義的 fresh ExecutionAdmission。
6. trust status本身不是 immutable；cached body不能當 execution permission。

因此：

> immutable content可長快取；mutable trust decision不能被永久快取成「永遠可執行」。

# 12. Cache Policy

## F05-POL-004

Blueprint content：

~~~text
content-addressed immutable
→ long CDN cache
~~~

Share mapping / status：

~~~text
mutable reference
→ short bounded Edge cache
~~~

Phase 1 target：

~~~text
share mapping edge TTL <= 60 seconds
~~~

Security revocation應能 purge / bypass cache。

不把 share mapping設定成 immutable。

# 13. API Conventions

F05沿用 cross-Function canonical `working/common-core/API-CONVENTIONS.md`：

~~~text
/api/v1
HTTPS
JSON UTF-8
X-Request-Id
Idempotency-Key for mutation POST
common success/error envelope
~~~

Shared API conventions已抽為唯一 cross-Function owner；F05只定 Share-specific endpoints / payload。

# 14. API 1 — Create Share

## F05-API-001

~~~text
POST /api/v1/shares
~~~

Request：

~~~json
{
  "anonymous_id": "uuid",
  "blueprint_hash": "sha256:...",
  "share_mode": "DURABLE_REFERENCE"
}
~~~

Header：

~~~text
Idempotency-Key: required
~~~

Success：

~~~json
{
  "request_id": "req_...",
  "data": {
    "share_id": "uuid-v4",
    "share_url": "/share/{share_id}",
    "blueprint_hash": "sha256:...",
    "status": "ACTIVE",
    "expires_at": null
  }
}
~~~

Rules：

1. same Idempotency-Key + same body → same logical share。
2. same key + different body → 409。
3. no account required。
4. Blueprint必須通過 preconditions。
5. API不接受 arbitrary canonical_blueprint body；只接受 admitted blueprint_hash。
6. Share creation本身不 mutation Blueprint。

# 15. API 2 — Resolve Share

## F05-API-002

~~~text
GET /api/v1/shares/{share_id}
~~~

Public read endpoint。

Success：

~~~json
{
  "request_id": "req_...",
  "data": {
    "share_id": "uuid-v4",
    "status": "ACTIVE",
    "blueprint_hash": "sha256:...",
    "blueprint_url": "/b/{content_hash}"
  }
}
~~~

不返回：

- creator anonymous ID
- internal DB metadata
- raw Intent
- ownership claims
- analytics data

Status mapping：

~~~text
ACTIVE → 200
EXPIRED → 410
REVOKED → 410
unknown → 404
~~~

# 16. API 3 — Blueprint Fetch

## F05-API-003

~~~text
GET /b/{content_hash}
~~~

Purpose：

> CDN-friendly immutable canonical Blueprint delivery。

Success：

~~~text
200
Content-Type: application/json
ETag: content_hash
immutable cache headers
~~~

Response body：

~~~text
canonical_blueprint
~~~

Failure：

- unknown hash → 404
- trust revoked/incompatible → resolver / execution gate blocks use
- storage temporary failure → 503 / F12 recovery

Implementation可由 Edge Resolver + BlueprintRepository 提供；不要求額外 app server hop。

# 17. Revocation / Expiry Phase Boundary

## F05-POL-005

Phase 1 status model保留 REVOKED / EXPIRED，但 self-service management不作 Release 1 blocker。

原因：

- anonymous identity不是 durable ownership
- 沒有 account時無可靠 cross-device owner authorization

Phase 1：

- system/security/admin 可以 revoke。
- explicit expires_at可由 product policy建立。
- anonymous creator UI不承諾永久管理 share。

F08 durable identity / ownership後，再加入 owner-authorized revoke / manage UX。

這避免用 Browser anonymous ID假裝 durable ownership。

# 18. Anonymous Recipient

## F05-RQ-005

Recipient：

- 不需 install
- 不需 login
- **預設先直接使用 Shared App（use as-is）**
- Restore同一 immutable Blueprint後建立自己的 fresh Runtime Instance；open / use本身不建立 child Blueprint或 lineage
- 可以建立自己的 anonymous_identity
- 可以再 Share
- 只有 User之後明確選 `改成我的版本`，才進 Remix

First value前不出現 registration wall。

# 19. Share → Remix

F05 restore READY 後先進 S03直接使用原 Shared App；F00可提供 `改成我的版本` Remix entry，但不得把 restore/open自動轉成 Remix。

~~~text
Shared Blueprint
→ Recipient uses App
→ Remix
→ F06 source_blueprint_hash
→ F01 semantic change
→ new immutable Blueprint
→ lineage = REMIX
~~~

F05 不建立 child Blueprint。

# 20. Data / DB Read-Write

F05 讀：

- blueprint_content by hash
- blueprint trust status
- share by share_id
- Runtime compatibility metadata

F05 寫：

- share
- last_opened_at optional bounded update

F05 不寫：

- Blueprint body
- Runtime Instance
- Result Snapshot
- ownership
- lineage on simple share/open

Recipient open本身不是 Remix，因此不建立 lineage。

# 21. last_opened_at

## F05-POL-006

last_opened_at 是 optional operational/product metadata。

Rules：

- 不要求每個 page refresh同步 write。
- 可 bounded / sampled / batched update。
- 不得使 Share Restore依賴這個 write成功。
- telemetry/product_event是主要 analytics truth；last_opened_at只是 convenience field。

# 22. Share Open Deduplication

F07正式 Evidence前，F05定 semantic rule：

~~~text
same recipient session
+ same share_id
+ repeated reload in short window
≠ 多個有意義 share_open outcome
~~~

Exact dedupe window由 F07 Evidence Schema定。

F05不靠 DB last_opened_at做精準 analytics。

# 23. Restore Compatibility

## F05-RQ-006

Recipient restore時必須透過 fresh ExecutionAdmission重新檢查：

~~~text
share status
blueprint trust
blueprint schema compatibility
registry compatibility
runtime compatibility
~~~

不能因為 Share建立當時可執行，就永久相信未來仍可執行。

Old Share URL仍保留 reference；若 Blueprint現在 incompatible：

~~~text
share still exists
but App cannot safely run in current Runtime
→ F12 recovery
~~~

不重新 Compile old Blueprint來「修」。

# 24. Recovery UX

F05將 technical failure交 F12，但至少分類：

Share create failure：

~~~text
keep current App
→ Retry Share
→ Copy later
~~~

Share not found：

~~~text
link unavailable
→ Go Home
→ Create new App
~~~

Expired / revoked：

~~~text
this shared App is no longer available
→ Go Home
~~~

Blueprint temporarily unavailable：

~~~text
preserve share URL
→ Retry
~~~

Incompatible：

~~~text
App exists but cannot safely run here
→ Retry after refresh
→ return Home
~~~

任何 restore failure不要求 Recipient重新輸入 Creator Prompt。

# 25. Error Taxonomy

| ID | Meaning | Retry | Preserve |
|---|---|---|---|
| F05-ERR-001 | SHARE_CREATE_INVALID_BLUEPRINT | NO | current App |
| F05-ERR-002 | SHARE_CREATE_FAILED | YES | current App |
| F05-ERR-003 | SHARE_NOT_FOUND | NO | route |
| F05-ERR-004 | SHARE_EXPIRED | NO | route |
| F05-ERR-005 | SHARE_REVOKED | NO | route |
| F05-ERR-006 | BLUEPRINT_FETCH_FAILED | YES | share reference |
| F05-ERR-007 | BLUEPRINT_TRUST_INVALID | NO | share reference |
| F05-ERR-008 | BLUEPRINT_INCOMPATIBLE | CONDITIONAL | share reference |
| F05-ERR-009 | RESTORE_HYDRATION_FAILED | CONDITIONAL | Blueprint reference |
| F05-ERR-010 | IDEMPOTENCY_CONFLICT | NO | existing share operation |
| F05-ERR-011 | SHARE_COPY_FAILED | YES | active share URL |
| F05-ERR-012 | INTERNAL_INVARIANT | NO | trace context |

# 26. Security / Privacy

- F05-SEC-001 Share URL不含 Runtime input/result。
- F05-SEC-002 Public resolve不返回 creator anonymous ID。
- F05-SEC-003 Share只能指向 admitted Blueprint hash。
- F05-SEC-004 Recipient不可信任 Client supplied trust flag。
- F05-SEC-005 Restore前重新做 trust / compatibility gate。
- F05-SEC-006 Revoked Blueprint不可因 CDN body仍存在而執行。
- F05-SEC-007 share_id不可 sequential/enumerable。
- F05-SEC-008 Blueprint delivery禁止 provider secrets。
- F05-SEC-009 Analytics failure不阻斷 Share Restore。
- F05-SEC-010 Native share / clipboard只使用 public share URL。

# 27. Frontend State

## F05-DATA-001

Creator Share Overlay：

~~~text
ShareUIState
├─ status: CLOSED | CREATING | READY | FAILED
├─ share_id?
├─ share_url?
├─ error_code?
└─ copy_status: IDLE | COPYING | COPIED | FAILED
~~~

Recipient Restore：

~~~text
RestoreUIState
├─ share_id
├─ status
├─ blueprint_hash?
├─ content_hash_fetch_status?
├─ runtime_instance_id?
└─ error_code?
~~~

這些是 Browser UI state，不是 durable truth。

# 28. Backend / Edge Processing

Create：

~~~text
Request
→ validate idempotency
→ assert Blueprint exists/trusted/compatible
→ create or return Share row
→ build public URL
→ response
~~~

Resolve：

~~~text
share_id
→ Edge Resolver
→ short-cache mapping/status
→ share row
→ content_hash
→ public safe response
~~~

Blueprint fetch：

~~~text
content_hash
→ CDN
→ miss: BlueprintRepository/Postgres
→ canonical JSON
→ immutable cache
~~~

# 29. No-LLM Restore Guarantee

## F05-RQ-007

Share Restore正常 path：

~~~text
0 Prompt A
0 Prompt B
0 LLM
0 Blueprint regeneration
~~~

Recipient看到的是同一 immutable App definition。

# 30. Evidence Seed

正式 envelope由 F07定義。

~~~text
F05-EVT-001 share_create_started
F05-EVT-002 share_created
F05-EVT-003 share_create_failed
F05-EVT-004 share_link_copied
F05-EVT-005 share_opened
F05-EVT-006 share_resolved
F05-EVT-007 share_restore_ready
F05-EVT-008 share_restore_failed
F05-EVT-009 shared_app_remix_opened
~~~

Minimum dimensions：

~~~text
function_id = F05
share_id
blueprint_hash
share_mode
recipient_session_id when available
error_code
runtime_version
schema_version
registry_version
trace_id
~~~

不收：

- creator Runtime inputs
- result values
- raw Intent

# 31. Product Metrics

F05支援：

~~~text
Share Create Success Rate
Share Link Copy Success Rate
Share Open → Restore Ready Rate
Share Restore Latency
Share Open → Meaningful Use Rate
Share Open → Remix Rate
Share Error / Recovery Rate
~~~

最重要不是 link click，而是：

> Recipient 是否真的成功進 App 並使用。

# 32. Acceptance Criteria

Share Creation：

- F05-AC-001 validated compatible Blueprint可建立 Durable Share。
- F05-AC-002 Candidate / revoked / incompatible Blueprint不可建立 production share。
- F05-AC-003 duplicate submit with same Idempotency-Key不建立 duplicate logical share。
- F05-AC-004 Share failure不破壞 current App。
- F05-AC-005 public Share URL不含 Runtime input/result/raw prompt。

Restore：

- F05-AC-006 Recipient不需 install。
- F05-AC-007 Recipient First Value前不需 account。
- F05-AC-008 valid ACTIVE share解析到原 immutable Blueprint hash。
- F05-AC-009 Share Restore不呼叫 LLM。
- F05-AC-010 Recipient建立fresh Runtime Instance，不取得 Creator Runtime state。
- F05-AC-011 revoked/expired share不 hydrate App。
- F05-AC-012 Runtime/Registry incompatible時不 silently reinterpret Blueprint。
- F05-AC-013 Blueprint fetch cache miss仍可由 durable source restore。
- F05-AC-014 CDN中存在 Blueprint body不能繞過 revoked trust gate。

UX / Recovery：

- F05-AC-015 Copy failure不使 Share失效。
- F05-AC-016 Restore transient failure可 retry且保留 Share reference。
- F05-AC-017 Share not found / expired / revoked有 humanized next action。
- F05-AC-018 Shared App READY後可進 Remix。

Evidence：

- F05-AC-019 share create/open/restore ready/failure可量測。
- F05-AC-020 telemetry不要求 Runtime input/result。
- F05-AC-021 Share Open與Restore Ready可區分，不能把 click當成功使用。
- F05-AC-022 Shared App Restore READY後可直接 use-as-is；單純 open / use不得建立 REMIX lineage，只有 User之後明確選 `改成我的版本`才進 F06 Remix。

# 33. Test Mapping Seed

~~~text
F05-AC-001 → TEST-F05-001 create validated share
F05-AC-002 → TEST-F05-002 reject invalid trust
F05-AC-003 → TEST-F05-003 share idempotency
F05-AC-005 → TEST-F05-005 URL privacy
F05-AC-008 → TEST-F05-008 stable share mapping
F05-AC-009 → TEST-F05-009 zero LLM restore
F05-AC-010 → TEST-F05-010 fresh instance
F05-AC-011 → TEST-F05-011 revoked/expired denial
F05-AC-012 → TEST-F05-012 compatibility gate
F05-AC-014 → TEST-F05-014 CDN cannot bypass trust
F05-AC-016 → TEST-F05-016 transient retry
F05-AC-018 → TEST-F05-018 shared-to-remix entry
F05-AC-022 → TEST-F05-022 shared app use-as-is creates no remix lineage
~~~

# 34. Dependencies

Upstream：

- DATA-MODEL share / Blueprint truth
- F02 trust status
- F03 fresh Runtime Instance
- Infra Edge / CDN / PostgreSQL
- F00 Share / Restore presentation

Downstream：

- F06 Remix
- F07 Evidence
- F08 Ownership
- F12 Recovery

# 35. Release / Migration

Release 1 production mode：

~~~text
DURABLE_REFERENCE
/share/{share_id}
~~~

Portable Snapshot：

~~~text
retained architecture option
not Release 1 blocker
~~~

Live Room：

~~~text
F09 only
~~~

Future F08：

- account ownership
- share management
- creator-authorized revoke
- history

不得要求改 immutable Blueprint body。

# 36. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F07 recipient/share evidence dedupe與retention policy。
- F00 Share presentation / entry semantics。
- Fresh Execution Admission已固定 Share ACTIVE與Blueprint executable為兩個獨立 gate。

非 blocker、可後續迭代：

1. F08 authenticated share management / creator-authorized revoke。
2. Phase 1 default無自動 expiry；未來若改需 Material Review。
3. Portable Snapshot仍是experiment，不影響 DURABLE_REFERENCE SSOT。

# Conclusion

F05 Current Truth：

~~~text
Active validated Blueprint
→ Create durable Share Reference
→ /share/{share_id}
→ resolve content_hash
→ fetch immutable Blueprint
→ re-check trust / compatibility
→ create fresh Browser Runtime Instance
→ Recipient uses immediately
~~~

> Share 分享的是 App definition，不是 Creator 當時的私有操作狀態。這讓 appf2 的連結既便宜、可快取、可重播，也不需要 Recipient 重新呼叫 LLM。


---

## Future Share Modes Boundary

> Sync source：O01 Low-fi Review / DESIGN-WORKBENCH。
>
> 此節只固定 Phase boundary，不擴張 Phase 1 F05。

Phase 1 F05只分享：

~~~text
App definition / immutable Blueprint reference
~~~

Phase 1 **不分享**：
- current Runtime inputs
- current Result
- mutable game/session state

Future directions：
1. **Share Result / Runtime Snapshot**：需要獨立 explicit Function / contract；不得偷偷擴張既有 F05 share row。
2. **Realtime shared game / shared mutable state**：由 F09 Realtime Room方向承接。
3. Future UI可形成「分享 App / 分享結果 / 開啟共同遊玩 Room」三種意圖，但 Phase 1 O01只落地「分享 App」。

此 boundary 不修改目前 BUILD_FREEZE_READY F05 semantics。
