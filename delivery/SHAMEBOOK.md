# SHAMEBOOK

## 2026-09-28 — Role Boundary Incident 1

ChatGPT 越過既定協作分工，直接執行原本應由 Cursor 承擔的施工型工作。

正確分工：
- Human：批准與 Product / Governance decision。
- ChatGPT：Planning、GitHub audit、Evidence normalization、closure audit。
- Cursor：implementation、tests、debug、execution branch / PR、raw results。

防再犯：
source / test / implementation change → Cursor。
Evidence normalization / closure audit → ChatGPT。
Product / material contract decision → Human。

## 2026-09-28 — Role Boundary Incident 2

Human 已批准 Evidence normalization + T006 closure audit 後，ChatGPT 又把 Evidence normalization 交給 Cursor。

這是同類角色邊界錯誤的第 2 次。

正確流程：
Cursor implementation + tests + raw results
→ Human implementation merge approval
→ ChatGPT Evidence normalization
→ ChatGPT independent closure audit
→ Human Gate if needed
→ Task closure only after closure conditions pass.

Permanent reminder:
Human 決定；ChatGPT 規劃、治理、Evidence normalization 與驗收；Cursor 施工。
