# SP-P1-003 / BD-025 / BF-054 — PG001 Design PR #37 → T006 Rebaseline Provenance Audit (Candidate)

> **BCE verdict: SOURCE-DIVERGENCE BLOCKER, NOT FREEZE-PASS.**
> This is review evidence, not the actual `BS-P1-025`, and never activates Cursor by itself. Human approved merging **Design PR #37**, not a separate immutable Build Freeze or expanding Stage A into F05 Stage B.

## 1. Exact GitHub sources (read-only verified)

| Authority | Exact identifier | Status |
|---|---|---|
| Old immutable baseline | `BS-P1-024`, source `736c757e72734f46407f8c9afcd81580ae75f0ef` | LOCKED / MUST NOT EDIT |
| Design upstream BEFORE PR #37 | `7a69bdab36db34618a1904a637587a01148ee138` | Historical main |
| Human-approved Design PR #37 | https://github.com/NFF98/appf2-design/pull/37 | MERGED |
| New Design main | `2e74ea19623c81261bf408856543717e943f6f51` | Confirmed after merge |
| Build main at candidate branch creation | `c4ef766d127dd04ad101e358b52b295beca5ba3f` | Current source of this governance PR |
| Finding / delta | `BF-054` / `BD-025` | OPEN / NOT YET FROZEN |
| Planned successor | `BS-P1-025` | RESERVED CANDIDATE ONLY; NO BASELINE CREATED |

Independent GitHub compare `736c757e...2e74ea19` returned **status=diverged**, `ahead_by=132`, `behind_by=72`, **43 changed paths**. This is **not** the approved eight-path PR #37 scope. Blindly projecting Design current `main` would silently pick up unrelated Product decisions. There is no legitimate `source_working_commit=2e74...` Version Lock until a new scoped Freeze Audit actually passes.

## 2. Approved Design amendment mapping (existing BS-P1-024 Projection Map)

All eight source paths ALREADY appear as `FULL_COPY` entries within the old 64-entry Projection Map; none may be added or removed silently. Their previous `output_sha256` and `source_blob_sha` must change only when their actual approved content changes.

| Design Working owner | Old projected target | PR #37 base equals BS-P1-024 derived source blob? | Implementation boundary |
|---|---|---|---|
| `common-core/API-CONVENTIONS.md` | `shared/API-CONVENTIONS.md` | **YES** | Signed PoP, protected read, API error contract |
| `common-core/EXECUTION-ADMISSION.md` | `shared/EXECUTION-ADMISSION.md` | **YES** | Hash read authorization separate from fresh F03 permission |
| `functions/F00-EXPERIENCE-SHELL.md` | `functions/F00-EXPERIENCE-SHELL.md` | **NO — overlaps other Design drift** | Stage A consumer UX; F05 Share CTA is Stage B, not an implementation expansion |
| `functions/F01-INTENT-COMPILATION.md` | `functions/F01-INTENT-COMPILATION.md` | **NO — overlaps other Design drift** | Existing earlier closed T001 not reopened; new cross-cutting read-grant/PoP needs a governed implementation owner |
| `functions/F05-SHARE-RESTORE.md` | `functions/F05-SHARE-RESTORE.md` | **NO — overlaps other Design drift** | Stage B Share behavior: **not part of T006 Stage A implementation** |
| `functions/F07-ANONYMOUS-IDENTITY-EVIDENCE.md` | `functions/F07-ANONYMOUS-IDENTITY-EVIDENCE.md` | **NO — overlaps other Design drift** | UUID correlation is NOT access permission |
| `functions/F12-HUMANIZED-RECOVERY.md` | `functions/F12-HUMANIZED-RECOVERY.md` | **YES** | Fail-closed 404 / transient 503 / safe App preservation |
| `registries/recovery-registry.json` | `registries/recovery-registry.json` | **YES** | New stable API ID mappings; now v1.4.0 / 135 distinct entries, `phase_1_freeze_audit=PENDING_HUMAN_APPROVAL` |

The other **56** old Projection Map entries must remain byte-for-byte accounted for, or any altered output requires its own approved Design scope and provenance. Do not substitute current Design main for unapproved entries.

## 3. Rebaseline Gate checklist: state after Design merge

| Gate | Actual state |
|---|---|
| Human approval for Design PR #37 merge | **PASS** |
| GitHub Design PR #37 merge / canonical main | **PASS** — `2e74ea19623c81261bf408856543717e943f6f51` |
| Change boundary: eight source owner paths | **KNOWN** |
| Derived exact eight-path source on old locked source | **BLOCKED / NOT GENERATED**; overlap resolution needed on F00/F01/F05/F07 |
| Recovery Registry version 1.4.0 Freeze Audit marker | **PENDING_HUMAN_APPROVAL**, not PASS |
| Acceptance IDs / Test IDs for new PoP, grant, F05 owner-only Share, private body read | **NOT MAPPED as new approved registry entries**; no fake pass |
| Existing T006 nine executable mapped tests | **UNCHANGED & REQUIRED**; still lack CI evidence |
| Human **Build Freeze** authorization | **NOT GRANTED** by Design PR merge |
| `BS-P1-025` 64-entry deterministic Projection + file inventory SHA256 | **NOT CREATED**; no forged LOCKED manifest |
| T006 Task/Backlog rebind & activation | **NOT DONE**; old `BS-P1-024` still active |
| PC B Docker/test database/Cursor login Git preflight | **PREVIOUSLY REPORTED PASS**, do not rerun |
| T006 single-use GitHub Watcher lease | **NOT EMITTED**; old `6077067017` already consumed |
| PG #347 protected Worker L3 / real least-privilege PostgreSQL positive writes | **NOT PROVEN / SEPARATE GATE** |

## 4. Stage boundary (protect schedule without inventing Product)

Current `delivery/sprints/SP-P1-003/manifest.json` explicitly excludes F05 Share restore/durable Share Stage B. `T006` is `IN_PROGRESS`, bound to `BS-P1-024` and its exact **nine** mapped IDs:

`TEST-F03-009`, `TEST-F03-AC-024`, `TEST-F00-007`, `TEST-F00-AC-009`, `TEST-F00-010`, `TEST-F00-011`, `TEST-F00-AC-012`, `TEST-F00-036`, `TEST-F00-037`.

Recommend **do not move F05 Stage B functionality into T006**. New read security that is required to perform the current Stage A end-to-end chain must be owned by a separately approved cross-cutting implementation/PG L3 dependency and tested. Moving it into the L1 Cursor allowed paths would silently bypass protected `tooling/`, `supabase/`, `harness/`, `build-spec/` and release controls.

## 5. Exact next operations (named owners)

1. **ChatGPT / governance:** isolate approved PR #37 clauses into candidate Design Freeze source based on pinned `736c757e...`, with exact eight-path provenance; independently reconcile F00/F01/F05/F07 overlapping text. Keep this as an unmerged candidate until verified.
2. **ChatGPT / Design audit:** verify no unintended diff, resolve Recovery Registry freeze status and any required new Acceptance IDs from actual Design owners. Lock exact candidate SHA only after independent PASS.
3. **Human / Build Freeze:** approve the reviewed *actual* candidate scope + `BS-P1-025` freeze, separately from already approved Design PR merge.
4. **ChatGPT / Projection:** deterministic 64-entry Projection Map `FULL_COPY / SECTION_FILTERED / REFERENCE_ONLY`; verify source Git blob SHA and output SHA256, full manifest aggregation/CI on isolated Build PR; never touch `BS-P1-024`.
5. **Human / Activation:** separately approve active Task/Backlog rebind as warranted; do not silently reopen completed T001–T005, or start next Task.
6. **Cursor after applicable gates:** one fresh SHA-bound T006 single-use Watcher lease on build Issue #301; execute real F01→F02→F03→S03 interaction and nine required tests. Independent BCE, Human implementation merge/closure later.

## 6. Independence / protection

This audit names objective blockers, **not** proof of finished tests or a request for more local environment diagnosis. No protected Design main rewrite, production DDL, implementation mutation, PG R4/R5 constitutional signature, Cursor launch, merge or closure is approved by this candidate PR.

**VERDICT: PR37-DESIGN-MERGE=PASS; SOURCE-PROJECTION/FREEZE=BLOCKED; T006 EXECUTION=NOT STARTED.**
