# GOV-CASE-T006-REBIND-001 — R1 根因必要性案卷（定稿候選 v1.0）

**狀態：待 Human 獨立審議 R1；Human signatures = 0/5；NOT APPROVED。**

- Canonical Build main at dossier preparation: `699eff7e088e1b5b741e9369f3f6a4596e794c9c`.
- Human earlier approved the Design PR39 merge, the BS-P1-025 Build Freeze, and governance **up to just before Cursor execution**. That is NOT an R1–R5 constitutional signature.
- Signed case implementation/code path: **NONE**. R1 would authorize independent investigation only; no `harness/`, CI, Task, Product source, DB, Watcher or Constitutional Policy write.
- Human R1 evidence is this exact versioned dossier, to be approved only by a **subsequent separate Human message** identifying the case/stage/version/hash. AI-made comments and shared GitHub identity cannot substitute for a Human approval.
- Parent ordinary audit evidence, already CI 4/4 PASS and merged: Build PR #359 `699eff7e088e1b5b741e9369f3f6a4596e794c9c`, `delivery/audits/GOV-CASE-T006-REBIND-001-R1-PREP.md` and `delivery/audits/GOV-CASE-T006-REBIND-001-NEGATIVE-TEST-MATRIX.json`. The 24 cases there are specified, **not executed**.
- Separate protected PG/Worker case GOV-CASE-PG-001 remains outside this case and retains its own signatures.

## R1 五個 WHY（有證據、不補編歷史）

**W1 可觀測症狀：** Human-approved immutable BS-P1-025 newly strengthens 10 existing Acceptance entries. Exact comparison of `build-spec/baselines/BS-P1-024/registries/acceptance-test-registry.json` and `BS-P1-025` shows drift IDs F01-AC-013/016/017, F05-AC-001/002/008/011/014, F07-AC-004, F12-AC-004. Historical `T001` (BS-P1-021) remains CLOSED while its F01-AC-013/016 differ from new semantics; T006 remains BLOCKED, `CURRENT-SPRINT.status=HOLD`. Evidence: `delivery/sprints/SP-P1-003/tasks.json`, `delivery/audits/SP-P1-003-BD-025-T006-PRECURSOR-GATE.json` (merged PR358), read-only source comparison in audit PR #359.

**W2 直接程式原因：** `harness/scripts/validate-sprint.mjs` rejects a CLOSED Task on an older baseline if `canPreserveCompletedBaseline(...)` returns false. `harness/scripts/baseline-lineage.mjs` compares entire canonical Acceptance entries and correctly reports drift. Merely rebinding Sprint to BS-P1-025 while leaving T001 at BS-P1-021 fails. Evidence: exact main `validate-sprint.mjs` and `baseline-lineage.mjs`.

**W3 缺少能力：** Existing `harness/scripts/validate-backlog.mjs` supports one `item.revalidation` identity. `BL-P1-008` already has valid T007 CLOSED revalidation for F01-AC-004, target BS-P1-024. Under BS-P1-025 this same DONE item now has separate new F01-AC-017 drift. `BL-P1-010` has F01-AC-013/016 drift; `BL-P1-031` has F07-AC-004 drift. There is no independently tested append-only multi-round, exact-baseline, fresh-evidence path that preserves these prior CLOSED records and assigns new current semantics to a separately authorized owner. Evidence: `delivery/backlog/QUEUE.json` and `validate-backlog.mjs`.

**W4 歷史原由：UNKNOWN。** We can verify the present single-pointer validator and T007 completion records, but have no authenticated original decision record showing WHY the earlier revalidation schema excluded a second semantic change. Do not infer author intent from current code.

**W5 現行合法執行為何不足：** In addition to CLOSED-history checks, `validate-change-scope.mjs` only admits narrowly defined rebaseline transitions; `validate-test-integrity.mjs` and `ci/run-product-ci.mjs`/GitHub CI demand nine real T006 mapped test declarations on active implementation, while HOLD prohibits product writes and Cursor is explicitly not yet authorized to execute. The CI run `38088567310` documented the missing nine test declarations. A protected validator exception, staged authoring authority, or acceptance-ownership change would modify `harness/`/CI/security gates and requires APPf2 Constitution five sequential independent Human approvals, CI/BCE and separate merge approval. Evidence: `harness/policy/APPF2-CONSTITUTION.md` §§1–5, `harness/scripts/validate-constitutional-change.mjs`, the actual source files, and CI run 38088567310.

## Why investigation is necessary

Without a governed and verifiable answer, APPf2 cannot rebind T006 to newly Human-frozen BS-P1-025 without either **(a)** breaking real CI, **(b)** forging previously CLOSED security proofs, **(c)** destroying the existing T007 revalidation trail, or **(d)** bypassing mandatory Human-approved protected gates. Keeping HOLD remains safer than any of those shortcuts, but leaves the playable app work blocked.

## R1 scope / risk / exclusions

R1 investigates whether a *minimal*, secure, append-only revalidation lineage AND safe pre-Cursor sequencing can be designed and proved with negative cases before any executable work. No architecture or target file diff is authorized by R1.

Prohibited irrespective of R1: editing a prior immutable Build Spec, rewriting T001/T007 CLOSED status/evidence, falsifying P-256/PG tests, treating content_hash as a bearer secret, importing F05 Stage B implementation into T006, permitting unsigned `harness/` or workflow changes, mutating production DB, issuing a Watcher lease, or starting another Task.

Independent later steps, **not yet approved:** R2 source facts, R3 alternatives (no-change/isolated PoC/minimal governed L3 change), R4 exact file diff and attack tests, R5 exact candidate with independently verified Human Ed25519 signatures, CI/BCE, distinct Human merge approval and post-merge truth check.

## R1 decision to request only after this dossier has been reviewed

**Human may approve or reject R1 investigation of `GOV-CASE-T006-REBIND-001`, dossier v1.0, by referencing its exact SHA256 and full Git commit SHA.** A yes would authorize **R2 investigation only**—not a security-policy patch, production code, Build activation, T006 tests, merge, or Cursor execution.

**HARD STOP default until independent Human R1 decision: 0/5 constitutional stages.**
