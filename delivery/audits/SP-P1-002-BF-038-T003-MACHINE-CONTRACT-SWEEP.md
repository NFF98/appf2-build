# SP-P1-002 / BF-038 — T003 Same-Class Machine Contract Completeness Audit

## 結論

T003 **BLOCKED before Product write**。Cursor 在第一個 V09 timer ambiguity 正確停止；獨立 same-class sweep 確認必須一次修復四組 machine-contract 缺口，否則重新執行會繼續逐項撞牆。

## R1 — V09 / hard ceiling measurement 未閉合

F02 §19 固定 Phase 1 hard ceilings，但 V09 只有「Aggregate Blueprint + per-Capability resource budget」。目前沒有唯一 machine rule 定義：

- canonical Blueprint / total initial state 的 exact byte 單位與 envelope；
- expression AST node count / expression depth 的 root/count convention；
- TypeDescriptor / composite literal depth；
- UI child / repeat nesting depth；
- static event/action binding count；
- repeated runtime node instance upper bound；
- timer_count；
- F04 maxInstancesPerBlueprint / maxSerializedPropsBytes / maxLocalStateBytes / maxEventBindings / maxActionBindings / maxConcurrentTimers 的 measurement 與 enforcement stage。

尤其所有 Core Capability 都複製同一 DEFAULT_RESOURCE_BUDGET，maxConcurrentTimers=10 不是 timer-consumption metadata。logic.timer 的 replayClass=TIME_DEPENDENT 也未被 contract 定義成 resource-consumption signal。

## R2 — V04 current execution eligibility 無 machine projection

F02 V04 要求：

- availability = ENABLED
- not REVOKED
- dependencies available
- execution class Phase 1 allowed
- compatible Registry/Runtime

但 GeneratedCapabilityValidator 沒有 availability / revocation or execution status / execution class。Canonical CapabilityDefinition 也只有 availability，沒有 current REVOKED machine field。Compatibility prose 雖列 REVOKED outcome，source truth 無 exact token。

因此 TEST-F02-011 目前不能在不猜 Product semantics 的情況下完整證明 disabled / revoked / incompatible capability denial。

## R3 — Fresh Execution Admission boundary 未閉合

`assertExecutable(contentHash, runtimeContext)` 只有概念 signature。Shared EXECUTION-ADMISSION 有 endpoint / flow / TTL，但未固定：

- trusted `runtimeContext` exact shape；
- old Blueprint 要取哪個 exact Registry snapshot/digest；
- current capability eligibility recheck；
- trust/schema/registry/runtime/capability failure precedence；
- client 是否能傳版本/trust/registry override。

這會讓 AC-011 / AC-012 的 execution side 留給 implementation 自行決定。

## R4 — V10 / trust spoof 測試語意需精確化

Exact Blueprint schema 本身已禁止 script/code/module/handler/trust_status 等 executable/trust carrier；Runtime handler 也應只來自 trusted Registry。

需要明定：

1. no-code safety 是 **structural allowlist**，不是對任意合法 user string 做 `eval` / `import` 關鍵字掃描；
2. 合法 text value 即使字面含 code-like token，仍只是 inert data；
3. content persistence admission/reuse 不等於 fresh execution authorization；
4. client-supplied trust/executable/version/registry metadata 永遠不能改寫 server current truth。

## 已檢查且不需重開

- BF-036 exact Blueprint schema closure / SCOPE typing；
- BF-037 jsonb string-domain、NodeInstanceKey、singleton repeated invoke；
- candidate_digest / canonical content identity；
- immutable content body + mutable trust_status 的 durable model；
- T003 allowed Product scope本身（四個 mapped Acceptance）沒有改。

## One-shot remediation target

下一個 Design truth 必須把 R1–R4 一次閉合，然後：

1. scope-clean Design commit / PR；
2. replacement Build Spec（BS-P1-010）Freeze Audit；
3. BF-038 resolution normalization；
4. atomic SP-P1-002/T003 re-activation；
5. 最後停在 fresh Cursor EXECUTE comment **之前**。

任何 Product implementation 在此之前都禁止。
