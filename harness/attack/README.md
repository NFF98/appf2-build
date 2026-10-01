# Attack Dry-run

這不是產品測試；它測「治理防線被故意攻擊時是否會擋住」。

執行：

```bash
npm run dry-run:attack
```

目前案例：
1. Active Task 越 allowlist。
2. 修改 locked Build Spec。
3. 偷切 `CURRENT.json`、沒有 Activation Record。
4. Cursor 自批 DESIGN_DELTA。
5. BLOCKED Sprint 還寫 product code。
6. 同一策略第三次 retry。
7. 未批准 Release。
8. HOLD 狀態偷寫 product code。
9. 合法 HUMAN approved Rebaseline 必須可以 PASS。
10. 合法 User-approved Sprint Activation 必須可以 PASS。
11. Sprint Activation 不得夾帶無關 governance path 變更。
12. scope-clean derived freeze source 必須保留真實 upstream Working provenance，合法 derived provenance 可 PASS。
13. derived freeze source commit mismatch 必須被 Activation Gate 拒絕。

此 suite 使用 temp Git repo，不污染真實 appf2-build working tree。
