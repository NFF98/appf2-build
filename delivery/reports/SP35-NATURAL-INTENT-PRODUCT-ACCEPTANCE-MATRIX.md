# Sprint 3.5 — 使用者短句→真正可操作 App 驗收矩陣（Draft）

Status: PROPOSED. Design BD-026 Draft #44 尚未 Human Approve；以下不是對應 Test 已執行通過。

| Sequence | 給程式／測試的人話指令 | 觀察到的真實結果 | 對應 Acceptance Draft | 先跑何種免費檢查 |
|---|---|---|---|---|
| A1 | 輸入「幫我做個漂亮又好用的待辦清單，可以新增、勾選、刪除、看完成多少」 | F01 READY，F04 selected supported，F02 admitted、真實 PG record、S03 顯示 | F00-AC-040, F01-AC-033 | typed Plan schema / lowerer graph / F02 V01–V12 / scripted Browser |
| A2 | 在生成 App 中新增 A、B、C | 三項不同 RECORD，清單長度=3、完成=0 | F03-AC-039 | LIST_APPEND and typed state free tests |
| A3 | 只將 B 設為完成 | A/C 不變，B.done=true，完成計數=1 | F01-AC-031, F03-AC-039 | repeat SCOPE/index_alias, LIST_REPLACE_AT, RECORD_SET tests |
| A4 | 刪除 A | 只剩 B/C；完成=1、總數=2、未完成=1 | F03-AC-039 | LIST_REMOVE_AT / filtered counts / render state assertions |
| A5 | 刪光任務、再新增 | 空清單顯示0，無除以0、無殘留 row action | F03-AC-039 | zero-denominator and repeat clone lifecycle negative tests |
| A6 | 同樣形式的計算器短句 | 可修改數值、結果即時變更；0 模型 interaction | F01-AC-033 | typed form / derived number tests |
| A7 | 同樣形式的單頁資訊短句 | 標題及內容真正呈現，沒有多餘無效按鈕 | F01-AC-033 | read-only layout tests |
| A8 | 不支援的功能短句 | 透明的 PARTIAL/UNSUPPORTED，不生成假可用 App；原需求仍在 | F01-AC-034 | capability gap contract & recovery UI |
| A9 | 自動建立失敗或用量不足 | 清楚區別內部組裝錯誤、額度/速率/逾時；不叫 user 改技術 Prompt，不重複收費 | F01-AC-032, F00-AC-040 | no model / error envelope / UI tests |

### 各層 Proof 不可互換
- P0 API/Runtime/unit：只證明受控輸入下單一模組的 contract。
- P1 free integration/browser：scripted model + F02/F03 real runtime，證明 assembly algorithm 能穩定完成多個組合變體。
- P2 one-shot PAID REAL E2E：真實 Browser → Worker → OpenAI → PostgreSQL → F02 Admission → F03 Interactive state & rendered metrics。必須在 P0/P1 FULL PASS 後才發動；保留 SHA、request IDs、錯誤/成本 metadata、脫敏畫面與 state before/after。
- P3 真實使用者：使用者直接在 staging 試相同一句話；系統不得要求技術 Prompt。這一層不能以自動化完全取代。

### 絕對不以假證據關閉
真實待辦 E2E 目前 FAIL；現有 Hello World、179–181 API 測試與 28 Runtime PASS 不等於 A1–A5 PASS。Product Ready 之前 PR #419 繼續 OPEN，不合併 Production。

### 成本邊界
Staging 每模型 operation 的 output token caps 是單次上限，不是帳戶 USD 限額；compile validation recompose ≤1（待修 code）、provider transient retry 有界、每個 CI push 不觸發付費。真正模型測試在 free tests 全過且明確 one-shot 時才執行。
