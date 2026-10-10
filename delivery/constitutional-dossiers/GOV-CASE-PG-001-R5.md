# GOV-CASE-PG-001｜R5 v1.2 最終限縮候選授權案卷

日期：2026-10-10 JST  
Case：`GOV-CASE-PG-001`  
Build canonical base：`c4ef766d127dd04ad101e358b52b295beca5ba3f`  
Design canonical base：`7a69bdab36db34618a1904a637587a01148ee138`  
R4 Human decision record：Issue #345 comment `#6092788050`  
R4 dossier：`GOV-CASE-PG-001-R4-v0.5-FORMAL-REVIEW.md`  
R4 dossier SHA-256：`5298b9c900faad05b9842fee6988d122d01df29ec429ba8c795527f7195be0ff`

## 1. R5 要批准的是什麼
本 R5 只批准一個**精確、限縮、可機器驗證的 constitutional candidate**。它不是 T006 implementation lease，也不是 merge、deploy、Cloudflare/Supabase mutation 或下一 Task 授權。

R5 通過後，Governance 只能：
1. 固定本案 5 份 immutable dossier 與 case docket；
2. 依既有憲法準備一張 **GOV-CASE-PG-001 專用、單次 materialization execution lease/spec**；
3. 只有在 Human 另行批准該 materialization execution 後，才可把本 exact candidate 寫入專用 branch 並提出 constitutional candidate PR。

## 2. Exact implementation/release/tooling candidate — 16 paths only
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
16. `harness/scripts/validate-change-scope.mjs`

任何第 17 個 implementation/release/tooling path 都是 `SCOPE_BLOCKER / HARD STOP`。

## 3. Exact byte artifacts
A. 原 R4 14-file exact patch（內容不變）
- file：`GOV-CASE-PG-001-R4-v0.4-EXACT-CANDIDATE.patch`
- SHA-256：`716c6914fdccb877f49b2297b4b50044f5f83f5fda025b6e85490a10f3002ca8`

B. exact deterministic `package-lock.json`
- SHA-256：`2adde5ce8dc9f0587f22d903e718f06909ad6541653f39298a38bd5ed9ddcce6`
- bytes：92,373
- package entries：183
- canonical base lock blob SHA：`f7c9c56fc399019c996137560caf9494862ce8b2`

C. R4 v0.5 scope-bridge exact patch
- file：`GOV-CASE-PG-001-R4-v0.5-SCOPE-BRIDGE.patch`
- SHA-256：`5390507606b6b3c94d890d82717776476ebb0dd3d75b20801e83c279431e5c01`

舊 `meta/candidate-files.sha256` 不再是本案權威，不得用它覆蓋上述 exact artifacts。

## 4. Dependencies
只允許：
- production `pg = 8.23.0`
- dev `@types/pg = 8.23.1`

不得自行升級、改 range、重解 lock 或加入其他 top-level dependency。任何 lock bytes 與上述 SHA 不同 => HARD STOP。

## 5. Runtime / architecture semantics
R3 選定路線維持不變：
- Cloudflare Pages static frontend；
- same-origin independent Cloudflare Worker API；
- Worker 處理 `/api/v1/*`，包含既有 `/api/v1/events/batch`；
- Hyperdrive 連 Supabase Direct database connection；
- Hyperdrive cache disabled；
- `pg` / node-postgres；
- request-scoped `pg.Client`；
- existing OpenAI-compatible server gateway；
- signed HttpOnly/Secure/SameSite=Lax continuity cookie，只做 continuity，不是 auth/ownership；
- answers/compile 的 trusted identity 仍由 server-owned request context 提供；
- unknown `/api/v1/*` 不得落回 Pages HTML；
- config/composition failure 必須 fail-closed JSON 503。

不修改 Product truth、Design truth、F01/F07 product semantics、Capability semantics 或 locked Build Spec。

## 6. Scope-bridge 限制
`harness/scripts/validate-change-scope.mjs` 只能在既有 `inspectConstitutionalChange(...)` 完整驗證：
- one case docket；
- exact base SHA；
- exact changed paths；
- exact candidate digest；
- 5 dossier hashes；
- R1→R5 Human Ed25519 signature chain；
- trusted Human public key；
全部 PASS 時，承認這是一個合法 constitutional candidate。

它不得：
- 修改 T006 `allowed_write_paths`；
- 修改 repo policy；
- 關閉 validator；
- 對 unsigned / wrong-key / wrong-base / wrong-digest / path-drift PR 放行；
- 被普通 T006 Cursor 當作 implementation bypass。

## 7. PR path shape
最終 constitutional candidate PR 必須只有：

### 16 candidate paths
本案第 2 節列出的 16 paths。

### 5 immutable dossiers
- `delivery/constitutional-dossiers/GOV-CASE-PG-001-R1.md`
- `delivery/constitutional-dossiers/GOV-CASE-PG-001-R2.md`
- `delivery/constitutional-dossiers/GOV-CASE-PG-001-R3.md`
- `delivery/constitutional-dossiers/GOV-CASE-PG-001-R4.md`
- `delivery/constitutional-dossiers/GOV-CASE-PG-001-R5.md`

### 1 case docket
- `delivery/constitutional-cases/GOV-CASE-PG-001.json`

因此：
- `docket.exact_changed_paths` = 16 candidate paths + 5 dossiers = **21 paths**
- PR total changed paths = 上述 21 paths + case docket = **22 paths**
- case docket 本身不包含在 `candidate_digest_sha256`。

任何第 23 個 PR path => HARD STOP。

## 8. R1–R5 dossier lineage
- R1：v2.1，SHA-256 `8bb42d9be8cc14ae9b9cfab5b753faf00229cdbc8eb20fcfcff7d86b1d764276`
- R2：v1.0，SHA-256 `f33b7436db9dce4ec69448b38b3fef73396adb838e716c55ec45d07b84abb402`
- R3：v1.0，SHA-256 `b64d433820c0e82ba656d212268022d9462cb5875b6fa282de7e0db01f2573b4`
- R4：v0.5，SHA-256 `5298b9c900faad05b9842fee6988d122d01df29ec429ba8c795527f7195be0ff`
- R5：v1.2，本案卷 SHA 於定稿後計算並由 Human R5 approval 綁定。

R1–R3 既有 Human decisions 與 signatures 可保留；因 R4/R5 candidate lineage 改變，R4/R5 需重新 Human decision record 與 Ed25519 signatures。

## 9. R5 有效期與失效條件
本 R5 若 Human 批准，僅在批准後 24 小時內、且 canonical Build base 仍為 `c4ef766d127dd04ad101e358b52b295beca5ba3f` 時有效。

以下任一發生立即失效 / HARD STOP：
- main/base SHA 前進；
- 16 candidate paths 改變；
- 5 dossier bytes/hash 改變；
- candidate digest 改變；
- dependency/lock bytes 改變；
- 需要 DB schema/grant migration；
- Product/Design semantics 改變；
- Worker routing / identity / security model materially 改變；
- scope-bridge semantics 改變；
- Human 撤回或否決。

AI 不得自行判定 material drift 無關緊要。

## 10. R5 明確禁止
本 R5 不授權：
- Cursor 直接修改 repo；
- 使用或重放 Issue #301 舊 T006 lease；
- npm install / npm ci 作為 repo mutation；
- merge；
- deploy；
- Cloudflare/Supabase production mutation；
- secrets/credentials 寫入 repo 或 log；
- DB migration；
- Product/Design/Build Spec semantic edit；
- 啟動下一 Task；
- 自動回 T006。

## 11. 後續合法順序
若 Human 批准 R5 v1.2：
1. 依本 exact candidate 計算新的 `candidate_digest_sha256`；
2. 保留 R1–R3 signatures，只重簽 R4/R5 chain；
3. 產出正式 case docket；
4. 獨立驗證 5/5 signature chain；
5. 準備一張 **GOV-CASE-PG-001 專用 materialization execution lease/spec**；
6. 由 Human 另行批准 materialization execution；
7. 才可建立 exact constitutional candidate branch/PR；
8. GitHub CI 全 PASS；
9. ChatGPT 獨立 BCE；
10. Human 另行批准 merge；
11. merge 後重新驗 canonical main；
12. 最後才回 T006，重新抓新 main SHA 與剩餘 scope。

## 12. R5 結論
**READY FOR HUMAN R5 DECISION。**

Human 若批准，只代表最終限縮候選審議通過；不等於 execution / merge / deploy / T006 lease。
