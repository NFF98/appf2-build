# Deltas

Delta 是經 Finding assessment 後的受控變更，不是 Cursor 的自由修改區。

Types：
DESIGN_DELTA / IMPLEMENTATION_DELTA / TEST_DELTA / DEBUG_FINDING / FIX_DELTA。

DESIGN_DELTA 必須連回 Finding、標示 affected contract/Acceptance/Test、回 NFF98/appf2-design Working 處理產品真相、取得 User approval；若影響 locked implementation truth，建立新 Build Spec baseline，affected tasks rebind 後才 resume。

## Scope-clean derived freeze source

當 Current Working 同時包含已批准 remediation 與尚未到 Gate 的 unrelated Product drift 時，replacement Build Freeze 可以使用 scope-clean derived source。

此時：
- `upstream_working_commit` 必須保留 Delta 真實來源；
- `freeze_source.type = SCOPE_CLEAN_DERIVED`；
- `freeze_source.commit` = replacement baseline source commit；
- `freeze_source.base_commit` = derivation base；
- `freeze_source.provenance_audit` 必須指向既存 `delivery/audits/` 記錄。

不得把 derived source SHA 回填成假的 Working history。
