# BD-026 → BS-P1-026 — Sprint 3.5 Build Spec Rebaseline 準備（NOT LOCKED）

**嚴格狀態：CANDIDATE / NOT APPROVED / NOT ACTIVATED / NOT BUILD SPEC TRUTH。** 本檔位於 delivery/deltas，不是正式 Build Spec、不造假 manifest LOCKED。

## 指向唯一來源
- Design Current Truth：NFF98/appf2-design working/ main eab3503cf0d66147abb143278303e79a73fb25d1。
- Material Design BD-026 **DRAFT PR #44**，working 候選 commit 84f8ffd945b05db5ed32020cc171df1d1b91f161。其原始內容尚未進 Design main、也未由 Human 核准。
- BS-P1-025：main 唯一現役 locked baseline，source fda9045d0fc1b2b718d56ed49fa09abdce343a5c，immutable、acceptance_count 307、implementation_enabled=false / HOLD。
- Design main 已新增 F00-AC-039（PR #42）；Design Draft PR #44 納入 8 新 Acceptance 將 registry 從 308 變 316。**不得把 316 直接寫入舊 BS-P1-025。**

## 建議 BS-P1-026 正式內容（Human Approval 後才 Projection）
1. 等 Design PR #44 確認版本化 CompositionPlanV1 exact schema、deterministic lowering output、F04 typed catalog surface、negative cases、模型成本政策與 F00/F01/F03/F04 acceptance；批准後 merge Design main，取得新的 exact source_working_commit。
2. 完成 Design Phase 1 affected contract audit 與 registry integrity；針對 Build Spec 依明確 projection-map FULL_COPY/heading 產生**新的** BS-P1-026 baseline，而非編輯舊 BS-P1-025。
3. 對未受影響的 F02/F03/F04 canonical rules 保持 exact truth；F00-AC-039 保留 Composer-only Stage A、F00-AC-037/F06 Preview-origin 留 Stage C，不混合。
4. Build Freeze 候選需 Human 對 exact Design source commit、scope、Acceptance/Test/Non-scope 明確批准；新的 acceptance registry 數目用 projector 實際生成結果，不事先硬填數字。
5. BS-P1-026 若 LOCKED，正式啟用 Sprint 3.5 仍是另一個 gate；由 Build repo 綁真正 Sprint/Backlog/Task 與 source SHA。未批准前所有 HOLD truth 保留。

## Sprint 3.5 的兩個產品 Tasks（沿用 #416 兩 Task 範圍，不新增 16P）
- T001 — F01 Typed Plan / deterministic assembler 與 F04 single-source bindings；對齊 ≤1 validation recompose；fixture/product integration 零付費測試，證明 V02/V06/V07 不再靠 AI 猜。不得繞 F02 或重做 F03。
- T002 — 真實普通中文待辦 A/B/C、完成 B、刪除 A、統計；加 typed form/read-only 跨型態 evidence。免費全過後**最多一個明確授權 paid browser trial**，失敗即留下證據並停止，不能宣稱 PASS。

## 進入實作之前的硬性未完成
- Design PR #44 尚未 approve/merge；CompositionPlanV1 schema 和 certified pattern machine contract 未完整閉合。
- Acceptance registry 需隨 Design 自洽並經驗證；Builder 必須依 version-locked approved Design source deterministic projection。
- 現有產品 PR #419 OPEN，請以此維持產品修復，不合併不穩定產品；PR #419 的現有 prompt-only patch 不等於 BD-026 需求完成。
- 禁止將 16P／四 Gate 歷史 NOT_RUN 當本次 App E2E；同時不可放寬安全門檻假裝成功。

Next technical decision：在 F01 owner 定義 CompositionPlanV1 的 exact machine grammar、type checker、lowering error classes 與 migration from current Prompt B Candidate。這不是新增第五層架構，而是實作現有 L2 缺失的穩定接線。
