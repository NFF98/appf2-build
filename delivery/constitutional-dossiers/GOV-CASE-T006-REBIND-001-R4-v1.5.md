# GOV-CASE-T006-REBIND-001 — R4 v1.5 / Governance 實作與 BCE

**只屬於 Human R3 批准的 C 方案隔離 PoC。R4 尚未獲 Human approval，R5 不得開始。**

## 1. 最新 SSOT 事實
- `NFF98/appf2-build` main 精確基準 `7bf5c9466e681719463560c2676ccb82ab097f0e`，BS-P1-024 **active**、BS-P1-025 **LOCKED 但未 Activation**、`implementation_enabled=false`、Sprint `HOLD`、T006 `BLOCKED`，T001/T007 歷史 `CLOSED`。
- Human R1/R2 direct approval、R3 路線 C 隔離 PoC 直接批准；Human Ed25519 獨立核驗仍 **0/5**。本案不重新簽署舊決策、不得導向 R5 或生產實作。

## 2. 本輪精確 GitHub 檔案及本機測試

| Exact audit-only path | SHA256 | Git blob |
|---|---|---|
| `delivery/audits/R4-AUTHORIZED-PREFLIGHT.mjs` | `322c3fffb7d00f46a6bfc9bf29bec0937c6db33085f57b3a3fa0152f20694793` | `de67d6593b526205fefaa78431d3b0686dc9a373` |
| `delivery/audits/R4-AUTHORIZED-PREFLIGHT-TEST.mjs` | `52ec434ff40895ea589c79b22d380f793f6a70f1ddebf049d929fa83e623513a` | `ee70f290a10132cc61757b91cd9d54d7813b2327` |
| `delivery/audits/R4-REPLAY-LEDGER.mjs` | `2c7fb3288ef95cf107e4fb2b587e5b269862c5bc13b6522432225e6900dbb0c9` | `d963353eff995beaaa21961bd74378876181f7ba` |
| `delivery/audits/R4-REPLAY-LEDGER-TEST.mjs` | `401423ff65877cee2765ad4b830efec29fd3bab9416654aacb9fa42ac42fd91e` | `45c86827dbe7523454739fd0cfa276cad447cb4b` |

GitHub readback 四份 Blob **全部精確匹配本機已實測檔案**，真實 Node.js v22.16.0 測試：Preflight **37/37**（1 synthetic positive、36 negative），Ledger **24/24**（3 synthetic positive、21 negative）。合計新 **61/61**，加前輪 Verifier＋Emitter **69/69**，累計 **130/130** 本機隔離 fixture 測試符合預期，不是 130 個獨立真實 production Test。

原始執行 evidence 路徑 `delivery/audits/GOV-CASE-T006-REBIND-001-R4-PREFLIGHT-LEDGER-BCE.json`。

## 3. 嚴格安全邊界

- Preflight 要求 authenticated `main` push，run id/attempt/source SHA 綁定、BS025 approved+activated、Sprint active Task 正式 owner、registry file inventory/observed hash 一致，以及外部可信 Human signature 與真 Git ancestry 驗證；拿不到可信驗證者 **必須拒絕**。
- Preflight 實際使用 canonical 2026-10-11 BS024/HOLD 欄位重建的測試 fixture 回傳 `NO_AUTHORIZED_BS025_ACTIVATION`，**拒絕是正確結果**。
- Ledger 使用依序 SHA256 鏈結、事件唯一鍵、externally trusted root 與 atomic compare-and-swap 回呼；**不宣稱 repo JSON 本身具有 immutable/durable 屬性**。真實外部 CAS adapter 尚未取得，production commit **禁止**。
- 2 個 production 直接入口均只容許 exit 2 FAIL CLOSED；正向測試只是注入 trust adapter/atomic CAS TEST DOUBLE，**沒有真實 Human 或 GitHub Attestation 正向證明**。
- 新增檔案僅在 `delivery/audits/` 與 `delivery/constitutional-dossiers/`；沒有修改 `harness/`、`ci/`、`.github/`、Product Truth、Baseline、Task/Sprint、Cursor、資料庫或 release。

## 4. BCE 裁決與真正剩餘阻斷

**隔離模型與 GitHub byte provenance：PASS。正式 Amendment：BLOCKED。**

1. 真實 Human 信任根、精確已核准 Task/BS025 Activation 及 production preflight 尚不存在。
2. GitHub 原生 Artifact Attestation 的簽發工作流程、已 pin 完全版 actions、可信 per-Test Runner、完整可核驗新 AC/Test 正向執行仍缺。
3. Ledger 尚需獨立權威 durable CAS / immutable root，現在僅 model，無法防止整體歷史重寫。
4. 正式 protected L3 完整 exact diff/digest、Human R4/R5 approvals+Ed25519 signatures、獨立 CI/BCE/merge 許可全部未成立。

## 5. 下一個 Owner

**ChatGPT Governance。** 以 v1.5 verifier/preflight/ledger/emitter 限定的 trust boundary，繼續補齊可執行的新 signer workflow 和真正受信任 approved-Task/context/ledger adapters，形成**完整且可核對**的受保護候選。不可提前進 R5、不得暗改 protected code。

此文獨立新增 v1.5，v1.0–v1.4 的已產生原始 dossier 保留不動。
