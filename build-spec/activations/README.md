# Build Spec Activations

`build-spec/CURRENT.json` 不能單獨切換 active baseline。

每次 INITIAL_FREEZE / REBASELINE 必須新增：

```text
build-spec/activations/<BS-ID>.json
```

Activation Record 是 governance approval evidence，不是 Cursor execution artifact。

Build Freeze 與 Activation 是兩道不同 Human Gate：

- baseline manifest `approval.decision_ref` = Human Build Freeze approval evidence
- Activation Record `decision_ref` = Human Activation approval evidence
- 兩者都必須存在，但不得要求兩個 reference 相同；相同只代表當次流程曾合併批准，不能作為 machine invariant。

## INITIAL_FREEZE

- previous_baseline = null
- baseline manifest supersedes = null
- approved_delta_ids 可為 []
- User approval reference 必須存在

## REBASELINE

- previous_baseline = 當時 active baseline
- new baseline manifest `supersedes` 必須等於 previous_baseline
- approved_delta_ids 至少 1 筆
- 每個 Delta 必須是真實 DESIGN_DELTA、已有人類批准。
- 一般情況：Delta `upstream_working_commit` 必須等於新 baseline source commit。
- 若 Human-approved Build Freeze 使用 scope-clean derived source，Delta 必須保留真實 `upstream_working_commit`，並額外提供 `freeze_source.type=SCOPE_CLEAN_DERIVED`、`freeze_source.commit`、`freeze_source.base_commit` 與既存 `delivery/audits/` provenance record；不得為了通過 Activation Gate 改寫歷史 Working commit。
- derived freeze source 只用於避免把未到 Gate 的 unrelated Working drift 偷帶進 replacement baseline；不得用來引入未經 Human approval 的 Product truth。
- 若當時有 active Sprint，切換前 Sprint 必須先 BLOCKED

Cursor 不得自行建立 Activation Record、偽造 approval、或直接切 CURRENT pointer。Repo-side Gate 驗證結構與 traceability；最終「誰有權批准」由 GitHub CODEOWNERS + branch protection server-side enforce。
