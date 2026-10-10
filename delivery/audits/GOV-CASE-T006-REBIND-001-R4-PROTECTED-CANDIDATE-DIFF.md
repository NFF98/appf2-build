# GOV-CASE-T006-REBIND-001 / R4 — Protected L3 最小修改候選差異說明 v1.0

> **REVIEW-ONLY / DO NOT APPLY / NO PROTECTED FILE CHANGED.** 此檔為 R4 審議的具體語意差異及錨點，不是已通過 CI 的可執行 patch。受保護程式仍只有 canonical main 版本；缺少外部可信 Evidence Verifier 與 change-scope closure 的完整實作，BCE 不允許稱為 deployable candidate。

## 1. 精確 base／錨點

- Build canonical base: `7bf5c9466e681719463560c2676ccb82ab097f0e`
- `harness/scripts/validate-backlog.mjs`: blob `349906a97ab71c48069208c42874aca9eb290e51`，現有關鍵區段 23–145（單輪、resolve）及 147–171（claims）。
- `harness/scripts/validate-sprint.mjs`: blob `d46ed2a4d9eb216ad59ee6d7eb7f0fa1ec0330eb`，關鍵區段 196–220（revalidation item）、275–290（Task claim）。
- `harness/scripts/validate-change-scope.mjs`: blob `ce5ce96fd460895f874eb9dae10e81db8b785340`，現有關鍵區段 76–154（closure）、158–210（atomic rebaseline）、259–264（allowlist）。
- `harness/scripts/validate-evidence.mjs`: blob `de6b12310923ac01989bfa34015c37e9b387a8e5`，現有關鍵區段 46–83（payload/commit binding）、88–115（mapped PASS/REVIEW）。
- `harness/scripts/baseline-lineage.mjs`: blob `6a8fc0fd331220074e5f04a972d641c6069718d1`，**不需修改**：既有 `acceptanceSemanticDriftIds` 逐來源／目標比較可重用。
- `harness/policy/APPF2-CONSTITUTION.md`、`harness/scripts/validate-constitutional-change.mjs`、`ci/`、已 LOCKED BS024/025：**不改**。

## 2. 候選資料形狀（只在隔離模型中，未寫入正式 QUEUE）

```diff
--- a/delivery/backlog/QUEUE.json (hypothetical later authorized L2 rebind)
+++ b/delivery/backlog/QUEUE.json (hypothetical later authorized L2 rebind)
@@ BL-P1-008 (preserve the entire existing revalidation object byte-for-byte)
   "revalidation": {
     "target_build_spec_id": "BS-P1-024",
     "status": "CLOSED",
     "sprint_id": "SP-P1-003",
     "task_id": "T007",
     "acceptance_ids": ["F01-AC-004"]
-  }
+  },
+  "revalidation_rounds": [{
+    "sequence": 1,
+    "source_build_spec_id": "BS-P1-024",
+    "target_build_spec_id": "BS-P1-025",
+    "source_registry_sha256": "0862d8b7fcef2e996788919d3ee0c899fa53fb58f90a1c6f7e678a7810e94c44",
+    "target_registry_sha256": "eea0d35a377ae5d7c240d71a20ada75b783840af26d912b3de3105cf42db1074",
+    "acceptance_ids": ["F01-AC-017"],
+    "test_ids": ["TEST-F01-SEC-007"],
+    "owner_sprint_id": "SP-P1-004",
+    "owner_task_id": "T008",
+    "status": "PLANNED",
+    "evidence_ids": [],
+    "replay_nonce": "TO_BE_AUTHORIZED_AND_GENERATED"
+  }]
```

- `SP-P1-004`、`T008` **僅合成示例，不是實際已存在／Human 指派／已可執行的 Sprint/Task**；不可將上面 PLANNED 當成 ACCEPTED/PASS。正式 owner/task ID 必須由 Human 另行批准後再鎖定。
- BL010 新 round：`BS-P1-021 → BS-P1-025`，`F01-AC-013→TEST-F01-API-001`、`F01-AC-016→TEST-F01-API-003`；合成 owner `SP-P1-004/T009`。
- BL031 新 round：`BS-P1-001 → BS-P1-025`，`F07-AC-004→TEST-F07-004`；合成 owner `SP-P1-004/T010`。
- BL032 無新增 semantic drift，舊 `BS003→BS004 / SP002/T001 / F07-AC-008` 不變，禁止虛構新輪。
- 正式 round 應再加入：完整 legacy chain fingerprint、`previous_round_sha256`、來源/目標 Baseline manifest Git blob、canonical round payload SHA256、不可重放 nonce 與證據 locator 雜湊綁定。PoC 目前沒有可供 production Gate 信任的 anti-tamper store，因此這些仍是硬性設計待辦，非 PASS。

## 3. 最小 read-side 具體差異（精確來源錨點、供未來 code diff）

```diff
--- a/harness/scripts/validate-backlog.mjs
+++ b/harness/scripts/validate-backlog.mjs (PROPOSAL ONLY)
@@ resolveItemRevalidationIds, original lines 133–145
-  const carried=historicalRevalidationCarryForwardIds(item,id,currentBaseline);
-  if(carried) return carried;
-  const drift=acceptanceSemanticDriftIds(root,item.build_spec_id,currentBaseline,item.acceptance_links);
-  if(drift.length) return validateRevalidation(item,id,currentBaseline,drift);
+  // Candidate: retain item.revalidation as round zero and iterate ONLY
+  // append-only item.revalidation_rounds in ascending sequence.
+  // For each round: source MUST equal previous CLOSED target;
+  // require isBaselineAncestor(source,target), and acceptance_ids / test_ids
+  // MUST equal the exact semantics of acceptanceSemanticDriftIds(source,target).
+  // Check target/source registry SHA256 against LOCKED manifest inventories.
+  // Preserve original T007/T001 revalidation, Task and Evidence byte-for-byte.
+  // Only CLOSED rounds with existing independently proven PASS/REVIEW
+  // may count toward completed-version coverage; PLANNED is NEVER proof.
+  // Missing, replayed, duplicate-owned or forged proofs HARD FAIL.
+  // Reject any leftover drift from last CLOSED target to active baseline.
+  // No source/target version skipping without verified ancestry and proof.
+  // Return union of genuine historical + new round Acceptance ids,
+  // never claim old F01-AC-004 as new F01-AC-017 evidence.
```

```diff
--- a/harness/scripts/validate-sprint.mjs
+++ b/harness/scripts/validate-sprint.mjs (PROPOSAL ONLY)
@@ revalidation_item_ids loop, original lines 203–218
-    const r=bi.revalidation;
+    // Candidate: resolve exactly ONE record matching both the historical
+    // or appended round's target_build_spec_id=m.build_spec_id and sprint_id=sid.
+    // Legacy SP-P1-003 MUST still resolve the old T007 F01-AC-004 record.
+    // New candidate SP-P1-004 MUST NOT overwrite or shadow the old record.
+    // Validate exact mapped Test IDs and independent owner/evidence.
+    // Duplicate matching records, duplicate Task owner, or partial coverage FAIL.
```

```diff
--- a/harness/scripts/validate-change-scope.mjs
+++ b/harness/scripts/validate-change-scope.mjs (PROPOSAL ONLY)
@@ exactRevalidationClosures, original lines 76–154
-  // current closure exception supports only one item.revalidation.
+  // Extend safe-control-only exception to a single IN_PROGRESS→CLOSED
+  // transition of an EXACT existing approved appended round.
+  // Compare all earlier rounds, original item.revalidation, DONE statuses,
+  // Task scopes and acceptance IDs with immutable base SHA bytes.
+  // Require its owner Task CLOSED, mapped real Evidence and existing
+  // Evidence Gate PASS. No new Task/Sprint, legacy rewrite or simultaneous
+  // activation through the closure exception.
```

```diff
--- a/harness/scripts/validate-evidence.mjs
+++ b/harness/scripts/validate-evidence.mjs (PROPOSAL ONLY)
@@ mapped PASS verification, original lines 88–115
-  // Existing check accepts source-commit ancestor and local PASS JSON.
+  // For NEW BS025 revalidation round, resolve real GitHub Actions/workflow
+  // evidence bound to exact source_commit, mapped test_ids, job/conclusion,
+  // and independently verified attestation; NEVER trust payload boolean,
+  // client locator string, bare hash or mock CI. If offline/unavailable:
+  // fail CLOSED, do not infer PASS.
```

以上註解型 `diff` 是**明確規則變更草案，不是可編譯或可套用 patch**；缺少外部 verifier 的信任來源、關閉狀態遷移的完整程式，以及安全例外證據。不得進行 R5 或宣稱 `candidate_digest_sha256` 已鎖定。

## 4. 比較與最小範圍裁決

| 方案 | 實際狀態 | 決策 |
|---|---|---|
| L2 保留舊單 pointer | 新 BL008 F01-017 尚無驗證 | FAIL |
| L2 覆蓋舊 pointer | 破壞 SP003/T007 舊認領 | FAIL |
| L2 新 Sprint 而不碰 BL008 | 原項目新漂移未消失 | FAIL |
| L2 alias 新 BL | 原 BL008 仍有未解新漂移 | FAIL |
| L3 最小 read-side | 需 backlog+sprint 認多輪；closure guard 也需限定 | **CONDITIONAL，尚非正式 PASS** |
| L3 外部 Evidence trust | 目前對「把 bool/JSON PASS 當真」的繞過已從 PoC 揭露 | **HARD BLOCKER** |

最小**已證明語意必需**：`validate-backlog.mjs`、`validate-sprint.mjs`。新 round 從 IN_PROGRESS→CLOSED 的合法治理例外、外部真實 CI/證據證明分別牽涉 `validate-change-scope.mjs`、`validate-evidence.mjs` 的規則補強；是否需新 helper 或 `governance-gate.mjs` wiring，須 R4 後續精確實作/驗證才能收斂。不要預先把所有 protected paths 當成必改。

## 5. 回退與阻斷

Rollback（未 Merge）：直接放棄本隔離分支／Draft PR；`main`、所有 CLOSED 歷史、兩份 LOCKED BS、CURRENT、HOLD 和 production DB 原封不動。R4/R5 未批准、Ed25519 可信 Human 簽章 0/5；不動 CI、`harness/`、Cursor lease、F05 Stage B、PG-001。未來若合併後需撤回必須新一輪 Human 治理批准，不可無審批 force/reset。

**BCE：CONDITIONAL STRUCTURAL POC PASS；R4 EXACT PROTECTED PATCH READINESS = BLOCKED。**
