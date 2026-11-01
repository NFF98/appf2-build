# F19 — Shared App Data / Social Persistence

> 狀態：**BUILD_FREEZE_READY — PHASE_1_SHARED_RANKING_PROOF_ONLY**
>
> Horizon：Phase 1 Product Proof extension；implementation仍需 Human-approved Build Freeze + Sprint/Task activation。
>
> Human Direction：Shared Durable App Data 是 appf2 post-generation core competency；Phase 1 第一個 proof 只做 **bounded asynchronous Shared Ranking**。
>
> Non-authority：本檔不啟用 F09 Realtime、F13 full entitlement/metering、F20 commerce，也不授權 Cursor。

# 1. Purpose / User Outcome

> **不同使用者不必同時在線，也能在同一個 Shared App 中提交 bounded score，並在不同時間看到同一份 durable ranking。**

~~~text
A 今天玩 → submit 5
B 明天玩 → submit 8
C 後天玩 → submit 6
→ A / B / C 之後都可讀到同一 Shared Ranking
~~~

Phase 1 proof重點是：

~~~text
Share
→ Recipient opens same App definition
→ Recipient gets same approved Shared Data Scope
→ bounded ranking read/write
→ later Recipient sees durable shared outcome
~~~

這不是 F09 Realtime Room，也不是 generic database product。

# 2. Phase 1 Scope Lock

## Included

Phase 1只啟用一個 Shared Data capability：

~~~text
shared.ranking.v1
~~~

它提供：

- one bounded Ranking capability instance per validated Blueprint；
- server-authoritative opaque Shared Data Scope；
- asynchronous read；
- bounded score submission；
- deterministic ranking order；
- retry-safe idempotency；
- anonymous-first participant authority；
- bounded quota / rate-limit degradation；
- privacy-safe Evidence；
- REMIX / new immutable Version = fresh scope。

## Explicit Non-Scope

Phase 1 **不做**：

- Shared Vote；
- Shared Counter；
- generic Shared Records / arbitrary KV；
- raw SQL / table designer / user-defined schema；
- user-defined RLS / DB credentials；
- realtime presence / live room / push synchronization；
- Creator admin DB console；
- user-facing reset / bulk-delete workflow；
- private Shared Data；
- full F13 billing / entitlement / metering；
- F20 commerce；
- cross-Version shared-data migration；
- automatic Parent/child Shared Data inheritance。

Future Vote / Counter / Records 可沿 F19 boundary演進，但不得因本檔存在就進 Phase 1 implementation。

# 3. Canonical Boundary

~~~text
F03 Runtime
= local mutable Runtime Instance state

F05 Share
= immutable App definition + optional opaque F19 scope reference

F19 Shared Ranking
= recipients across time share bounded durable ranking data

F09 Realtime
= presence + live shared mutable session
~~~

Hard rules：

1. Ranking mutable data **不得寫回 immutable Blueprint body**。
2. Ranking mutable data **不得等同 Creator Runtime Instance state**。
3. Browser / generated App只呼叫 capability operation；不得知道 DB table / SQL / RLS。
4. F19不能繞過 F02 Blueprint trust、F04 capability admission或 F05 Share trust gate。
5. local App interaction仍由 F03擁有；只有 explicit Shared Ranking operation進 F19。

# 4. Immutable Capability Configuration

Phase 1 validated Blueprint最多宣告一個：

~~~text
capability_id = "shared.ranking.v1"
~~~

Capability configuration 是 immutable App definition的一部分；**ranking records不是**。

Required configuration：

~~~text
{
  "capability_id": "shared.ranking.v1",
  "ordering": "DESC" | "ASC",
  "update_policy": "BEST_SCORE" | "LATEST_SCORE",
  "score_min": <safe integer>,
  "score_max": <safe integer>,
  "max_visible_entries": 1..100,
  "allow_display_name": true | false
}
~~~

Validation rules：

- score domain = signed safe integer only；
- `score_min <= score_max`；
- `max_visible_entries <= 100`；
- unknown field fail closed；
- only one `shared.ranking.v1` capability instance per Blueprint in Phase 1；
- F02/F04 validation完成前不得建立 Shared Data Scope。

此配置決定「怎麼排」，不是讓 F19猜遊戲規則。

# 5. Shared Data Scope Lifecycle

## 5.1 Provision

對含 `shared.ranking.v1` 的 validated/compatible Blueprint：

~~~text
F05 durable Share creation
→ ensure F19 ranking scope
→ one active scope per Blueprint hash + capability id
→ return only opaque scope_ref to client
~~~

Provision必須 idempotent；重複 Share同一 immutable Blueprint不得建立 competing active scope。

## 5.2 Restore

F05 successful restore 可回：

~~~json
{
  "shared_data": {
    "capability_id": "shared.ranking.v1",
    "scope_ref": "<opaque>",
    "policy_version": "<F19 resource policy version>"
  }
}
~~~

Client不得取得 internal `shared_data_scope_id`、DB key、participant_ref 或 admin credential。

## 5.3 New Version / Remix

任何新 immutable Blueprint identity 都不自動繼承舊 mutable ranking data。

Phase 1：

~~~text
REMIX child → fresh scope
REFINE new immutable Version → fresh scope
Correction child → no automatic F19 scope inheritance
~~~

PFR-required hard rule：

> **REMIX child 必須 fresh Shared Data Scope，且 child operation不得讀寫 Parent scope。**

same-Creator REFINE未來若要保留 Shared Data，必須另做 compatibility / migration design；Phase 1禁止自動保留。

# 6. Participant Authority

Phase 1 anonymous-first。

- participant authority由 server根據 F07 trusted anonymous identity解析；
- Client request **不得提交或覆寫 participant_ref**；
-一個 participant在一個 ranking scope最多一個 current ranking row；
- optional `display_name` 是公開 participant-provided content，不是 identity authority；
- display_name disabled時 UI使用 non-identifying generated label；
- F19不得把 browser fingerprint當 participant identity。

Display name contract（enabled only）：

- Unicode text；
- trimmed + whitespace normalized；
- 1–32 grapheme-equivalent display units at UI boundary；
- control chars / bidi control abuse / script injection rejected or escaped；
- raw display name不得進 Evidence event。

# 7. Ranking Write Semantics

Operation：

~~~text
ranking.submit_score
~~~

Client request：

~~~json
{
  "share_id": "<public share ref>",
  "scope_ref": "<opaque>",
  "operation_id": "<client generated idempotency id>",
  "score": 8,
  "display_name": "A"
}
~~~

Server derives participant_ref。

Required validation order：

1. resolve Share；
2. verify Share ACTIVE；
3. verify Blueprint trust/compatibility；
4. verify scope_ref belongs to resolved Blueprint + `shared.ranking.v1`；
5. resolve participant authority；
6. validate operation_id；
7. validate score against immutable capability config；
8. validate optional display_name；
9. apply rate/quota policy；
10. execute one atomic ranking transaction；
11. emit privacy-safe Evidence after durable outcome.

## 7.1 Update policy

`BEST_SCORE`：

- DESC → higher score is better；
- ASC → lower score is better；
- non-improving submission returns current row with `NO_CHANGE`；
- improving submission replaces score and achieved_at。

`LATEST_SCORE`：

- every accepted new logical operation replaces score and achieved_at。

## 7.2 Deterministic ordering

Ranking order：

1. score according to ASC / DESC；
2. `achieved_at ASC`；
3. stable internal `ranking_entry_id ASC`。

Tie behavior不得由 UI或 DB natural order猜測。

# 8. Idempotency / Concurrency

`operation_id` scope：

~~~text
(scope_id, participant_ref, operation_id)
~~~

Rules：

- same operation replay → same logical response；
- same operation_id + different canonical payload → F19-ERR-008 IDEMPOTENCY_CONFLICT；
- concurrent submissions for same participant必须 serialize / CAS-equivalent；
- transaction failure不得留下 half-updated rank row + completed dedupe record；
- ranking response必须由 committed durable state计算。

# 9. Read Semantics

Operation：

~~~text
ranking.read
~~~

Request至少綁定 active `share_id + scope_ref`。

Response：

~~~json
{
  "capability_id": "shared.ranking.v1",
  "entries": [
    {
      "rank": 1,
      "display_name": "B",
      "score": 8
    }
  ],
  "snapshot_at": "<server time>"
}
~~~

Rules：

- max returned entries = capability `max_visible_entries`；
- never return participant_ref；
- no raw operation history；
- no DB metadata；
- read does not require F09；
- inactive/revoked Share不得作為新 public ranking read authority。

# 10. Phase 1 Data Contract

Canonical durable minimum：

~~~text
shared_data_scope
- shared_data_scope_id UUID PK
- blueprint_hash FK
- capability_id = "shared.ranking.v1"
- status ACTIVE | ARCHIVED
- resource_policy_version
- created_at
- archived_at?
UNIQUE (blueprint_hash, capability_id) WHERE active-equivalent

shared_ranking_entry
- ranking_entry_id UUID PK
- shared_data_scope_id FK
- participant_ref opaque server-owned
- score BIGINT
- display_name? bounded public content
- achieved_at
- updated_at
UNIQUE (shared_data_scope_id, participant_ref)

shared_ranking_operation
- shared_data_scope_id FK
- participant_ref
- operation_id
- request_fingerprint
- outcome CREATED | UPDATED | NO_CHANGE
- created_at
UNIQUE (shared_data_scope_id, participant_ref, operation_id)
~~~

Indexes只建立已證明 access path：

- scope lookup by blueprint_hash + capability_id；
- ranking order index compatible with configured ordering strategy；
- participant row lookup；
- operation idempotency lookup。

Migration必须可在真 PostgreSQL執行；Build不可以 in-memory fake當唯一 DB proof。

# 11. Phase 1 Resource Policy — No F13 Runtime Dependency

Phase 1不啟用完整 F13。

F19自己消費一個 versioned：

~~~text
F19ResourcePolicyV1
~~~

至少包含：

- max active ranking scopes per anonymous Creator；
- max ranking entries per scope；
- max monthly distinct participants per scope；
- warning threshold；
- bounded viral grace；
- read/write rate limits；
- operation-dedupe retention；
- archived-scope retention。

Business Plan 的 Free baseline（3 active Shared-Data Apps / 約100 records per App / 約1,000 monthly participants / ~80% warning）是 policy calibration input，**不是 hard-coded branch logic**。

Phase 1 contract：

~~~text
below warning → normal
warning threshold → Creator warning evidence/state
nominal quota reached → bounded viral grace
grace exhausted → throttle/reject costly new writes first
→ safe read + local App play remain available when trust/integrity allows
~~~

F13 future activation可以接管 commercial entitlement resolution，但不得改 F19 operation semantics。

# 12. HTTP / Service API

Canonical Phase 1 product endpoints：

~~~text
GET  /api/shared-data/ranking
POST /api/shared-data/ranking/submit
~~~

Both require：

- share_id；
- opaque scope_ref；
- server-side Share/scope/trust verification。

Submit additionally requires：

- operation_id；
- score；
- optional display_name。

Transport status follows shared API conventions；domain errors use F19 error identity。

No endpoint exposes generic table/collection CRUD。

# 13. Error / Recovery Contract

Canonical F19 errors：

| Error | Meaning | User-safe treatment |
|---|---|---|
| F19-ERR-001 SCOPE_NOT_FOUND | opaque scope cannot resolve | refresh Share / safe exit |
| F19-ERR-002 SCOPE_NOT_ACTIVE | scope archived/inactive | no new shared operation |
| F19-ERR-003 SHARE_NOT_ELIGIBLE | Share/trust gate fails | do not expose shared data |
| F19-ERR-004 INVALID_SUBMISSION | score/name/config invalid | edit/retry valid input |
| F19-ERR-005 PARTICIPANT_AUTHORITY_UNAVAILABLE | F07 identity unavailable | bounded retry |
| F19-ERR-006 RATE_LIMITED | abuse/rate guard | retry later |
| F19-ERR-007 QUOTA_WRITE_THROTTLED | grace exhausted | keep read/local play when safe |
| F19-ERR-008 IDEMPOTENCY_CONFLICT | reused op id with different payload | generate fresh operation |
| F19-ERR-009 PERSISTENCE_FAILED | durable transaction failed | retry; no partial commit |
| F19-ERR-010 INTERNAL_INVARIANT | authority/integrity invariant failed | fail closed / reload or safe exit |

F19 failure不得清空 local Runtime state，也不得把 ranking failure包裝成 App semantic success。

# 14. Privacy / Abuse / Security

1. public Share ≠ DB admin。
2. Client never submits participant_ref。
3. score/display_name inputs bounded + validated。
4. No raw SQL/schema/table names in Product API。
5. server verifies active Share + scope/Blueprint relation on every public read/write。
6. rate limit至少按 scope + participant authority；可加 network abuse guard，但不能用 fingerprint作 Product identity。
7. operation history不作 public feed。
8. Evidence不得包含 raw display_name、participant_ref、raw score、request body。
9. Shared Ranking data不得進 F07 Product Event payload except bounded categorical/bucketed metadata。
10. DB constraints必须守住 unique participant row + dedupe key；application-only guard不够。

# 15. Evidence Contract

Phase 1必须可区分：

- scope resolved；
- ranking read ready；
- submit durable committed；
- submit rejected；
- quota warning；
- quota/rate write throttled；
- fresh scope created for derived Version。

Evidence只记录 bounded metadata，例如：

- operation outcome；
- ordering / update policy enum；
- entry-count bucket；
- rejection reason enum；
- relation type；
- resource policy version。

禁止记录：

- participant_ref；
- display_name；
- raw score；
- full ranking；
- raw request。

# 16. UI / UX Integration

F19没有独立 full-screen surface。

- S03：Generated App仍是主角；Shared Ranking作为 Generated App capability content呈现。
- S04：只在 successful Share restore后解析 opaque scope；不增加 Share Landing Page。
- S05：REMIX / REFINE UX不变；derived Version使用 fresh scope，不用 ownership/shared-origin猜 relation_type。
- O03/F12：shared-data failure用现有 humanized recovery language / next-action pattern。
- High-fi visual不因 F19自动 reopen；PFR-04以 textual delta为主。

# 17. Acceptance / Test Contract

| Acceptance | Observable truth | Test |
|---|---|---|
| F19-AC-001 | 同一 Shared App recipients跨时间读取同一 durable ranking scope | TEST-F19-001 |
| F19-AC-002 | Ranking read/write不依赖 F09 Realtime | TEST-F19-002 |
| F19-AC-003 | ranking mutable data不进入 immutable Blueprint或 Creator Runtime state | TEST-F19-003 |
| F19-AC-004 | Client无法建立 arbitrary DB schema/SQL/collection CRUD | TEST-F19-004 |
| F19-AC-005 | eligible Share restore只回 opaque scope_ref，不泄漏 internal scope id/DB authority | TEST-F19-005 |
| F19-AC-006 | participant authority由 server/F07解析，Client不能 spoof participant_ref | TEST-F19-006 |
| F19-AC-007 | submit按 Share→trust→scope→identity→payload→quota 顺序 fail closed验证 | TEST-F19-007 |
| F19-AC-008 | duplicate logical submit idempotent；payload-conflicting replay fail closed | TEST-F19-008 |
| F19-AC-009 | ASC/DESC + BEST_SCORE/LATEST_SCORE + tie-break产生 deterministic ranking | TEST-F19-009 |
| F19-AC-010 | REMIX child建立 fresh scope且不能自动读写 Parent scope | TEST-F19-010 |
| F19-AC-011 | Phase 1 REFINE new immutable Version也不自动继承旧 ranking scope | TEST-F19-011 |
| F19-AC-012 | F19ResourcePolicyV1不依赖 full F13 runtime / billing | TEST-F19-012 |
| F19-AC-013 | quota/grace exhausted优先限制写入并保留 safe read/local play | TEST-F19-013 |
| F19-AC-014 | Evidence不包含 participant_ref/display_name/raw score/full ranking | TEST-F19-014 |
| F19-AC-015 | revoked/expired/untrusted Share不能继续作为 public ranking read/write authority | TEST-F19-015 |
| F19-AC-016 | A/B/C在不同时间提交后可观察同一正确排序结果 | TEST-F19-016 |
| F19-AC-017 | transaction/concurrency failure不产生 partial rank + false dedupe success | TEST-F19-017 |
| F19-AC-018 | read response bounded且不泄漏 participant_ref/operation history/DB metadata | TEST-F19-018 |

# 18. Build Freeze Readiness

PFR-03 exit所需 Product truth已收敛为：

- one capability；
- one scope lifecycle；
- exact ranking semantics；
- exact authority/idempotency boundary；
- exact minimum relational schema；
- exact API surface；
- explicit privacy/abuse/quota/recovery；
- explicit Acceptance/Test；
- S03/S04/S05 textual delta owner。

Build仍必须自己决定 implementation file layout、migration filenames、framework adapters、test placement与 CI mechanics；不得改写上述 Product contracts。

> **F19 Design = BUILD_FREEZE_READY for Phase 1 Shared Ranking proof only.**
