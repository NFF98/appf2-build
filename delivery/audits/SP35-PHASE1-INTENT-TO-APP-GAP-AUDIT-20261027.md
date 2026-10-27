# Sprint 3.5 — Phase 1 SSOT × 實作 × REAL E2E 缺口稽核（2026-10-27）

狀態：PRODUCT GAP FINDING / BS-P1-026 候選輸入；**不是 Formal Build Freeze、Sprint Activation 或 Product PASS**。
依據：Design current main eab3503cf0d66147abb143278303e79a73fb25d1；BS-P1-025 source fda9045d0fc1b2b718d56ed49fa09abdce343a5c；Build main 4d59ef4c64d0b6a632c4e54ecd7e8777da18506b；PR #419 head 1c8e55894f7b87e099cc38c10c6985700a6b4854；Design DRAFT #44 commit 84f8ffd945b05db5ed32020cc171df1d1b91f161。

## 真實產品失敗證據（優先於推測）
- 2026-10-27 Chromium 短中文 Prompt：待辦清單、新增/完成/刪除/完成數。Intent Analysis HTTP 200 READY；Compose HTTP 422 F01-ERR-011。Run 40440522149 與 40441127526。
- Supabase validation_run 類型：先 V02 $.nodes[1].events.change，後 V06 $.root_node_id / $.nodes[4] / $.nodes[4].repeat，V07 $.nodes[0].repeat.items.value；可重現為候選 Blueprint 連線／型別／scope 問題。該 Run 181 API + 28 runtime 仍 PASS；產品 E2E FAIL。
- 早先單頁 Hello World 在 Browser PASS，不能外推到任意互動 App。沒有全功能 LifePilot PASS；S03 staged failure 不可報 RELEASED。

## 深查 F00/F01/F02/F03/F04：具體缺口
| ID | SSOT 已有什麼 | 程式／證據指出未閉合什麼 | 建議責任 | 嚴重度 |
|---|---|---|---|---|
| GAP-P1-01 | F01 §14 Blueprint Composer，F02 檢驗必經 | Prompt B 直接產整份 low-level Blueprint；沒有版本化 typed plan + deterministic assembler 保證 root/events/repeat/types | F01 | P0 |
| GAP-P1-02 | F04 §8 compiler_catalog 同源，§16 capability coverage | capability covered 並不證明 certified multi-capability wiring 能成功；缺 composition family 可執行能力證據 | F04 + F01 | P0 |
| GAP-P1-03 | F02 §20 V01–V12 完整 validator | 已能發現錯誤，但 F01 主要交 AI 重猜；沒有組裝前的 Plan/graph/type closure；**不可放寬 F02** | F01/F02 boundary | P0 |
| GAP-P1-04 | F03 §25/§13 repeated row, event/atomic state | 手工 Blueprint 單測不能保證生成的 A/B/C row toggle/delete、filtered count 正確 | F03/F01 | P0 |
| GAP-P1-05 | F01/F00 Acceptance + test seed | REAL natural-language → model → PG → F02 → Browser 真正編輯結果不是必過的跨模組入場證據 | F00 + F01 + Delivery | P0 |
| GAP-P1-06 | F01 §16–17 rejection-driven recompose 最多 **1 次** | PR #419 src/platform/compiler/compile-intent.ts 目前 maxValidationRecomposes: 2；未對齊來源，可能增加付費 | F01 code | P1 |
| GAP-P1-07 | F01 §16 analysis 15s / compose 20s；模型成本 evidence | PR #419 Route CREATE 50s、Staging output cap 6000/16000；不是帳戶 USD 上限，必須核准 timeout/cost policy semantics | F01 + deployment | P1 |
| GAP-P1-08 | F00 S02 / F12 保留與 humanized recovery | F01-ERR-011 卻引導普通人「修改需求再試」；內部 Blueprint wiring 錯誤不是使用者需改 Prompt 的錯 | F00/F12 UX | P1 |
| GAP-P1-09 | F03 State instance 與 durable Blueprint 分開 | 無法因 App 成功生成就宣稱跨裝置/重新開啟保留待辦；驗收必須區分 local session state vs durable blueprint | F03 + F00 | P1 |
| GAP-P1-10 | Build Spec immutable Freeze 與 Design Current Truth 獨立 | BS-P1-025 manifest acceptance_count=307；Design main registry 308（新 F00-AC-039）；Design #44 提案 316，尚未批准，不得偷偷混入 LOCKED baseline | Design/Build Freeze | P0 governance truth / 不阻擋 Staging debug |

## Phase 1 全函式範圍盤點（不是沒有足夠證據就冒充各函式 PASS）
| Owner | SSOT 核心責任 | 本輪結論 |
|---|---|---|
| F00 | 短 Intent、S01/S02/S03、進度與恢復 | P0：缺短句→真可操作 END_TO_END gate；BD-026 draft F00-AC-040 |
| F01 | Prompt A/B、capability coverage、composition、retry/cost | P0：Plan→Assembly/coverage/成本與重試不一致；draft F01-AC-030..034 |
| F02 | Blueprint validation/trust admission | validator 有效攔錯；不修改／不繞過。須擴大 negative contract corpus 與 F01 boundary evidence |
| F03 | Runtime typed state、actions、repeat/replay | fixture tests 通過不等於 generated row actions；draft F03-AC-039 |
| F04 | single capability truth、compiler/validator/runtime projections | 個別 Core Capabilities 已定義；cross-capability certified assembly mapping 與 evidence 不足；draft F04-AC-020 |
| F05 | Share / Restore | 本輪未深度執行真實 share 回歸；原 contract 保留，與本次 Create P0 非同一故障 |
| F06 | Refine/Remix | F00-AC-037 Preview-origin 留 Stage C；不可借 Stage A Composer-only 039 冒稱完整 PASS |
| F07 | Anonymous identity/evidence | #416 carry-forward 未結之 security evidence 必須保留；本輪沒有足夠證據宣稱完成 |
| F12 | Humanized recovery | F01-ERR-011 應區分系統組裝失敗 vs 真 user-invalid；需增 user-facing recovery 驗收 |
| F16 | Result correction | 現有功能規格保留；目前未能在生成後進結果校正，不宣稱 F16 PASS |
| F19 | Shared App Data extension | 不應以「待辦清單」默認要求 realtime/跨帳戶儲存；延後而非阻擋單使用者 Stage A |

### 稽核邊界／已知未完成
本輪已比對 Phase 1 的 11 個 Function SSOT owners 與最新 Build/PR 檔案，對 F00-F04 的故障鏈作深入對照。**沒有**逐條執行 F05/F06/F07/F12/F16/F19 全部 Acceptance，也沒有驗證每個電路功能的真實產品 PASS；這些是後續獨立 evidence gap，不可列為已完成。仍需將 Machine Plan schema、compatibility、測試等細節閉合才能產出合法 BS-P1-026。

## 修正原則
- 這是產品組裝責任／可測結果問題，不是 16P；不擴大舊流程阻擋。
- 改 **F01** 讓模型提出可驗證的語意組合計畫，程式 deterministic lower to Blueprint；保留 F04 single source、F02 V01–V12、F03 trust。
- 不把待辦寫成唯一固定模板；先建立少量 certified compositional primitives，再擴展其他 app family。
- 先 0 美元 deterministic tests → 有限量真模型驗證；不把 HTTP 200/Hello World 當完成。
- 舊 BS-P1-025 / MAIN/HOLD 不改；新 Material Design delta 需 Design PR #44 經 Human Review 後才能 Build Freeze。

## 可追溯連結
- https://github.com/NFF98/appf2-design/blob/main/SSOT.md
- https://github.com/NFF98/appf2-design/pull/44
- https://github.com/NFF98/appf2-build/issues/416
- https://github.com/NFF98/appf2-build/pull/419
- https://github.com/NFF98/appf2-build/actions/runs/40440522149
- https://github.com/NFF98/appf2-build/actions/runs/40441127526
