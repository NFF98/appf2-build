# SP-P1-002 / BF-040 — T003 Exhaustive Same-Class Integrity Audit

## 結論

T003 **BLOCKED; candidate must not merge**。Candidate `0be0f7111466ae7f6e27ed5f668a33c37272548d` scope-clean且 gates PASS，但目前仍存在會讓 implementation 自行發明 semantics、或讓 fresh execution fail-open/late-fail 的同族問題。

Human 已批准：**BF-040 governance block + same-class remediation，一次做完到 Cursor 再執行前**。本 BF-040 是本輪唯一容器；後續同族發現直接併入，不再拆 BF。

## R1 — Validator snapshot artifact integrity 沒有真正綁到 release identity

Candidate `isIntactRegistrySnapshot()`：
- 只比 wrapper/inner registry_version / registry_digest 字串；
- 重算每個 `execution_contract_digest`；
- 但沒有重算整份 ValidatorRegistry artifact identity，也沒有對 trusted immutable release index驗證。

而 BF-039 正確地把 `availability/execution_status` 排除於 execution_contract_digest，因此同一 version/digest 下原地改 lifecycle field，per-entry digest仍可成立。

需要 machine-verifiable full-artifact digest + trusted release binding。

## R2 — Same CapabilityRef historical executable identity 只寫在 contract，generator 沒 enforce

F04 明定 exact CapabilityRef跨 snapshots的 `execution_contract_digest` 改變必須 bump Capability version。

Candidate generator只檢：
- same registry_version + changed registry_digest => fail。

它沒有對前一版、更沒有對歷史 remove/re-add 的 same exact ref做 identity continuity gate。

需要 append-only historical identity truth，而非只看 previous registry version。

## R3 — V02 / V09 hard-ceiling ownership互撞

§4.1/V02直接限制：
- nodes <= 100
- action steps <= 16
- result outputs <= 50
- degradations <= 50
- refs/degradation <= 20
- 以及其他局部 max

§19 / §29又說**全部 static hard ceiling**超限都要 `F02-ERR-011 / V09`。

Candidate parser會讓部分 input在 V02先死，TEST-F02-010也沒有覆蓋完整 §19 matrix。

Remediation需明定：
- shape/minimum由 V02；
- resource maximum到底統一 V09，或哪些明確例外留 V02；
- 不能同一 canonical max有兩個 stage owner。

## R4 — Runtime compatibility bound grammar未 frozen

Source實例使用：
- minRuntimeVersion = `1.0.0`
- maxRuntimeVersion = `<2.0.0`

Candidate自行決定：
- `<X` = exclusive
- bare `X` = inclusive

這是 Product grammar，不得由資料樣本反推。

## R5 — Durable content integrity / E04 / F02-ERR-015 precedence未閉合

Fresh execution會重新讀 persisted canonical body。
需要區分：
- trust_status != VALIDATED；
- canonical body hash mismatch；
- persisted schema/registry metadata mismatch；
- repository temporary failure。

Candidate把 body/hash corruption放到 E04 CONTENT_INTEGRITY_FAILURE，但 EXECUTION-ADMISSION未定此 mapping，而 F02已有 `F02-ERR-015 HASH_INTEGRITY_FAILURE`。

## R6 — Fresh execution CapabilityRef set未閉合

Shared flow寫「re-check every CapabilityRef」；E07寫「any referenced Capability」。

Blueprint CapabilityRef存在於：
1. `nodes[].capability`
2. `support.degradations[].capability_refs[]`

Candidate只 recheck 1。

Remediation必須明定 validation-time與fresh-time對 degradation refs 的 exact eligibility/stage。

## R7 — Dependency same-ref contract drift未 defense-in-depth

Current dependency resolver會在 current snapshot挑 SemVer-descending eligible candidate。
若某 exact dependency ref同時存在 pinned/current，Candidate不比較兩邊 `execution_contract_digest`。

Generator identity gate若失效，dependency drift可穿過 E07。

需明定：
- same exact dependency ref present in both snapshots => digest must match；
- newly introduced exact dependency version absent in pinned可依 versionRange + eligibility採用；
- no hidden re-resolution of direct Blueprint ref。

## R8 — executable=true 尚未證明 pinned trusted Runtime mapping可用

F04要求：
- runtime-registry與 Registry snapshot同 version/digest；
- Runtime只走 trusted bundled handler；
- ENABLED capability missing handler = build/deployment failure。

Candidate fresh admission只看 Validator Registry與 execution_class。
如果 deployment已無 Blueprint pinned snapshot所需 handler mapping，可能先發 executable=true，直到 Runtime才失敗。

需定義 admission/deployment gate如何證明：
- pinned runtime-registry identity與 pinned Validator snapshot一致；
- 所有 direct executable refs 的 trusted handler mapping存在；
- 不把 T003擴成一般 Runtime semantics。

## R9 — TEST-F02-010 proof completeness

Candidate明確承認 composite literal depth未 direct-test。另需逐項 boundary proof：
- canonical Blueprint bytes
- nodes
- state entries
- rules
- actions
- steps/action
- expression AST nodes
- expression depth
- TypeDescriptor depth
- composite literal depth
- UI depth
- repeat depth
- initial LIST items
- initial STRING chars
- total initial state bytes
- event bindings
- timers
- result outputs
- degradations
- refs/degradation
- children/node
- all static per-Capability budgets except runtime-only maxLocalStateBytes

## Exit gate

1. BF-040 block merged；
2. F02/F03/F04/EXECUTION-ADMISSION final same-class sweep完成；
3. Design truth一次閉合 R1–R9與後續同族發現；
4. scope-clean source從 BS-P1-011 lineage派生；
5. replacement Build Spec Freeze + gates PASS；
6. BF-040 normalization；
7. atomic SP-P1-002/T003 activation；
8. Issue #164 **不得新增 fresh EXECUTE**；
9. 停下等待 Human明確批准 Cursor re-execution。
