# appf2 Build Execution Handoff Protocol

> Canonical Current Truth for Human / ChatGPT / Cursor execution collaboration.
>
> Scope: Build execution collaboration, Task handoff, review outcomes, manual actions, secret handling, and Product/Spec gap escalation.
>
> This document does **not** redefine Product truth, Build Spec, Acceptance, Sprint scope, or Task scope.

## 1. Purpose

This protocol defines how the three execution roles cooperate after Build planning is ready:

```text
Human = Product / Governance / External Authority
ChatGPT = Planning / Audit / Translation Layer
Cursor = Execution Engine
```

Chat transcripts are discussion context. Git commits / PRs are historical evidence. This file is the canonical current execution-collaboration rule.

## 2. Authority Boundary

### HUMAN

Human is the authority for:

- Product truth and Product decisions
- Governance approval
- Sprint Activation
- Product / UX / behavior choices
- External platform accounts and permissions
- Secrets and production credentials
- Sprint Close
- Release Approval

Human does not need to review every line of code. Human intervenes when a decision or external action actually requires Human authority.

### ChatGPT

ChatGPT is the sole Planning Agent and execution auditor for this operating model.

Responsibilities:

- Sprint / Task planning before activation
- Task scope audit
- Code and architecture review
- AC/Test mapping audit
- Engineering quality audit
- Test-quality and fake-green audit
- Evidence audit
- Semantic-drift audit
- Cursor instruction generation
- Technical-to-Human translation
- Manual Action triage
- Product / Spec gap triage
- Next-Task selection according to the approved Sprint dependency graph

ChatGPT does not invent Product decisions or silently modify locked contract semantics.

### Cursor

Cursor is the execution engine.

Responsibilities:

- Implement the active Task
- Build mapped executable tests
- Run required commands
- Debug and fix implementation issues
- Create Evidence
- Create Findings when required
- Perform assigned review work

Cursor must not:

- change Product requirements
- expand Task scope
- change locked Build Spec
- change Acceptance semantics
- re-plan the Sprint
- decide Product ambiguity
- skip Task dependencies
- self-authorize Production or external-platform changes

## 3. Execution Preconditions

Product implementation is legal only when all machine and Human activation conditions are satisfied.

Before Human Sprint Activation:

- Sprint remains HOLD / PLANNED
- no active Task exists
- `implementation_enabled=false`
- Product implementation is forbidden

Activation is a control-state transition only. The Activation PR must not contain Product code.

Activation PR must pass all four governance checks before merge:

```text
CI Gate
Governance Gate
Governance Attack Dry-run
CodeQL
```

After the Activation PR passes all required gates and is merged:

- exactly one Sprint may be active
- exactly one Task may be active
- Cursor receives only that active Task as execution scope
- locked Build Spec + active Task + mapped contracts remain the execution truth

Cursor must never treat the entire Sprint, Backlog, or Build Spec as free implementation scope.

## 4. Cursor Task Completion Handoff

When Cursor finishes a Task attempt, Cursor must provide:

```text
Task ID
PR number
commit SHA
changed files
AC/Test covered
commands executed
test results
Evidence created
Findings created
manual actions required
known risks / remaining issues
```

Preferred Human handoff sentence:

```text
T001 Cursor 做完了，PR #XX，請驗收。
```

Human does not need to paste long Cursor output into ChatGPT when the PR is available in GitHub.

## 5. ChatGPT Verification Rule

ChatGPT must re-read GitHub and independently verify the PR. Cursor's summary is not proof.

Minimum review:

1. Task scope was followed.
2. No undeclared work was added.
3. Allowed write paths were respected.
4. AC/Test mapping is correct.
5. Executable tests actually verify mapped Acceptance semantics.
6. No fake-green mechanism exists.
7. Error and boundary cases are handled.
8. Code is readable.
9. Duplication is reasonable.
10. Complexity is reasonable.
11. Performance matches the execution context.
12. Architecture dependency direction remains valid.
13. Type safety is maintained.
14. Security boundaries are preserved.
15. Evidence is complete.
16. Reviewer Quality is PASS.
17. No Product / Spec semantic drift occurred.

Task completion is never accepted solely because Cursor says "done" or tests are green.

## 6. Allowed Review Outcomes

ChatGPT returns exactly one execution outcome.

### PASS

Use when implementation, tests, quality, Evidence, and semantics all pass.

```text
PASS
→ Task may proceed to VERIFIED / CLOSED
→ prepare the next dependency-legal Task
```

### CURSOR_FIX

Use for engineering defects that do not require a Human Product decision.

Examples:

- missing or weak tests
- type-safety issue
- architecture violation
- missing error handling
- avoidable duplication
- bad complexity
- Evidence incomplete
- fake-green or insufficient assertions

ChatGPT must return a precise fix instruction scoped to the same PR / Task. Cursor must not expand scope or change Build Spec / Acceptance.

### HUMAN_REVIEW_REQUIRED

Use only when a real Product / UX / behavior choice requires Human authority.

Examples:

- user-visible behavior choice
- UX tradeoff
- visual comparison
- user-flow difference
- business-rule choice

ChatGPT must translate the issue into plain language, present the concrete alternatives and tradeoffs, and identify what the locked contract does or does not decide.

### HUMAN_MANUAL_ACTION

Use when an external platform or privileged Human action is required.

Examples:

- Supabase
- Cloudflare
- GitHub Environment
- Secrets
- Production approval
- Domain / DNS
- LLM Provider account

ChatGPT must provide:

```text
platform
purpose
where to configure it
required secret / variable names
completion criterion
```

Never ask Human to paste a secret value into ChatGPT or Cursor chat.

### SPEC_GAP

Use when implementation exposes real contract ambiguity or missing Product truth.

```text
Cursor Finding
→ affected Task BLOCKED
→ ChatGPT analyzes Build Spec / implementation impact
→ Human decision if required
→ Design Delta / rebaseline when contract-affecting
```

Cursor must not guess, hardcode a temporary Product rule, add a TODO and continue, or silently reinterpret Acceptance.

## 7. Manual Setup Principle

External setup is **Just-in-Time**.

Do not configure every external system or secret in advance. Configure only what the next approved Task actually requires.

Typical Sprint 1 expectation:

- T001 Capability Registry: no DB / LLM / Cloudflare runtime secret required
- T002 Capability Trust: normally no external platform required
- T003 Capability Coverage: normally no external platform required
- T004 Blueprint identity/hash: no DB / LLM required
- T005 Anonymous identity boundary: should first be implementable without Production DB
- T006 Evidence envelope / intake / idempotent ingestion: first explicit Human Manual Infrastructure Checkpoint

T006 is the first Sprint 1 Task that may require real infrastructure for Supabase PostgreSQL, DB migration, and edge ingestion.

Before T006 starts, ChatGPT must re-audit the concrete implementation requirements. If a real Supabase environment is required, ChatGPT emits HUMAN_MANUAL_ACTION before Cursor proceeds.

## 8. Known Deployment Secret Names

Current deployment contract names:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_PAGES_PROJECT
CLOUDFLARE_WORKER_NAME

SUPABASE_ACCESS_TOKEN
SUPABASE_PROJECT_ID
SUPABASE_DB_PASSWORD
```

GitHub Environments:

```text
staging
production
```

The same secret name may exist in different Environments with different values.

## 9. Secret Security Rule

Never:

- paste secret values into ChatGPT
- paste secret values into Cursor chat
- commit secrets
- place secrets in Blueprint data
- expose provider keys to the browser
- store secrets in Evidence
- print secrets to console logs

Human confirmation should contain status only, for example:

```text
Staging Supabase secrets configured.
```

No actual secret value is required in chat.

## 10. LLM Provider Setup

Sprint 1 does not require a production LLM key.

Model Gateway / Compiler work belongs to the later F01 implementation Sprint.

The locked architecture requires:

- provider adapter boundary
- server-only provider key
- OpenAI-compatible / Groq-compatible implementation may be used
- provider SDK must not enter the client
- provider key must not enter the browser

Do not pre-create an LLM secret before the F01 Sprint planning / manual setup gate decides the actual provider and environment-variable contract.

## 11. Cursor Manual-Dependency Flow

Cursor must not directly request privileged credentials from Human.

Correct flow:

```text
Cursor
→ Finding / manual dependency
→ ChatGPT verifies necessity
→ HUMAN_MANUAL_ACTION
→ Human completes action in external platform
→ Human reports completion status only
→ ChatGPT authorizes the execution flow to continue
```

## 12. Spec Gap / Rebaseline Flow

For contract-affecting gaps:

```text
Finding
→ Task BLOCKED
→ ChatGPT triage
→ Human Product / Design decision when needed
→ appf2-design update
→ Human Freeze
→ new immutable Build Spec (for example BS-P1-002)
→ affected Backlog / Task rebaseline
→ resume
```

An existing immutable Build Spec must never be edited in place to hide an implementation-discovered contract gap.

## 13. Task Close

A Task may close only when:

```text
Mapped AC/Test PASS
+ Required Commands PASS
+ Type / Lint / Security / Build PASS
+ Engineering Quality Review PASS
+ Semantic Drift Review PASS
+ Evidence Complete
= VERIFIED / CLOSED
```

After close, ChatGPT selects the next dependency-legal Task according to the approved Sprint plan. Cursor does not self-select the next Task.

## 14. Process Failure / Hard Stop

Execution must avoid tool-orchestration retry loops.

Rules:

```text
same path fails 2 times → change method
single work item has not converged within 10 minutes → hard stop and surface the blocker
do not fan out across multiple repos unnecessarily
do not extend a failing path with "almost done" reasoning
```

A failed execution path must be made explicit instead of being silently retried indefinitely.

## 15. Canonical Relationship

```text
Chat                       = discussion
PR / Commit                = historical evidence
EXECUTION-HANDOFF-PROTOCOL = current execution collaboration rule
Build Spec / Sprint / Task = execution scope and Product contract authority
```

If this protocol conflicts with locked Product truth, locked Build Spec, machine-enforced Sprint/Task controls, or Human authority, those higher-order controls win. This protocol defines collaboration behavior; it does not redefine Product semantics.


## 16. Project Open Items / New Chat Continuity

Canonical project-level unresolved-work ledger：

```text
delivery/PROJECT-OPEN-ITEMS.json
```

它只保存「不能忘、但不一定屬於 active Sprint Task / Finding」的事項，例如：
- deferred Open PR review
- Human manual cleanup
- non-blocking governance cleanup
- local artifact cleanup
- future checkpoint that must survive a new Chat

不得把已由 Backlog / Finding / Task 擁有的完整內容再複製一份；ledger 只保存 pointer、status、owner、blocking scope、next action、resolution reference。

每次 new Chat / handoff 的最低 cold-start set：

```text
build-spec/CURRENT.json
delivery/CURRENT-SPRINT.json
active/next Sprint plan when applicable
delivery/PROJECT-OPEN-ITEMS.json
unresolved delivery/findings/
complete live Open PR inventory
next governance gate
```

不要求每次重讀整個專案歷史。完整歷史 review 固定在 Sprint Close / Phase Close 執行。

Handoff 不得只靠 Chat transcript 或 model memory；任何仍需 carry-forward 的 project-level item 必須先進 GitHub canonical ledger。

## 17. Local Cursor Automation Transport Constitution

本節是 Human / ChatGPT / PC B Local Cursor 之間的 canonical execution-transport rule。它只自動化「搬運已批准指令與回傳執行結果」，**不得改變任何既有 Product / Build Spec / Sprint / Task / Human authority boundary**。

### 17.1 Canonical Flow

```text
Human explicit approval
→ ChatGPT independently derives the authorized Cursor instruction from GitHub SSOT
→ GitHub Issue #137: APPf2 Local Execution Queue
→ PC B local watcher polls the queue
→ local Cursor CLI executes on PC B
→ watcher persists the raw result locally
→ watcher posts APPF2-RESULT back to Issue #137
→ ChatGPT independently re-reads GitHub / PR / diff / tests / evidence
→ Human merge / BF resolution / Task closure / Sprint activation approval when required
```

The automation removes manual copy/paste only. It does not collapse Reviewer and Implementer into one authority.

### 17.2 Queue Authority

Canonical transport queue:

```text
NFF98/appf2-build
GitHub Issue #137
APPf2 Local Execution Queue
```

Issue #137 is a **transport ledger**, not Product truth, Build Spec truth, Acceptance truth, Task truth, or completion Evidence by itself.

A watcher-executable command must satisfy all of the following:

- comment author is the authorized Human account `NFF98`;
- body contains exactly the execution authorization marker `[APPF2-EXECUTE][APPROVED]`;
- Product implementation commands identify the intended `TASK=Txxx`;
- the Task and Build Spec named by the instruction must agree with canonical `build-spec/CURRENT.json` and `delivery/CURRENT-SPRINT.json`;
- Human authorization required by the governance state must already exist.

Discussion comments, audit notes, Cursor summaries, or unapproved instructions must never trigger execution.

### 17.3 PC B Local Execution Boundary

The default implementation executor remains **PC B local Cursor CLI** unless Human governance explicitly authorizes another executor.

Operational preconditions:

- PC B is powered on;
- PC B has network access;
- the watcher process is running;
- Cursor CLI authentication is valid;
- the repository checkout and required local toolchain are available.

The Cursor browser login-success page is not required after CLI authentication succeeds.

The automation must use PC B local CPU / RAM / filesystem / Node toolchain. A future move to Cursor Cloud, another VM, or another executor is a governance change and must not happen silently.

### 17.4 Exactly-Once Execution Safety

The watcher must implement **at-most-once Cursor execution per approved GitHub command**.

Required behavior:

1. persist the command/comment ID as consumed **before** starting Cursor;
2. execute Cursor at most once for that command ID;
3. persist the raw Cursor result to local disk before attempting GitHub result posting;
4. if GitHub result posting fails, retry **posting only**;
5. never rerun Cursor merely because GitHub posting failed;
6. watcher restart must preserve the consumed-command state;
7. a historical command must never be replayed after watcher restart;
8. Cursor must never auto-select or auto-start the next Task.

Transport failure is not permission to repeat Product implementation.

### 17.5 Result and Local Log Contract

GitHub result marker:

```text
[APPF2-RESULT][COMMENT-<source-comment-id>]
```

The result must retain at minimum:

- Cursor CLI exit code;
- Task ID when applicable;
- execution summary;
- branch / HEAD when applicable;
- changed files when implementation occurred;
- required command / gate outcomes;
- Findings / blockers / manual dependencies surfaced by Cursor.

Detailed raw execution logs are local operational records and are partitioned by Task:

```text
C:\appf2-automation\logs\T002\<comment-id>.txt
C:\appf2-automation\logs\T003\<comment-id>.txt
...
```

Non-Task automation checks may use a separate general bucket.

Local automation logs must never contain secret values. They are operational trace, not Product truth and not a substitute for canonical Evidence.

### 17.6 Independent Review Remains Mandatory

Cursor output is never self-certifying.

After an automated execution result arrives:

- ChatGPT must independently inspect GitHub canonical state, actual diff, tests, PR, Evidence, and Findings;
- a green Cursor summary or `CURSOR_EXIT_CODE=0` is not sufficient for PASS;
- Human retains merge approval, BF resolution approval, Task closure approval, Sprint activation approval, and other reserved governance decisions.

The canonical separation remains:

```text
Human   = decision / approval authority
ChatGPT = planning / independent audit / instruction generation
Cursor  = implementation executor
GitHub  = SSOT + execution transport ledger
```

### 17.7 Transport Failure Rule

Failures of the watcher, GitHub Issue API, local Cursor CLI invocation, authentication, encoding, or result-posting are **automation transport failures** unless evidence shows a Product implementation failure.

On transport failure:

- do not invent Product conclusions;
- do not silently rerun implementation;
- preserve any completed Cursor result locally;
- repair the transport;
- resume from the preserved execution state.

### 17.8 New Chat Continuity

Every new Chat handoff while this operating model is active must explicitly carry:

```text
Execution transport = GitHub Issue #137
Executor = PC B Local Cursor CLI
Watcher = C:\appf2-automation\watcher.ps1
Command marker = [APPF2-EXECUTE][APPROVED]
Result marker = [APPF2-RESULT][COMMENT-<id>]
Raw logs = C:\appf2-automation\logs\<TASK>\
Exactly-once rule = GitHub post retry MUST NOT rerun Cursor
```

A new Chat must not revert to manual copy/paste by default while this automation is healthy.

### 17.9 Human Approval Envelope and GitHub Rebuild Fallback

Every governance or execution action must be covered by explicit Human authority. Approval may use either of two forms:

```text
ATOMIC APPROVAL
= approval for exactly one named next action

BOUNDED APPROVAL ENVELOPE
= approval for a named multi-step sequence up to an explicit stop boundary
```

Examples of valid bounded approval:

```text
批准到 PR checks 全 PASS 為止
批准到 Activation merge 完成
批准到 Cursor execution 前
批准完成治理修復，完成後發 Cursor execution
批准到 T006 closure；T007 不動
```

Rules:

1. A bounded approval envelope authorizes only the intermediate actions that are necessary to reach the stated boundary and that preserve the already-approved Product / Build Spec / Sprint / Task semantics.
2. Intermediate machine or governance corrections inside that envelope do **not** require repetitive Human `准` when they only repair formatting, lineage, traceability, gate metadata, or another non-semantic defect needed to complete the already-authorized transition.
3. The envelope does **not** authorize Product / Design semantic invention, Task scope expansion, a new Task/Sprint, destructive external action, secret handling, or any action beyond the named boundary.
4. Merge, Activation, governance write, branch-history rewrite, and a new `[APPF2-EXECUTE][APPROVED]` command may be included in a bounded envelope only when the Human wording clearly includes that stage. If not included, ChatGPT must stop immediately before that gate.
5. A newly discovered Product / Spec ambiguity, contract-affecting Finding, changed Human decision, or materially expanded scope invalidates the remaining envelope for the affected path and requires a new Human decision.
6. A tool/API parameter error, transient transport error, or machine-gate failure caused by ChatGPT's own non-semantic governance formatting does not consume or cancel the approval envelope; ChatGPT may correct and retry within the same authorized boundary.
7. Approval scope and execution batch size are independent: **large authorization never permits large unbounded execution batches**. §17.10 BCE remains mandatory.

Automation transports approval; it never creates, infers, or extends approval beyond the Human-stated envelope.

When a rebased or reconstructed commit exists only on PC B and is not present in GitHub's object database, GitHub cannot move a remote branch directly to that local-only SHA. If the local executor cannot push it, the canonical fallback is:

1. Human explicitly approves **ChatGPT GitHub rebuild of that exact already-reviewed patch**, either atomically or as an explicit part of a bounded approval envelope;
2. ChatGPT starts from the current canonical `main` commit;
3. ChatGPT reuses the exact approved file blobs / patch semantics only, with no scope expansion;
4. ChatGPT creates a new GitHub commit whose parent is canonical `main`;
5. ChatGPT independently verifies the resulting diff matches the approved path set and semantics;
6. only then may ChatGPT update the target PR branch;
7. the replaced remote HEAD is marked **SUPERSEDED / ARCHIVED** in the PR history and is no longer canonical.

The old commit object is historical evidence and must not be falsely described as deleted. No merge, Task start, or next execution is implied unless it is inside the active Human approval envelope.

### 17.10 Bounded Chunked Execution (BCE) Constitution

**Canonical name:** `Bounded Chunked Execution (BCE)`

**Human-facing name:** `大授權・小批次執行`

BCE is the mandatory ChatGPT orchestration method whenever one Human approval covers multiple governance, audit, GitHub, or execution-transport steps.

Core invariant:

```text
Human approval may be broad.
Execution must stay bounded.
Audit completeness must stay full.
The named Human boundary must never be crossed.
```

#### A. Approval Envelope

Before work starts, ChatGPT must resolve the Human-approved start state, allowed sequence, and stop boundary.

The envelope may span multiple internal checkpoints and multiple Chat turns. ChatGPT must not repeatedly request approval for intermediate non-semantic steps already inside the envelope.

#### B. Chunk Discipline

ChatGPT must execute the envelope as small independently auditable chunks.

Default discipline:

- prefer 1–3 tool operations per chunk;
- retrieve only the smallest file range, diff, log slice, or structured state needed for the current check;
- do not fetch an entire repository, large commit payload, whole large file, or full CI log when a targeted query/range can answer the question;
- if a tool unexpectedly returns a very large payload, switch to a narrower method before continuing;
- separate state inspection, mutation, gate verification, merge, canonical recheck, and Cursor dispatch into distinct chunks.

These are stability limits, not reductions in review rigor.

#### C. Checkpoint Rule

After each material chunk, ChatGPT maintains a compact checkpoint containing at least:

```text
canonical base/head when relevant
what was verified or changed
gate/check status
remaining authorized steps
current stop boundary
new blocker, if any
```

A checkpoint may be communicated in chat and/or persisted in GitHub when governance state itself changed. Interruption must resume from canonical GitHub truth plus the surviving Human approval envelope; completed external actions must not be replayed merely because the chat disconnected.

#### D. Chunked Full-Audit Invariant

Chunking must never become partial audit.

For audit/review work, ChatGPT must maintain an assembled audit ledger covering all applicable dimensions, including:

```text
canonical state
RESULT / candidate identity
scope + non-scope
contract / semantics
AC/Test mapping
required commands / gates
evidence
security / quality / drift
blockers
final verdict
```

Individual dimensions may be checked in separate chunks, but the final verdict requires a completeness pass across the full ledger. Unchanged evidence may be reused by reference instead of re-fetching it.

#### E. Automatic Non-Semantic Repair

Inside an active approval envelope, ChatGPT may automatically repair its own non-semantic governance defects required to reach the authorized boundary, for example:

- malformed activation metadata;
- incomplete baseline/backlog rebind caused by the same approved rebaseline;
- formatting / traceability / lineage fields required by machine gates;
- tool-call parameter mistakes;
- retrying CI/check inspection after the corrective commit.

This authority ends immediately if the repair would change Product truth, locked contract semantics, Task scope, Acceptance meaning, or another Human-reserved decision.

#### F. Stop Conditions

ChatGPT must stop before the first action that is:

- outside the Human approval envelope;
- a newly required Product / Design decision;
- a contract-affecting semantic change not already approved;
- a newly discovered blocker that changes the authorized path;
- an explicitly reserved Human gate not named in the envelope.

At the stop point ChatGPT reports the canonical checkpoint and the exact next gate.

#### G. Relationship to Cursor Execution

A bounded approval that ends **before Cursor execution** must stop before posting `[APPF2-EXECUTE][APPROVED]`.

A bounded approval that explicitly includes **Cursor execution** may post exactly one fresh command for the currently active Task after all preconditions have been independently rechecked.

BCE never turns prior RESULT text, copied command text, historical approval, or workflow continuity into Cursor authority.

#### H. Anti-Crash / Anti-Overfetch Principle

Operational stability is part of governance quality.

ChatGPT must prefer:

```text
targeted read
→ bounded mutation
→ targeted gate check
→ checkpoint
→ next chunk
→ assembled final audit
```

over:

```text
broad approval
→ giant fetch
→ many unrelated tool calls
→ giant output
→ implicit state assumptions
```

The second pattern is prohibited when the first can accomplish the same governed result.

## 18. Lean Task Lifecycle（GOV-REFORM-20261013）

本節把 16 項治理改革落實為可機器檢查的流程。機器規則：`harness/policy/governance-reform.json`；授權邊界不變：Human 批准、ChatGPT 規劃／稽核、Cursor 實作。

### 18.1 一個 Task 一個 PR（狀態機）

`AUTHORIZED_TASK → DRAFT_DEVELOPMENT → LOCAL_AC_TESTS_PASS → GPT_BCE_PASS → HUMAN_FINAL_INTEGRATION_READY → EXACT_HEAD_FULL_GATES_PASS → HUMAN_MERGE_APPROVED → MERGED → EVIDENCE_AND_CLOSURE`（`harness/scripts/task-pr-lifecycle.mjs`）。

- 同一 Task 的實作、Bugfix、測試修正、Review 回饋，全部留在**同一個 Draft PR、同一分支**持續 commit。
- 任何新 commit 都會使 HEAD 綁定的狀態（Local PASS、BCE、Final Ready、Full Gate、Merge Approval）回到 `DRAFT_DEVELOPMENT`；Merge 後的 commit 不繼承任何授權。
- `HUMAN_FINAL_INTEGRATION_READY`、`HUMAN_MERGE_APPROVED`、`MERGED`、`EVIDENCE_AND_CLOSURE` 只有 Human 能設定；GPT 只能給 BCE；CI 只能給 Full Gate 結果。
- **一次授權候選真實狀態：BLOCKED_NOT_IMPLEMENTED（不得宣稱已生效）**。原型接受呼叫者自己填 `provenance_checked_by_trusted_executor=true`，這不能證明 Human 身分；已改為 `GPT_DELEGATED` 的 Human-only Final Ready／Merge／Closure 一律 HARD STOP。正式 Human 的原有權限不受影響。必須先配置獨立不可由 AI 偽造的 Human 核准驗證路徑與受保護 GitHub 執行器、完成真實端到端／負向實測、由 Human 依法批准並 Merge，才可另案討論啟用。一般 4/4 CI PASS 或 46 項 synthetic test 不構成授權。

### 18.2 禁止重複核准、Bugfix 持續執行

- 同一有效 Task lease、同一 Sprint／Build／scope：Bugfix、測試、Evidence 直接繼續，**不得**再要求 Activation 或核准（`leaseDecision` = `CONTINUE_SAME_LEASE`）。
- Task、Sprint、Build Spec 或 `allowed_write_paths` 任一改變 → 需要新的 Human 授權，不繼承。
- Activation 只在執行權改變時需要（active Sprint／Task／Build、baseline、`implementation_enabled`、從非執行狀態恢復）。
- Rebind 只在 baseline 或 AC／Test／Backlog mapping 改變時需要；程式修正永遠不需要 Rebind。

### 18.3 測試分層：Draft 快速迴圈 vs Final Ready 完整 CI

- Draft PR：`fast-loop` job 依 `select-impacted-tests.mjs` 只跑相關測試；無法判定或共用路徑一律退回全套。結果明列 `NOT_RUN`，**永遠不是 full-gate PASS**。
- Draft PR 上的 required `ci` 與 `Analyze JavaScript / TypeScript` 會明確 FAIL 為 `NOT_READY`（不可 skip，因為 skipped 會被 GitHub 視為成功）。`governance` 與 `attack` 每次照跑。
- Human 按下 Ready for review（Final Ready）後，四個 required checks 在精確 HEAD 上完整執行；`finalGateVerdict` 只接受 mode FULL、conclusion success、同一 HEAD。
- 本機開發：每修一次 bug，先跑 `BASE_SHA=<base> node harness/scripts/select-impacted-tests.mjs --run`。

### 18.4 Evidence 自動整理與 Closure 精簡

- `node harness/scripts/evidence-ledger.mjs --sprint <SP> --task <T>` 自動列出缺少的 AC／Test PASS、required command、Reviewer、重複、過期（source SHA 不在 main 歷史）、未引用與懸空引用，並產生建議的 `completion_evidence`。它只整理、不判定 PASS。
- 選填欄位 `proof_level`（STATIC／MOCK／API_IN_PROCESS／REAL_POSTGRES／REAL_BROWSER／EXTERNAL_RUNTIME）讓 Mock、API、真實 PostgreSQL、真實瀏覽器證明分開標示；不改變 Phase 1 驗收語意。
- Closure 精簡：同一個控制轉換 PR 可以同時帶入該 Task 的 Evidence／Finding 記錄；Evidence Gate 仍獨立驗證每一筆。

### 18.5 Human 通用特批與 Sprint 中修改 SSOT

依憲法 §7 的五種通道（`GOVERNANCE_REFORM`、`PROTECTED_SSOT_AMENDMENT`、`BUILD_SPEC_ACTIVATION`、`CLOSURE_DEFERRAL`、`HOTFIX`）。特批只能 waive 程序 Gate，絕不把 FAIL／UNTESTED 變成 PASS，也不取代 Human Merge 核准。

- Sprint 進行中變更 Product／Build Spec：先在 Design Repo 經 Human 批准，再依序開兩個 PR：(1) `PROTECTED_SSOT_AMENDMENT` 新增 immutable baseline、Delta、Finding 與影響分析；合併後 (2) `BUILD_SPEC_ACTIVATION` 新增 Activation 記錄、移動 `CURRENT.json` 並把 Sprint／Task／Backlog 的 `build_spec_id` 重新綁定。Sprint 與 Task 狀態保持不變，舊 baseline 永不改寫。
- 已合併的 `CLOSURE_DEFERRAL` 每次 Gate 執行都重新驗證期限、範圍（含 Build Spec）、Human 核准欄位、撤銷與重放；過期或不符即失效。延長或替換須開新 docket，撤銷用另一份 docket 的 `revokes_exception_case_ids`。

### 18.6 GPT 執行前檢查與 PR 新增限制

- ChatGPT 在建立 PR、請求 Activation、核准或 Rebind 前，必須先跑 `node harness/scripts/gpt-preflight.mjs state --task Txxx --intent <INTENT> --open-prs <file>`，並在回覆中引用輸出。結果為 `REDUNDANT_*`、`REBIND_NOT_REQUIRED`、`REUSE_EXISTING_PR` 或 `STOP` 時不得提出該請求。
- PR body 必須以 `Task: Txxx` 宣告 Task。同一 Task 已有 open PR 時，Governance Gate 會 FAIL，除非 body 有 `PR-Justification: <NONCOMBINABLE_AUTHORITY_BOUNDARY|CONTROL_TRANSITION_AFTER_MERGE|HOTFIX|SUPERSEDES_CLOSED_PR> <說明>`。

### 18.7 禁止假綠燈

- NOT_RUN、UNTESTED、SKIPPED、Draft／fast-loop 結果、過期 HEAD 的結果都不是 PASS。
- 不得用 `.skip/.only/.todo`、`@ts-ignore`、blanket `eslint-disable`、mock 冒充真實 PostgreSQL／瀏覽器證明。
- 任何特批都必須聲明 `never_converts_fail_or_untested_to_pass: true`。

### 18.8 Governance／Hotfix 分流

`task-pr-lifecycle.mjs classify` 把每個 diff 歸類為 BUGFIX／TEST（同 lease）、EVIDENCE、CLOSURE／STATE CONTROL、ACTIVATION、FREEZE／REBASELINE、GOVERNANCE、HOTFIX、OUT_OF_TASK_SCOPE 或 MIXED_FORBIDDEN，並在 Governance Gate 中輸出（僅供參考，合法性仍由各 Gate 判定）。治理與產品碼混在同一 PR 一律需要拆分或精確特批。

### 18.9 改革成效統計

`node harness/scripts/governance-metrics.mjs --runs <runs.json> --open-prs <prs.json> --out <file>` 產出：每個 Task 的 PR 數、Human 核准數與重複核准、完整 CI 執行次數與同 HEAD 重跑、返工 commit 比例、open PR 數。基準值：`delivery/audits/GOV-REFORM-20261013-METRICS-BASELINE.json`。

### 18.10 GOV-REFORM-20261013 原始十六項的真實落地驗收（不得假結案）
- 唯一需求來源：Human 於 2026-10-13 批准的 Issue #389 九項、六項補強，以及 Human 另要求的 ACTIVE Sprint 中 SSOT／Design／Build Spec 精確特批（第十六項）。不可把後來新增 W01 專案或單純的程式變更冒充這十六項完成。
- `harness/scripts/reform-wiring-audit.mjs` 的 16 項都是 **STATIC_WIRED 入口診斷**。該工具另列逐項 `UNVERIFIED_E2E` 的具體缺口；不得把 16/16 靜態字串存在、synthetic 46 PASS 或 GitHub 四 Gate PASS 對外改稱 16/16 實施。
- 任何「全部完成／正式頒布實施」聲明必須：真實 GitHub 主分支已合併、每項 E2E 正反測試證據、獨立 BCE、可信 Human 核准來源、工具呼叫前的 PR 權限邊界，以及 Design Repo 自身強制測試。缺其中任何條件只能標 PARTIAL 或 BLOCKED。
- Evidence 自動化目前是唯讀彙整報告，非自動寫入 canonical Evidence；週報 workflow 合併前未啟用、合併後還須取得一次真實運行證據；Phase 1 全真實驗收政策仍為待獨立 Human 決定。
- **正式語言遵守**：上位 `NFF98/appf2-design/SSOT.md` 的 Official Language Rule 要求 Human-facing／治理說明以繁體中文為唯一 authoritative 語言。ChatGPT 實際回覆不能靠 repository CI 保證，需每次直接遵守；一旦使用英文主導回覆即明確紀錄違規與更正，不能以文件存在冒充執行。


### 18.11 一次 Human 核准真正執行通道（待 Main 實施，不得假綠燈）
- **單 Task 實作 PR 與 Closure 控制 PR 的精確例外**：正常實作仍只使用一個 enduring Task PR。若它完成真實 Merge 後才有資格關閉 Task，既有憲法／PR Guard 允許 **在原 PR 已 Merge 之後** 使用一份獨立、受保護、只修改同 Task `tasks.json` status 的控制 PR，須含 `Task: Txxx`、`Closure-Source-PR: <原已合併 PR 編號>` 及 `PR-Justification: CONTROL_TRANSITION_AFTER_MERGE <非空理由>`，建立時間必須晚於原 Merge。這份控制 PR **不是第二個實作 PR，也不能啟動第二個 Task、重複索取 L1 Human Task 授權或跳過 CI／BCE／GitHub branch protection**；但必須如實計入實際 PR 數（不能宣稱每 Task 物理上只有一份 PR）。既有 T006／T008 的 L3 closure-order 決定仍獨立必要，不能靠一次 L1 授權繞過。
**正常 Task：規劃 → Human 在 GitHub protected Environment 一次批准 → GPT 依該核准進行 Task Activation → 同一 Task PR 開發／Bugfix／Fast-loop → 真實 CI 四 Gate → GPT 獨立 BCE → GPT 讀取可信授權與證據後依保護規則 Merge → Evidence／一般 Task Closure → STOP。** 無第二次 Human Final Ready／Merge／Closure 核准；異常、範圍或基線變更、授權到期、缺少真實驗證則 HARD STOP。下一 Task/Sprint 一律要另一次 Human 授權；Sprint 特批行政結案仍獨立。
- GitHub 設定前提：Build Repo 為 public，`Settings → Environments → appf2-task-human-approval` 必須選 **Required reviewers: NFF98**。若沒有這條真正的 GitHub 設定，工作流程即使執行也必須 FAIL；禁止讓 GPT 留言自稱 NFF98。此設定為部署前一筆 Admin 配置，非每 Task 的第二次核准。
- Human 核准之前，GPT 準備 immutable `delivery/task-grants/Txxx.json`，含 `APPF2-TRUSTED-TASK-GRANT-1`、task_id、sprint_id、build_spec_id、scope_sha256（包含 AC/Test + allowed_write_paths）、base_sha、approved_at_unix、expires_at_unix（最多 30 日）。`workflow_dispatch` 啟動 `task-human-grant.yml`，Human **只在 Environment 按一次批准**；`task-human-grant-issuance.mjs` 查 GitHub 審核者、工作流程、任務快照及期限；准許在 Task 還是 PLANNED 時核准，無須先求 Human Activation。
- 任務後續 PR 必須帶 `Task: Txxx`、`Task-Grant-Run: <GitHub run ID>`，且不得改寫原核准 Task 描述。Required `governance` Gate 對真實 GitHub workflow approval history、reviewer、HEAD ancestry、Task Scope、現行 Sprint/Build 綁定再次查驗。缺其中任何一項就 FAIL；不得使用 `provenance_checked_by_trusted_executor=true` 冒充。
- 正式 Final Ready 稽核對 L1 任務只接受一次 GitHub Environment Human 核准 + 真實同 HEAD 四 Gate + local TEST／獨立 GPT BCE，**不得再要求 Human 留 FINAL_READY 留言**；L2/L3 原有獨立核准要求完全維持。
- **尚未完成的落地依賴**：GitHub Environment 必須由 Human Admin 配置；可信 Task Activation 寫入與 Merge／Closure 的受保護 GitHub 執行鏈需實際端到端確認；Task 前置核准與正常合併必須在 Main 上至少實測一次並留下 Reviewer/Evidence。沒有這些，不得宣稱 16/16 全部落地。
