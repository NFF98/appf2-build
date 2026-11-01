# appf2 Acceptance Contract Conventions

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / Phase 1 — Working Current Truth。
>
> Canonical Role：定義 **what must be proven**：Acceptance meaning、stable Acceptance/Test mapping、observable truth 與 Build Freeze proof requirement。
>
> Build-owned test implementation（fixture、framework、test placement、Cursor execution、CI、evidence recording、release gate）不在本文定義；邊界以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。

# 1. Core Rule

Acceptance 是 Product / Function 的 observable truth。

Test mapping 的目的不是在 Design repo 寫測試程式，而是確保每個 Required Acceptance 都能在 Build Freeze 後被唯一追蹤並證明。

Canonical mapping：

~~~text
Acceptance ID
→ Test ID
→ Proof Scope
→ Expected Observable
→ Build Freeze Requirement
~~~

appf2-design 擁有「必須證明什麼」；appf2-build 擁有「實際怎麼測、放哪裡、怎麼執行與記錄證據」。

# 2. Proof Scope

Design registry 使用 proof scope 描述必須在哪一層觀察正確性，而不是指定測試工具：

~~~text
CONTRACT
= API / Data / Security / Schema / Runtime boundary observable

BEHAVIOR
= deterministic Function behavior / policy observable

END_TO_END
= user-visible browser / UX / interaction outcome

RUNTIME_EVIDENCE
= event / production-like evidence outcome

HUMAN_REVIEW
= 只有無法可靠自動判定的 qualitative observable
~~~

`HUMAN_REVIEW` 必須是例外；可 deterministic 證明的 truth 不得因實作方便而降級成人工檢查。

# 3. Working Registry

~~~text
working/detailed-design/registries/acceptance-test-registry.json
~~~

Registry 是 machine-readable Design traceability；Acceptance meaning仍由各 Fxx canonical owner 擁有。

Design registry 至少保存：

~~~text
acceptance_id
function_id
criterion
test_id
proof_scope
expected_observable
contract_status
required_for_build_freeze
superseded_by / deprecated metadata when applicable
~~~

Design registry **不得**保存 test fixture strategy、test file placement、CI job 或 Cursor execution instruction。

# 4. Stable ID / Lifecycle

- Acceptance ID 與 Test ID 不重用。
- Active Acceptance 可進 Build Freeze。
- Superseded Acceptance 保留 ID 與 replacement trace，但 `required_for_build_freeze = false`。
- Deprecated / superseded truth 不得被新 Test ID 偷偷重新賦予不同 meaning。
- Acceptance meaning 改變屬 Product Design change，必須回 canonical Working owner。

# 5. Runtime Evidence Boundary

若某個 Acceptance 的 proof scope = `RUNTIME_EVIDENCE`，Design 必須定義：

- 要觀察的 outcome；
- 必要 event / metric semantics；
- privacy / forbidden raw payload boundary；
- success / failure meaning。

Batching、storage、query、test harness、artifact placement與 CI execution 屬 appf2-build。

# 6. Build Freeze Handoff

Human-approved Build Freeze 必須帶出：

~~~text
Acceptance ID
Test ID
Proof Scope
Expected Observable
Required / Superseded status
source Working commit
~~~

appf2-build 再為這些 immutable Design truths建立：

~~~text
fixture / setup
test implementation
test placement
runner / CI
evidence artifact
pass / fail result
~~~

Build 不得修改 expected observable 來配合 code；若 frozen truth矛盾，回 appf2-design做 Material Review / Rebaseline。

# 7. Design-side Traceability Gate

Build Freeze 前至少確認：

- every Required Acceptance 有唯一 registry entry；
- Acceptance ID unique；
- Test ID unique；
- proof_scope valid；
- expected_observable non-empty；
- superseded Acceptance 不再 required；
- registry與 Fxx Acceptance meaning一致。

這些是 Design truth integrity checks，不等於 CI / release execution。

# Conclusion

> **appf2-design 定義「什麼叫做完成」；appf2-build 決定「怎麼證明完成」。**
