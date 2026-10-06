# SP-P1-003 / BF-049 — T001 Compiler Contract Gap Audit

## 結論

T001 **BLOCKED；不得建立 implementation candidate**。

Cursor 在 Issue #245 RESULT `6012821241` 於任何 code write 前以 `SPEC_GAP` HARD STOP。Independent BCE audit `6013292757` 驗證 HARD STOP 正確，但收窄兩個過度表述：DO_NOT_PERSIST non-durability 已鎖定；anonymous_id 的 concrete header/cookie transport 不一定需要成為 Product truth。

真正 blocker 為以下六個 bounded contract surfaces。

## SG-1 — CapabilityRequirement derivation

F01 已定義 `CapabilityRequirement` shape、`CapabilityRequirementExtractor` service boundary 與 F04 `resolveCapabilityCoverage(requirements)` handoff，但沒有定義 canonical ResolvedIntent 如何 deterministic 產生 semantic_need / required / impact / IO types / interaction_class / constraints。

Implementation 不得自行選擇 LLM hints、rule projection 或新增 model operation。

## SG-2 — ResolvedIntent exact projection

StructuredIntent policy-visible item contract與 answer merge truth已存在；`DO_NOT_PERSIST` 亦明定只存在 request-scoped context。

缺口是 F01-DATA-005 top-level collections沒有 exact item/projection/provenance schema：confirmed missing/ambiguity truth如何投影、inputs/constraints/outputs/rules/accepted_assumptions entry shape、provenance_map、request-scoped truth如何 omission/reference/redaction。

## SG-3 — F02 rejection classification contradiction

F01-RQ-008有五類 feedback classification，但沒有 authoritative per-F02-error map。

`F02-ERR-012 PERMISSION_NOT_ALLOWED`：
- F02 §39 = Retry NO；
- F12 §18 = SECURITY_TERMINAL / EDIT_REQUEST；
- recovery-registry = STATE_OR_ACTION_FAILURE / BLOCKING_RECOVERABLE / CONDITIONAL_RETRY / RETRY。

這是 locked baseline direct contradiction，不可由 implementation 選邊。

## SG-4 — Compile failure lifecycle / User retry

F01-API-003 compile precondition要求 `intent.status=READY`；durable lifecycle同時有 COMPOSITION_FAILED / VALIDATION_REJECTED / INCOMPATIBLE；F01-RQ-010允許 failure後 User-triggered retry重用 durable truth。

缺少 failure → retry-eligible lifecycle transition table。

## SG-5 — Retryable idempotency state machine

Canonical idempotency只有 IN_PROGRESS / SUCCEEDED / FAILED_TERMINAL，且規定 retryable transient failure不可先鎖 FAILED_TERMINAL；same-key IN_PROGRESS又固定 409。

缺少 operation完成但可 retry 時的 canonical state transition / release / takeover semantics，可能造成同 key 直到 TTL 永久卡 409。

## SG-6 — Anonymous identity binding

Shared API允許 anonymous_id由 Function payload或 trusted request context帶入，所以不要求本輪硬鎖 header/cookie。

但 answers/compile request payload不帶 anonymous_id，而 idempotency scope需要 anonymous_id。缺少 trusted context與 intent_record.anonymous_id 的 binding / mismatch behavior；同時 F07明定 anonymous_id不是 authentication/ownership proof。

## Exit gate

1. BF-049 governance block merged。
2. Design SSOT一次閉合 SG-1..SG-6 + same-class cross-contract contradictions。
3. Human-approved bounded Design delta merged。
4. Scope-clean replacement Build Spec frozen。
5. BF-049 normalized/resolved through replacement baseline activation。
6. SP-P1-003/T001 rebound to replacement baseline。
7. Stop with execution authority prepared only at **pre-Cursor boundary**。
8. **Do not post a fresh [APPF2-EXECUTE][APPROVED] command.**
9. T002 remains PLANNED / unauthorized.
