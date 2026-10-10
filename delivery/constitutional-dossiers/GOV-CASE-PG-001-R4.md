# GOV-CASE-PG-001｜R4 v0.5 正式審議案卷（scope-bridge 修正版）

日期：2026-10-10 JST  
Case：GOV-CASE-PG-001  
Build canonical base：`c4ef766d127dd04ad101e358b52b295beca5ba3f`  
Design canonical base：`7a69bdab36db34618a1904a637587a01148ee138`  
R3 Human 選定：Option C = Cloudflare Pages + same-origin Worker API + Hyperdrive cache-disabled + `pg` + Supabase PostgreSQL。

## 1. 為何退回 R4
R4 v0.4 / R5 v1.1 完成後，獨立 fail-closed preflight 發現：現行 `harness/scripts/validate-change-scope.mjs` 只承認一次性的 GOV-CONST-001 founding exception，沒有承認「已由 `inspectConstitutionalChange(...)` 完整驗證通過的正式 Human-signed constitutional case」。

因此即使 `GOV-CASE-PG-001` 已完成 R1–R5 Human decision、Ed25519 5/5 signature chain、exact candidate digest 與 trusted public key，直接提交原 15-path candidate 仍會被 ordinary ACTIVE T006 scope gate 以 governance-only / undeclared path 拒絕。憲法 §5 明文要求 ordinary scope gate 持續有效，不得由 AI 繞過。

這是 R4 exact diff/path 的實質缺口，所以：
- R1、R2、R3 事實與路線決定保留；
- R4 v0.4 與 R5 v1.1 不再可作最終候選授權；
- 本案退回 R4 v0.5；
- R4/R5 必須重新 Human 審議，之後 R4/R5 Ed25519 signatures 亦須重新產生；
- T006 仍不得執行。

## 2. 最小修正原則
只增加一個治理檔案：
`harness/scripts/validate-change-scope.mjs`

該 bridge **不建立新的自由放行例外**。它只在同一個 PR 已由既有 `inspectConstitutionalChange(...)` 驗證以下全部條件成功時，才讓 ordinary change-scope 不重複阻擋：
- 恰好一個合法 constitutional case docket；
- canonical base SHA 精確相符；
- docket `exact_changed_paths` 與 PR changed paths 精確相符；
- candidate bytes digest 精確相符；
- R1→R5 五份 dossier SHA 精確相符；
- 五個 Human Ed25519 signatures 有效、順序正確、signature chain 正確；
- trusted Human public key 來自 `APPF2_CONSTITUTION_PUBKEY_B64`；
- 不是 founding bootstrap。

任何缺 key、漏 dossier、SHA 漂移、第 17 個 implementation path、AI 改 approval ref、簽章無效、candidate bytes 漂移，`approvedConstitutionalCase=false`，回到原 scope gate 並 fail closed。

## 3. Exact Candidate — 16 implementation/release/tooling paths
### 原 R4 v0.4 15 paths（內容不變）
1. `package.json`
2. `package-lock.json`
3. `.github/workflows/release.yml`
4. `releases/templates/release-manifest.template.json`
5. `deploy/scripts/common.mjs`
6. `deploy/scripts/deploy.mjs`
7. `deploy/scripts/rollback.mjs`
8. `deploy/scripts/smoke.mjs`
9. `tooling/worker/wrangler.template.json`
10. `src/platform/blueprint/worker-postgres-executor.ts`
11. `src/edge/server-identity.ts`
12. `src/edge/worker-composition.ts`
13. `src/edge/worker-entry.ts`
14. `tests/api/worker-entry.api.test.ts`
15. `tests/api/postgres-worker.integration.test.ts`

### R4 v0.5 新增第 16 path
16. `harness/scripts/validate-change-scope.mjs`

本案仍不修改 Product truth、Design truth、Capability semantics、F01/F07 contract 或 DB schema migration。

## 4. Exact byte/diff binding
權威候選由三個互補 artifact 組成，不再使用舊的 auxiliary per-file SHA manifest 作權威：

A. 原 14-file exact patch（不含 package-lock）
- `GOV-CASE-PG-001-R4-v0.4-EXACT-CANDIDATE.patch`
- SHA-256 `716c6914fdccb877f49b2297b4b50044f5f83f5fda025b6e85490a10f3002ca8`

B. exact deterministic `package-lock.json`
- SHA-256 `2adde5ce8dc9f0587f22d903e718f06909ad6541653f39298a38bd5ed9ddcce6`
- bytes 92,373
- package entries 183
- canonical base lock blob SHA `f7c9c56fc399019c996137560caf9494862ce8b2`

C. scope-bridge exact patch
- `GOV-CASE-PG-001-R4-v0.5-SCOPE-BRIDGE.patch`
- SHA-256 `5390507606b6b3c94d890d82717776476ebb0dd3d75b20801e83c279431e5c01`

任何一個 artifact bytes 改變都不是本 R4 v0.5。

## 5. Scope-bridge exact semantics
`validate-change-scope.mjs` 的唯一新增能力：
1. import 既有 `inspectConstitutionalChange`；
2. 用現有 `changed/base/cs/build/policy/root` 與 Human-configured public key 執行完整 constitutional inspection；
3. 只有 `constitutional=true && bootstrap=false && errors.length===0` 時設定 `approvedConstitutionalCase=true`；
4. 將它加入現有「合法 governance transition」分支；
5. 不修改 T006 `allowed_write_paths`；
6. 不修改 repo policy；
7. 不關掉任何 validator；
8. 不讓 unsigned / partial / wrong-base / wrong-digest constitutional PR 通過。

## 6. Dependency / runtime / Cloudflare / rollback
R4 v0.4 的以下內容全部不變：
- `pg=8.23.0`、`@types/pg=8.23.1` exact pins；
- request-scoped `pg.Client` + Hyperdrive；
- signed first-party continuity cookie；
- production Worker composition；
- `/api/v1/*` JSON boundary 與 `/api/v1/events/batch`；
- Hyperdrive cache disabled；
- repo 不保存 Cloudflare IDs / DB credentials / model secrets；
- DB 不新增 migration；
- Worker/Pages code rollback + environment route/binding rollback；
- DB forward-only。

## 7. Negative attack matrix（v0.5 擴充）
保留 N01–N12，新增 scope-bridge 專項：
- N13 unsigned constitutional docket → scope bridge MUST NOT activate；
- N14 wrong Human public key → MUST NOT activate；
- N15 valid signatures but changed candidate byte → digest mismatch / MUST NOT activate；
- N16 valid docket但多第 17 個 implementation path → exact paths mismatch / MUST NOT activate；
- N17 AI 修改 `human_message_ref` → signature invalid / MUST NOT activate；
- N18 founding bootstrap metadata被拿來重用 → `bootstrap=false` 條件與 base/path checks 阻擋；
- N19 ordinary T006 PR 沒有 constitutional docket → bridge MUST NOT activate，原 task scope 原樣執行。

## 8. Independent BCE 結論
- 發現 R4 v0.4 缺 execution bridge：**實質 blocker，不能假裝可 materialize**。
- v0.5 最小修正只新增一個治理檔，沒有擴大產品語意。
- bridge 的信任判斷完全委託既有 constitutional validator；scope gate 不自己重造第二套簽章規則。
- 缺 key / signature / dossier / exact path / digest / base 任一項時 fail closed。
- 不修改 T006 scope，不讓一般 Cursor 利用。
- 舊 `meta/candidate-files.sha256` 不再是 R4 v0.5 權威，避免與 exact patch bytes 產生雙重真相。
- 真 `npm ci`、完整 CI、staging DB/Cloudflare/E2E 仍屬後續受權執行驗收，不在 R4 假稱 PASS。

## 9. R4 v0.5 結論
**READY FOR HUMAN R4 RE-DECISION。**

Human 若批准本 R4 v0.5，效力只有：
- 接受「原 15-path candidate + 1-file constitutional scope bridge」這份 16-path exact施工草案；
- 允許重新進入 R5 最終限縮候選授權審議。

不等於 repo write、Cursor execution、npm install、PR merge、deploy、Cloudflare/Supabase mutation 或 T006 lease。
