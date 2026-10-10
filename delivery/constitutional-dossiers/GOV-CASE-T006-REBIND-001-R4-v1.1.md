# GOV-CASE-T006-REBIND-001 / R4 v1.1 — 隔離 PoC 補強定稿審議件

**STATUS: R4 HUMAN DECISION PENDING / NO R5 AUTHORITY / HARD HOLD.**
**Version:** v1.1 (additive supplement, v1.0 immutable)
**Case:** GOV-CASE-T006-REBIND-001
**Candidate reference Build main:** 7bf5c9466e681719463560c2676ccb82ab097f0e
**Isolated branch:** governance/gov-case-t006-rebind-r4-isolated-poc-v1
**Draft review PR:** #364 (DO NOT MERGE)

## 1. 已獲 Human 的權限僅到哪裡

R1 v1.0 SHA256 50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453：直接 Human 批准進 R2。
R2 v1.0 SHA256 88134edf64b5ddf2a61c1fed1a56dc73c8a58a32b654276b54380f37101ce141：直接 Human 批准進 R3。
R3 v1.0 SHA256 c296035868e48fa187d5d089c83fc70ffb4d193d11c5cb3cf1b1ce8ee748be0a；commit 254c57a924839fb88a39748681ec628f9568dcfa；Human 選 C 隔離 PoC，只批准準備 R4。

R4 v1.0 原文件保持不變；本 v1.1 僅補充實測、反方 findings 和四檔可重建候選 diff。R1–R3 直接對話核准不等於獨立有效 Ed25519 簽章；Human 密碼學可驗證簽章仍為 0/5。R4/R5 未獲 Human 核准。

## 2. 新增實測證據

- 第一輪 isolate structural tests：19/19（2 synthetic positive、17 negative）。
- 第二輪 Node.js v22.16.0 真實執行獨立 Ed25519 trust-boundary fixture：26/26（2 ephemeral-test-key positive、24 negative）。
- 對照程式 delivery/audits/GOV-CASE-T006-REBIND-001-R4-TRUST-BOUNDARY.mjs，source SHA256 02a1d627be045069d3eabbdddd64919a6006ade87b09159ceb4b0deb5f1bd74c，git blob 681c7cb99f6357faf095990986a02f8439192353。
- 詳細新 BCE：delivery/audits/GOV-CASE-T006-REBIND-001-R4-SECOND-BCE.md。
- 可重現安全缺口：現有 validate-evidence.mjs 僅用 git cat-file -e 驗 commit 物件存在，不是 merge-base --is-ancestor 的祖先關係。隔離 Git 實驗：object exists PASS，actual ancestry FAIL。不能從此推論既有 T001/T007 Evidence 曾被篡改。

## 3. 四份正式 L3 原始碼的隔離 patch

整合 review-only patch：delivery/audits/GOV-CASE-T006-REBIND-001-R4-FOUR-FILE-FAIL-CLOSED-CANDIDATE.patch。
四檔來源 blob：
- validate-backlog.mjs: 349906a97ab71c48069208c42874aca9eb290e51
- validate-sprint.mjs: d46ed2a4d9eb216ad59ee6d7eb7f0fa1ec0330eb
- validate-change-scope.mjs: ce5ce96fd460895f874eb9dae10e81db8b785340
- validate-evidence.mjs: de6b12310923ac01989bfa34015c37e9b387a8e5

4/4 original diff hunks matched exact canonical GitHub sources；4/4 reconstructed JavaScript bodies parsed；**沒有**運行 npm run gate、真正的 git apply --check、整合 CI／DB tests。

候選會處理逐輪 source/target、LOCKED registry hash、Acceptance/Test/owner、舊 SP003 的 T007 revalidation、closure status-only 以及新 Evidence 真實 ancestor；對無可信外部 CI 認證的 VERIFIED/CLOSED 記錄刻意 fail closed。不是可進 R5 的正式完整放行候選，沒有合法的 protected candidate_digest_sha256。

## 4. 仍須解除的阻斷與下一 ACTION OWNER

A. 外部可信 CI receipt 發行流程、受信任公鑰／Key rotation、實際 GitHub workflow run 綁定、nonce 持久化及權限控管 **尚未實現**；local ephemeral private key 永不可視為 Human 或 CI 的信任根。
B. 被隔離模擬器驗證的 append-only safety 尚未由真實 GitHub CI 中的完整 L3 Gate + 關閉轉移安全回歸驗證；不可用語法與 patch hunk PASS 代替。
C. 兩版 LOCKED BS、舊 T001/T007 CLOSED、BL032 carry-forward 永遠保留；新 owner T008/T009/T010 只是假想測試代號，尚未由 Human 批准。F05 Stage B 不偷渡，T006 九項正式 executable tests 與 PG-001 生產 PostgreSQL/RLS/Worker 獨立。

**BCE:** ISOLATED SOURCE / CRYPTOGRAPHIC MODEL CONDITIONALLY PASS；PROTECTED INTEGRATION / R4 TO R5 READINESS BLOCKED。下一 Action Owner 維持 ChatGPT Governance：取得真正受信任 attestation/受保護安全 Gate 全 CI 與 Human 五關可信簽章之可行設計和證據，才可提出 R4 重新審議／後續 R5。

**禁止：PR merge、修改正式 harness/CI、啟動 Cursor、Watcher lease、production DB、改寫 CLOSED 歷史、宣布 R4/R5 已核准。**