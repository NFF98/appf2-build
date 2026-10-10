# GOV-CASE-T006-REBIND-001 — R4 第二輪獨立 BCE (Review only)

**BCE: ISOLATED TRUST MODEL TEST PASS / PROTECTED FORMAL PATCH BLOCKED。不得用此文件替代 Human R4/R5、CI、密碼學簽章或受保護程式修改。**

## 1. 重新驗證的 GitHub 與本機真實測試

Canonical Build main: 7bf5c9466e681719463560c2676ccb82ab097f0e。

- GitHub 隔離程式：delivery/audits/GOV-CASE-T006-REBIND-001-R4-TRUST-BOUNDARY.mjs。
- Source git blob SHA1: 681c7cb99f6357faf095990986a02f8439192353；與本機 git hash-object **完全相符**。
- Source UTF-8 SHA256: 02a1d627be045069d3eabbdddd64919a6006ade87b09159ceb4b0deb5f1bd74c。
- 本機 Node.js v22.16.0 實際執行上方精確程式：26/26 expectations matched；2 synthetic positive、24 negative。
- 本機 JSON 測試結果 SHA256: 6c2b3be751d6b695b3bc023744f1d7d66869a8bc823a77cc34319c180ee2eb5c。
- 此處是本機 Node isolated PoC，**不是 GitHub Actions、production CI、有效 Human Ed25519 或真實外部 CI 證明**；每次測試只使用 ephemeral test signer。

Negative N01–N24 實際拒絕：缺 receipt、缺信任根、foreign signer、簽後資料修改、wrong repo/workflow/ref/audience/event、缺 revalidation:proof scope、失敗 run、invalid run id、過期／尚未發行／不合理時效、wrong source SHA、hash-only、wrong evidence digest、wrong Test ID、foreign Task、wrong baseline、fake PASS field、receipt replay、non-base64 簽名。

## 2. 第二個獨立重現的來源驗證漏洞

現行 validate-evidence.mjs（blob de6b12310923ac01989bfa34015c37e9b387a8e5）的 isAncestor() 僅用 git cat-file -e SHA^{commit}，只證明 Git object 存在，而不是 ancestor。

隔離 Git repository 重現：
- 非祖先 branch commit: 67ecfd8d9f98fa723ba97ed41924a22af710e924
- git cat-file -e foreign^{commit} ⇒ PASS（物件存在）
- git merge-base --is-ancestor foreign HEAD ⇒ FAIL（不是祖先）

不是在正式 appf2-build 篡改過 evidence，也不代表舊 T001/T007 曾有假 PASS；不可為了修新版本而破壞歷史。

## 3. 具體候選 patch 與精確限制

已新增隔離 review-only unified diff：delivery/audits/GOV-CASE-T006-REBIND-001-R4-PROTECTED-READSIDE-STAGING.patch。

- Base main: 7bf5c9466e681719463560c2676ccb82ab097f0e。
- Backlog original blob: 349906a97ab71c48069208c42874aca9eb290e51。
- Sprint original blob: d46ed2a4d9eb216ad59ee6d7eb7f0fa1ec0330eb。
- GitHub exact original hunk 逐行復原 match，兩份 patch 後的 JS 均經 V8 syntax parser 檢查通過。
- 修補項目：多輪讀取、鎖定 Registry SHA256、來源／目標 lineage、逐輪 Test/Acceptance ownership、歷史 Sprint target 唯一解析、缺證明的 VERIFIED/CLOSED 一律 fail closed。
- 本 patch 還不能讓真實新輪正式關閉；故是 **完整兩檔 read-side staging diff，不是整案 L3 可部署的 patch**。從未套用進 harness/ 或 CI。

## 4. 三項現存 HARD BLOCKER

1. **真實外部簽發者／驗證器未接通。** Ephemeral test key 無權成為 production trust anchor；須設計 GitHub Actions 或可信 CI 的授權身分、簽署與撤銷、protected ref、正確 runner/workflow/run_attempt、exact source commit 與 test results、持久 nonce／replay 檢查。JSON 裡自填 independently_verified:true 不可信。
2. **L3 原子 closure 未完成。** validate-change-scope.mjs 與 validate-evidence.mjs 需要真正的 append-only immutable side-effect guard 和可信 CI receipt，並執行完整安全回歸；只有 read-side patch 不夠。
3. **正式治理權限／CI 尚未通過。** 尚無 GitHub CI 中的受保護 Gate 完整測試、R4 Human approval、R5、獨立 Ed25519 Human 五關簽章；不得以本地 PoC、GitHub 帳號或 PR 標籤代替。

## 5. 必須保持不變

BS-P1-024／025 LOCKED、舊 T001/T007 CLOSED、BL008 舊 revalidation、BL032 carry-forward、T006 BLOCKED、CURRENT BS024、Sprint HOLD、implementation_enabled=false。F05 Stage B、PG-001 的 production DB/RLS/Worker 與 T006 九項正式 executable tests 均不屬於本案已驗證範圍。

## 6. BCE 定案

**模型 26/26 PASS，來源祖先條件漏洞已真實重現；正式 L3 Amendment / protected CI 改動 BLOCKED。**

本補強應列入 R4 v1.1 審查。R4 v1.0 已有 SHA-256 不得暗中覆蓋；R4/R5 未授權，所有 HOLD 維持。