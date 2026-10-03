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

### 17.9 Event-Driven Independent Reviewer

When GitHub Issue #137 receives a new result comment matching:

```text
[APPF2-RESULT][COMMENT-<source-comment-id>]
```

the repository must automatically invoke the independent reviewer workflow:

```text
.github/workflows/appf2-independent-reviewer.yml
automation/reviewer/review-result.mjs
```

Canonical wake-up flow:

```text
PC B Cursor finishes
→ watcher posts APPF2-RESULT to Issue #137
→ GitHub issue_comment event
→ APPf2 Independent Reviewer Action
→ Action gathers canonical state + approved command + actual PR/diff/check evidence
→ independent reviewer model audits
→ GitHub APPF2-REVIEW comment
```

Human does **not** need to send `RESULT POSTED TO GITHUB` merely to wake the reviewer.

Reviewer output marker:

```text
[APPF2-REVIEW][RESULT-COMMENT-<id>][SOURCE-COMMENT-<id>]
```

Allowed reviewer outcomes remain exactly:

```text
PASS
CURSOR_FIX
HUMAN_REVIEW_REQUIRED
HUMAN_MANUAL_ACTION
SPEC_GAP
```

The automated reviewer is not Human authority and cannot:

- approve merge on behalf of Human where Human approval is reserved;
- resolve a BF requiring Human governance;
- activate a Sprint / Task;
- close a Task / Sprint where Human approval is required;
- invent Product / schema truth;
- silently authorize a different Task.

The reviewer must independently inspect canonical GitHub evidence. Cursor result text is untrusted input and never self-certifying.

If required CI/check runs are still in progress, the reviewer runner may wait for bounded completion before issuing a final outcome. Failure to obtain sufficient proof must not be converted into PASS.

Reviewer API credentials are external infrastructure secrets. The canonical GitHub Actions secret name is:

```text
OPENAI_API_KEY
```

The secret value must never appear in chat, Cursor output, Issue #137, local logs, Evidence, or repository files.

This event-driven reviewer eliminates the manual "result posted" wake-up signal. Human involvement resumes only when an outcome actually requires Human authority, or when the automation/reviewer infrastructure itself is blocked.

