# GOV-CASE-T006-REBIND-001 / R4 v1.2 — GitHub 原生 CI Attestation 路線及實證補強

**HUMAN R4 APPROVAL: NOT RECEIVED。R5: NOT AUTHORIZED。PROTECTED CODE: UNTOUCHED。**
本檔是 R4 v1.0 與 v1.1 的**附加審核版本**；先前 exact SHA256／Human decision 來源原文不可被改寫。本 v1.2 尚未構成可進 R5 的安全候選。

## A. Case、權限及 canonical 狀態

- Case: `GOV-CASE-T006-REBIND-001`。
- Human R1 v1.0 直接批准 → R2；Human R2 v1.0 直接批准 → R3；Human R3 v1.0 選 **C 隔離 PoC**（SHA256 `c296035868e48fa187d5d089c83fc70ffb4d193d11c5cb3cf1b1ce8ee748be0a`、commit `254c57a924839fb88a39748681ec628f9568dcfa`）→ 僅 R4 草案準備。
- Build main `7bf5c9466e681719463560c2676ccb82ab097f0e`（本案精確 base）；`CURRENT=BS-P1-024`、`BS-P1-025 LOCKED`、`implementation_enabled=false`、`Sprint HOLD`、T001/T007 CLOSED、T006 BLOCKED。
- 0/5 獨立 Human Ed25519 有效簽章已驗證；R1–R3 聊天直接批准**不能冒充**密碼學簽章。No Cursor / No DB / No Watcher / No Merge。

## B. 由真實 GitHub Actions 查得的 PR #364 結果

兩份稽核用 `.mjs` 初稿曾導致 `CI Gate` 的 `Repository lint` 出現 6 個 ESLint errors（commit `e01b81b4b4fe744e0a0d56f0d22ff5eb0e756c46`、run `38093876162`）。只在隔離 `delivery/audits/` 重構函式複雜度與參數，**未改 lint 規則、沒有 suppress、沒有碰 protected Code**。

GitHub 於 commit `b7afb4f29b646a21ee3fc71524af6bde2554325f` 證實四項 completed/success：

| Workflow | Run |
|---|---|
| Governance Gate | 38094131837 |
| CI Gate | 38094131830 |
| Governance Attack Dry-run | 38094131835 |
| CodeQL | 38094131829 |

`CI Gate` 的 job `114336404116`：Governance、Repository lint、Product CI shell step 都是 success。**但 Product CI 在 `implementation_enabled=false` 只回 `HOLD`，這不證明 F01/F07 新 test 已實際執行。** 不得偷換成 Product PASS。

本機 Node v22.16.0 從 GitHub exact blob `bb75903523a1b178feb191be2b0a1ea550a8bb7f` 重建及重跑 trust fixture：**26/26**（2 synthetic positive、24 negative）。原始檔 SHA256 `34f2d79b0cfb47de78ccaf871ccbc2c5584eb49b612836629333c33565958688`；本機結果 JSON SHA256 `74db371e906beb85662680bc5e8100f685117046d0bdf6fbe827e31d0dbca755`。隔離 multi-round JS exact blob `b8133019bf68e1c6a4f49475351f4988168dc802` 在 canonical 19 項資料重跑 **19/19**。兩者均不屬於 production/新任務 PASS。

## C. 新的獨立反證：Run Success 並不能證明每個 Test PASS

- T007 歷史 `EV-SP-P1-003-T007-001` 記錄 `source_commit=61108dabc153985b6689680577188a945153f05b`。
- 其 GitHub Actions run `37867961823` 真實 `head_sha=fe24c8711fa0b36e5c7b05aa404c310af922531a`，`event=pull_request`，`conclusion=success`，對應 artifacts 列表為空。
- 兩個 SHA 不相同，這是不同 provenance 語意的既有案例；不得藉此宣稱 T007 記錄失真或把它重新開案。
- 新安全輪次需要**另外生成**真執行 Test manifest、精確 CI SHA 及 attested artifacts，不能引用歷史舊 PASS、JSON 布林值或 GitHub Run 綠燈推論新義務成立。

## D. 限縮的正式信任路線（僅設計，不啟用）

完整設計及 GitHub 文件依據在 `delivery/audits/GOV-CASE-T006-REBIND-001-R4-CI-TRUST-DESIGN.md`，真實來源核對在 `delivery/audits/GOV-CASE-T006-REBIND-001-R4-AUTHENTIC-CI-AND-LOCAL-TEST-FACTS.json`。

**選擇：GitHub Native Artifact Attestation + main-only protected proof builder + per-Test manifest + verifier + atomic anti-replay ledger。** 不能在不改 L3 的情況下自動獲得。現有 `ci.yml` 只讀 `contents`，沒有 attestation 發行；候選需要具體新增受保護 Workflow / verifier，讓先前「四檔 protected patch 就足夠」的假設**正式降級**為 incomplete。

驗證者必須要求 `gh attestation verify` 提供 exact signer workflow、`--source-digest`、`--source-ref refs/heads/main`、repo、SHA256 artifact、可信簽章與 timestamp，再以 GitHub API 獨立確認 run/event/head_sha/attempt/jobs，最後對該 Task 的每一個 AC/Test 查真正已執行的結果。簽章不可把不可信 `statement.predicate` 當權威。沒有可信受權工作流程、runner、簽發資料、完整測試報告或重放 ledger，全部 FAIL CLOSED。

## E. 仍未解的三大阻斷

1. **Protected L3 完整候選未完成。** 現有四檔 `.patch` 為隔離 staged read-side/closure/evidence，且刻意擋住 VERIFIED/CLOSED；需要受限 Workflow、受信任 verifier、nonce/ledger 與全新精確 changed paths/digest。未得到新的安全證據不可擴寫正式 Gate。
2. **真實 CI attested 新版 Test 未存在。** BL008 `F01-017/TEST-F01-SEC-007`；BL010 `F01-013/TEST-F01-API-001`、`F01-016/TEST-F01-API-003`；BL031 `F07-004/TEST-F07-004` 都還沒有新版真憑證。BL032 無後續漂移不得重驗。
3. **憲法級授權未完成。** Human R4 尚未核准，R5 不可啟動；R1–R5 可驗密碼學簽章仍為 0/5，獨立 protected CI/BCE 和另一次 Human merge approval 均未成立。

## F. 獨立 BCE v1.2 結論及下一 Action

**PASS（證據有限）**：修正 audit-only lint 後 PR #364 exact commit 四項 workflow success；本機 exact Trust fixture 26/26、isolated multi-round model 19/19；真實 GitHub API 揭示 source/Run 不等價的歷史案例。

**BLOCKED（安全放行）**：無 attested per-Test CI proof、沒有 approved main-only signing workflow，正式四檔 patch 未跑完整新 Gate 整合，也沒有可簽的 protected candidate digest。

**下一 Action Owner：ChatGPT Governance**。繼續按此信任邊界產出完整隔離候選 + 必要攻擊測試後，才能形成供 Human 正式核准進入 R5 的 R4 最終案卷；之前 Sprint HOLD、Task BLOCKED、no protected merge、no Cursor lease、no DB。
