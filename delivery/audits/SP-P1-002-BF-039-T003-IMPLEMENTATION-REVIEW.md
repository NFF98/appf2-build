# SP-P1-002 / BF-039 — T003 Implementation Review Same-Class Audit

## 結論

T003 **BLOCKED; candidate must not merge**。Cursor candidate `9740045a82765cf7e4bc629eb06be5010d81f0be` scope-clean且 gates 自報 PASS，但 independent review 發現一個明確 execution-safety miss 與數個仍未閉合的 same-class machine-contract 問題。

## R1 — Registry v5 usage machine token 不唯一

- F02 §19.1：`resource_usage.timer_slots_per_instance`
- F04 §7/§9：`ResourceUsageProfile.timerSlotsPerInstance`

F04 是 Generated Validator machine-shape owner，但 F02 同時聲稱 exact machine field。Cursor不應自行選一邊。Remediation 必須由 Product truth 明定唯一 token，另一邊同步。

## R2 — E07 required dependency compatibility 漏檢

Shared EXECUTION-ADMISSION E07 明定 required dependency **unavailable / revoked / incompatible** 都 deny。

Candidate eligibility recursion目前只要求 dependency：
- version range match；
- availability=ENABLED；
- execution_status=ACTIVE；
- transitive required dependencies存在。

它沒有檢查 dependency 本身：
- Blueprint schema compatibility；
- trusted runtime compatibility。

因此 parent capability可能在 dependency current-incompatible 時被錯誤放行。這是 merge blocker。

## R3 — Immutable snapshot vs current revocation authority 尚矛盾

E06要求 exact historical Registry snapshot/version/digest integrity；E07又要求 fresh current availability/revocation。

Candidate tests用「改 capability execution_status但保持同一 registry_version/digest」模擬 current revoke。這違反 F04 same-version changed-digest immutability，也證明目前 contract 沒把：
- immutable validation snapshot
- mutable/current execution eligibility authority

分成兩個 machine sources。

Remediation 必須定義 trusted current-eligibility overlay/registry authority，以及它如何被 server選取、完整性驗證、被 E07消費。

## R4 — V10 media policy incomplete

F02 §19.2與F04 §7都把 `mediaAutoplayAllowed` / `networkAccessAllowed` 定義成 V10 security policy。

Candidate只檢：
- permission_class ∈ NONE / USER_GESTURE
- networkAccessAllowed=false

沒有 enforce `mediaAutoplayAllowed`。若 Phase 1 Core policy是 false，必須明說並機械驗證；若有 USER_GESTURE例外，也必須明說。Implementation不能猜。

## Same-class sweep target

除了 R1–R4，remediation需檢查所有「historical snapshot欄位被當作 current mutable truth」的用法，至少：
- availability
- execution_status
- execution_class
- dependencies
- compatibility ranges
- ResourceUsageProfile

要明確區分哪些是 immutable versioned contract、哪些可被 emergency/current policy overlay改寫。

## 已確認沒有越權

Candidate：
- branch = `feature/sp-p1-002-t003-bs-p1-010`
- HEAD = `9740045a82765cf7e4bc629eb06be5010d81f0be`
- base = `2b02a985e3fdeff12d5f9fc3e7775e3e23c0e675`
- ahead 1 / behind 0
- 32 files，全在 T003 allowed_write_paths
- 無 governance/Product truth mutation
- 無 merge

因此本次阻擋是 contract correctness，不是 scope violation。

## One-shot remediation exit gate

1. BF-039 governance block merged；
2. Design truth 同時閉合 R1–R4 + same-class snapshot/current-authority sweep；
3. scope-clean Design freeze source只帶 BF-039 truth；
4. replacement Build Spec Freeze PASS；
5. BF-039 normalization；
6. atomic SP-P1-002/T003 re-activation；
7. **停在 fresh Cursor EXECUTE 前**。
