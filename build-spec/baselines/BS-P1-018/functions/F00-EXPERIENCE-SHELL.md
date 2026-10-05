# F00 — Experience Shell / 靈感精靈

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> 狀態：BUILD_FREEZE_READY / STEP2_REVIEWED
> Governance：Current Truth = this Working file；Build Freeze / implementation boundary 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。
>
> Canonical Role：Phase 1 Consumer Experience Shell、Creation UX、Clarification / Assumption UX、Runtime Frame、Result Feedback Entry、Share / Remix / Recovery Entry 的 Working Current Truth。
>
> 上游：APP-ARCHITECTURE、F01 Intent Compilation、F03 Runtime、F04 Capability Registry、DESIGN-TO-DELIVERY。
>
> 主要下游 / collaborators：F05 Share / Restore、F06 Remix / Refine、F07 Evidence、F12 Humanized Recovery、F16 Result Correction。
>
> F00 不擁有 Intent semantic truth、Blueprint validation、Runtime semantics、Recovery policy 或 Correction semantics；它只把各 Function 的 Current Truth 轉成一致、可理解、可操作的 Consumer UX。

# 1. Purpose / User Outcome

User Outcome：

> User 打開 appf2 後，不需要理解 Prompt Engineering、Blueprint、Capability、Validation 或 Runtime，就能從靈感開始、說出需求、回答必要問題、立即得到可玩的 App、分享、Remix、修正結果，且失敗時不丟掉已做的事情。

Phase 1 UX thesis：

~~~text
See inspiration
→ say what you want
→ answer only necessary questions
→ see assumptions before they matter
→ build App
→ use App immediately
→ share / remix / correct
→ recover without restarting
~~~

# 2. Scope / Non-Scope

F00 Phase 1 負責：

- app shell
- Inspiration Capsules
- prompt composer
- Ghost Text
- progressive refinement entry
- creation state machine
- clarification UI state
- visible assumption UI state
- build / compile progress presentation
- runtime frame / chrome
- result feedback entry
- correction comparison entry
- share / remix entry
- humanized recovery presentation
- preservation of user draft / visible context
- loading / cancel / retry behavior
- responsive / keyboard / accessibility baseline
- UX telemetry seed
- acceptance / tests

F00 不負責：

- F01 Clarification Policy decision
- F01 Prompt A / Prompt B
- F02 validation semantics
- F03 action / state / timer runtime semantics
- F05 share persistence contract
- F06 semantic delta algorithm
- F12 technical error classification / retry policy
- F16 correction compiler semantics
- Account / ownership UX
- Marketplace
- realtime multiplayer UI

# 3. UX Principles

## F00-UX-001 — First Value Before Registration

User 在得到第一個可用 App 前，不要求 account。

## F00-UX-002 — Progressive Disclosure

只在需要時顯示下一層複雜度。

User 不需要看到：

~~~text
schema_version
registry_version
validation stage
capability IDs
HTTP status
provider name
runtime internals
~~~

除非是 internal/debug surface。

## F00-UX-003 — Preserve Context

任何 recoverable failure 預設保留：

- prompt draft
- clarification answers
- accepted assumptions
- current Blueprint
- current usable Runtime Instance when safe
- correction draft
- comparison context

## F00-UX-004 — No Blank-page Dead End

每個主要空白狀態至少有一個可執行下一步：

- Try a Capsule
- Type your idea
- Continue answering
- Retry
- Edit request
- Keep current App
- Remix
- Correct result

## F00-UX-005 — Human Words, Technical Truth

F00 可以把 technical state 翻成人話，但不能假裝成功。

例：

~~~text
F02 validation rejected
不顯示：
SCHEMA_INVALID

顯示：
「這個 App 還差一點才能安全執行，我們保留了你的需求。」
~~~

# 4. UX State Model

F00 採 hierarchical state，而不是單一巨大 enum。

~~~text
Shell
├─ Surface State
├─ Creation State
├─ Runtime State
└─ Overlay State
~~~

這避免：

~~~text
RUNNING_WITH_SHARE_MODAL_WITH_RECOVERY_WITH...
~~~

的組合爆炸。

# 5. Surface State

## F00-STATE-001

~~~text
DISCOVER
CREATE
APP
COMPARE
~~~

DISCOVER：
- 首頁 / Inspiration Capsule discovery
- prompt 可直接輸入

CREATE：
- Intent analysis / clarification / assumption / build
- User 尚未進主要 Runtime

APP：
- validated Blueprint 已 hydrate
- Runtime 是主要 surface

COMPARE：
- F16 old/new result compare
- current usable App context仍保留

Transitions：

~~~text
DISCOVER → CREATE
CREATE → APP
APP → CREATE       // Refine / Remix / new create
APP → COMPARE      // Correction generated
COMPARE → APP      // Accept / Revert / Close
APP → DISCOVER     // explicit start new
~~~

# 6. Creation State Machine

## F00-STATE-002

~~~text
IDLE
→ EDITING
→ ANALYZING
→ CLARIFICATION_REQUIRED
→ ANALYZING
→ ASSUMPTION_REVIEW
→ READY_TO_BUILD
→ BUILDING
→ HYDRATING
→ APP_READY
~~~

Possible failure branches：

~~~text
ANALYZING → RECOVERABLE_FAILURE
BUILDING → RECOVERABLE_FAILURE
HYDRATING → RECOVERABLE_FAILURE | TERMINAL_FAILURE
~~~

State source：

- ANALYZING / CLARIFICATION / ASSUMPTION / BUILDING 来自 F01 lifecycle。
- HYDRATING / APP_READY 来自 F03 lifecycle。
- Failure presentation 来自 F12 Recovery State。

# 7. State → User Presentation Mapping

| Internal State | User-facing intent | Primary Action |
|---|---|---|
| IDLE | 想做什麼？ | Start typing / Capsule |
| EDITING | 說出你想要的 App | Create |
| ANALYZING | 正在理解你的需求 | Cancel |
| CLARIFICATION_REQUIRED | 還差幾個關鍵資訊 | Answer / Continue |
| ASSUMPTION_REVIEW | 這些是目前的建議設定 | Accept / Edit |
| READY_TO_BUILD | 資訊已足夠 | Build |
| BUILDING | 正在把需求變成 App | Cancel where safe |
| HYDRATING | App 準備好了，正在啟動 | none |
| APP_READY | 可以直接使用 | Use / Share / Remix |
| RECOVERABLE_FAILURE | 沒完成，但你的內容還在 | Retry / Edit / Keep current |
| TERMINAL_FAILURE | 目前無法安全繼續 | Start over / Return to safe state |

Consumer copy 不使用 Compiler / Validator / Registry / Runtime 等工程詞彙。

# 8. Discover / Inspiration Capsules

## F00-UX-006

Capsule 是：

> 可立即 Fork / Edit / Run 的教學型 Prompt + outcome preview，不是純展示卡。

Capsule minimum display：

~~~text
title
one-line use case
example outcome / preview
difficulty or refinement depth optional
primary CTA: Try / Fork
secondary: View how it works optional
~~~

Capsule interaction：

~~~text
Capsule
→ prefill editable prompt
→ optional preset variables
→ User can edit before create
→ F01 create lifecycle
~~~

Rules：

1. Capsule 不直接 bypass F01。
2. Capsule metadata 可提供 Prompt A context，但不可當 User Explicit fact。
3. Capsule preset 若 material，來源要標為 NFF_DEFAULT / template proposal。
4. User 一改值，User value 優先。

# 9. Prompt Composer

## F00-UX-007

Composer minimum：

- multiline editable input
- Create CTA
- capsule-prefilled state
- Ghost Text
- character / request size feedback when near limit
- preserve draft on recoverable failure

Primary states：

~~~text
EMPTY
TYPING
PREFILLED
SUBMITTING
LOCKED_DURING_CRITICAL_TRANSITION
~~~

Rules：

- EMPTY 不送 request。
- SUBMITTING 時避免 duplicate submit。
- Idempotency-Key 由 Client operation layer產生並保存到 logical operation結束。
- User 可以在 ANALYZING 前取消本地 submit；provider已開始後的 cancel依 F01 contract。
- prompt draft不因 server error清空。

# 10. Ghost Text

## F00-UX-008

Ghost Text 目的是降低空白輸入負擔。

Allowed：

- example phrasing
- variable hints
- suggested continuation
- Capsule contextual hint

Not allowed：

- 看起來像 User 已輸入的實際值
- 將 LLM proposal 當已確認 fact
- 自動 submit

Ghost Text 必須視覺上與 User text 分離，User開始輸入後可淡出。

# 11. Clarification UX

## F00-UX-009

F00 只呈現 F01 已選好的 1–3 questions。

支持：

~~~text
FREE_TEXT
NUMBER
BOOLEAN
SINGLE_CHOICE
MULTI_CHOICE
STRUCTURED_FIELDS
~~~

Presentation rules：

1. 問題必須與主要 prompt 保持同一 creation context。
2. 一次顯示最多 3 個 material questions。
3. required / optional 要清楚。
4. 已回答值可編輯。
5. submit 前做 client-side type/required validation，但 server F01仍是 truth。
6. stale intent version conflict → reload current answers，不把 User input直接丟掉。
7. User 不需要知道 policy ID。

Question interaction：

~~~text
Answer
→ Continue
→ local validation
→ F01-API-002
→ new clarification state
~~~

# 12. Visible Assumption UX

## F00-UX-010

Material assumption 必須顯示：

~~~text
what is assumed
current value
source type
editable?
impact summary when useful
~~~

User-facing labels：

~~~text
FACT → 已提供
DEFAULT → 預設
PROPOSAL → 建議
UNKNOWN → 尚未決定
~~~

不要顯示 raw provenance enum。

Actions：

~~~text
Accept
Edit
Reject
~~~

Rules：

- material proposal不能 hidden。
- Accept 後 F01 source becomes USER_ACCEPTED_PROPOSAL。
- Edit 後 edited value當 User Explicit。
- Reject 後可能回 Clarification。
- cosmetic default 可以不打斷流程，但應可在後續 Refine 中改。

# 13. Fast Path UX

## F00-UX-011

Clear Intent：

~~~text
Create
→ ANALYZING
→ READY
→ BUILDING automatically
~~~

不額外插入確認頁。

Material assumptions：

~~~text
Create
→ ANALYZING
→ ASSUMPTION_REVIEW
→ User accepts/edits
→ BUILDING
~~~

Critical missing：

~~~text
Create
→ ANALYZING
→ CLARIFICATION_REQUIRED
→ answer
→ ANALYZING
→ ...
~~~

原則：

> 不為了展示 AI 很聰明而增加步驟；只在 product truth需要 User decision 時停下來。

# 14. Build / Compilation UX

## F00-UX-012

BUILDING 對 User 是一個整體狀態；內部可對應 F01 COMPOSING / VALIDATING。

Default copy 不顯示：

~~~text
Prompt B
F02 V07
registry digest
~~~

可顯示簡單 progress copy：

~~~text
正在組合你的 App
正在檢查互動是否可安全執行
快完成了
~~~

Rules：

- progress有 reliable checkpoints時採 checkpoint-derived %；沒有 reliable checkpoints時只顯示 stage，不偽造百分比。
- operation timeout，保留 Intent。
- validation-driven recompose最多一次時，不需閃爍回上一頁；同 BUILDING surface內完成。
- 若需要新 User decision，才回 Clarification / Assumption。

# 15. Hydration UX

## F00-UX-013

F01 VALIDATED 後：

~~~text
content_hash
→ create F03 Instance
→ HYDRATING
→ READY
→ Surface = APP
~~~

Hydration loading應短而穩定，不再顯示 Compiler copy。

若 F03 recoverable node issue：

- App仍可進 APP surface when core usable。
- affected node由 F03/F12 fallback呈現。

若 F03 fatal hydration failure：

- 不顯示半個 App。
- 進 F12 recovery presentation。

# 16. Runtime Frame / App Chrome

## F00-UX-014

APP surface分兩層：

~~~text
appf2 Shell Chrome
+ Generated App Runtime Frame
~~~

Shell Chrome Phase 1 minimum：

- App title
- New / Home
- Share
- Remix / Refine
- Correct result entry when result exists
- Previous Version / Revert entry when current-session accepted correction is revert-eligible
- recovery notice area when needed

Generated App area：

- F03 controls render
- F00 不直接讀/改 Blueprint state
- F00 不攔截正常 local interaction

Rules：

- runtime normal interaction不因 shell chrome產生 server calls。
- Shell control 與 generated App control視覺上要有區隔。
- mobile時 chrome可 compact，但核心操作仍可達。

# 17. Result Surface

## F00-UX-015

如果 Blueprint result.outputs 有 AVAILABLE outputs：

F00 可以提供 result chrome：

~~~text
Result summary area optional
Adjust result / 邏輯不對
Share
Remix
~~~

F00 不從 DOM 猜結果，使用 F03 evaluateResult() / canonical result surface。

如果 output ERROR：

- 不顯示 fake value。
- 交 F12 recovery。
- 其他可用 App功能可保持。

# 18. Correction Entry / F16

## F00-UX-016

入口 copy：

~~~text
調整結果
邏輯不對
結果不是我想要的
~~~

不使用：

~~~text
Report model hallucination
Validation error
~~~

Entry 必須保留：

- current Blueprint
- current visible inputs where policy allows
- current result
- correction text draft

Correction submit後由 F16/F01/F02處理。

F00只負責：

~~~text
APP
→ Correction Composer Overlay
→ Correcting
→ Compare
~~~

# 19. Compare State

## F00-STATE-003

COMPARE surface minimum：

~~~text
Previous Result
New Result
Changed explanation summary when available
Actions:
  Accept New
  Keep Previous
  Adjust Again
~~~

Rules：

1. old result / old Blueprint仍可用。
2. new result未 accepted前不破壞 old current truth。
3. Accept New → new Blueprint/Instance成 active。
4. Keep Previous → 回 old APP。
5. Adjust Again →保留 correction context。
6. Technical diff不是 consumer default；顯示 semantic/user-visible差異。

# 19.1 Post-Accept Previous Version / Revert UX

## F00-UX-016A

F16 correction ACCEPTED 後，F00回 APP surface，並在 current Browser session保留最小 correction_history。

Revert entry：

~~~text
APP
→ Previous Version / 回到修正前版本
→ Revert Confirmation
→ F16 decision REVERT_TO_BASE
→ fresh ExecutionAdmission for base
→ fresh F03 Runtime Instance
→ APP on base Blueprint
~~~

Visibility：

- 只有 current active Blueprint來自同一 session中 ACCEPTED correction時顯示。
- Phase 1沒有 account history，因此不承諾跨裝置 / 永久版本列表。
- Reload後若 correction_id與safe base reference仍可從approved local recovery context恢復，可繼續顯示；local record TTL = 7 days。
- base已 REVOKED / INCOMPATIBLE時，不顯示可執行Revert CTA，改由 F12說明 unavailable。

Confirmation：

~~~text
回到修正前版本？
修正版不會被刪除。
~~~

Input restoration：

1. same-session before snapshot仍在 memory且 compatible → default使用 correction前 replay inputs。
2. before snapshot不存在，但 current inputs可安全映射 → 顯示 optional「保留目前輸入」；預設 OFF。
3. 無安全 input snapshot → 使用 base Blueprint initial state，並在確認畫面說明輸入不會恢復。
4. SENSITIVE / DO_NOT_PERSIST資料不因 Revert寫入 local durable storage。

Successful Revert：

- correction_record outcome = REVERTED。
- active App = base Blueprint fresh Instance。
- F00回 APP，不回 COMPARE。
- child Blueprint / CORRECT lineage保留，不刪除。
- 不自動提供「redo corrected version」；未來版本歷史由 F08承接。

# 20. Share Entry

## F00-UX-017

Phase 1 Shell 必須有 Share CTA。

F00責任：

- collect active Blueprint reference
- invoke F05 share flow
- show pending / success / failure state
- copy/share link UI
- failure保留 App

F00不決定：

- durable vs portable default mode
- share persistence schema
- expiry policy

這些屬 F05。

# 21. Remix / Refine Entry

## F00-UX-018

APP surface提供兩個**不同 consumer intent**：

~~~text
Refine / 修改這個 App
→ S05A

Remix / 改成我的版本
→ S05B
~~~

Entry behavior：

~~~text
Current Blueprint
→ User明確選 Refine 或 Remix
→ open對應 S05A / S05B change context
→ User describes change
→ F06/F01
~~~

Rules：

- `修改這個 App` = 延續目前 App 的創作脈絡；`改成我的版本` = 以目前 App 為 base 建立 derivative。
- F00 / UI不得用 ownership、shared status或來源頁面自行猜 Refine / Remix；由 User明確選擇。
- Shared App restore後**先直接使用原 App**；open本身不是 Remix。User之後主動選 `改成我的版本` 才建立 Remix flow。
- Inspiration Capsule在 Phase 1仍走 `Try / Fork → editable prefill → F01 Create`；不是 Shared App 的 use-as-is restore flow。
- original App仍可返回。
- Runtime state mutation不等於 Refine。
- Remix / Refine failure不破壞 original App。
- 若 S03 是由既有 S05 `查看原版`暫時進入，F00必須保留同一 S05 session / draft / preview context；S03的 Modify / Remix UI不得建立第二個 S05 session，必須提供 origin-specific return action回原 session。

# 22. Recovery Overlay Model

## F00-STATE-004

Recovery不作獨立產品流程，而是可套在 CREATE / APP / COMPARE 的 overlay。

~~~text
RecoveryOverlay
├─ NONE
├─ INLINE_NOTICE
├─ BLOCKING_RECOVERABLE
└─ TERMINAL
~~~

Data來自 F12 Recovery State：

~~~text
status
human_message
preserved_context
next_actions
technical_code
~~~

Consumer預設只看：

~~~text
human_message
next_actions
~~~

technical_code只進 diagnostics / support context。

# 23. Recovery UX Rules

## F00-UX-019

Recoverable：

- 保留當前 surface。
- 保留安全 context。
- next action 1–3個。
- primary action必須可執行。

Examples：

~~~text
Retry
Edit request
Keep current App
Use simpler version
Return to previous result
~~~

Terminal：

- 不無限 retry。
- 說清楚目前不能安全完成。
- 提供返回安全狀態 / start new。
- 不顯示 raw stack。

# 24. Unsupported / Degraded UX

## F00-UX-020

F04 coverage = PARTIALLY_SUPPORTED：

- material degradation 在 build前明確顯示。
- User可接受 / edit Intent。

UNSUPPORTED / EXTERNAL_REQUIRED in Phase 1：

- 誠實說「目前這部分還做不到」。
- 保留其餘 Intent。
- 可提供 remove/simplify/refine path。
- 不產生看起來成功但 semantic core已改掉的 App。

# 25. Local Frontend State

## F00-DATA-001

Conceptual ShellState：

~~~text
ShellState
├─ surface
├─ creation
│  ├─ prompt_draft
│  ├─ source_capsule_id?
│  ├─ intent_id?
│  ├─ intent_version?
│  ├─ questions[]
│  ├─ answer_drafts
│  ├─ visible_assumptions[]
│  ├─ assumption_drafts
│  └─ operation_idempotency_key?
├─ app
│  ├─ active_blueprint_hash?
│  ├─ runtime_instance_id?
│  ├─ result_summary?
│  ├─ runtime_processing?
│  │  ├─ operation_token
│  │  ├─ status
│  │  ├─ stage_label_key
│  │  ├─ completed_checkpoints
│  │  ├─ planned_checkpoints?
│  │  ├─ progress_percent?
│  │  └─ soft_timeout_observed
│  └─ correction_history?
│     ├─ correction_id
│     ├─ base_blueprint_hash
│     ├─ accepted_blueprint_hash
│     ├─ revert_available
│     └─ before_snapshot_available
├─ compare
│  ├─ previous_blueprint_hash?
│  ├─ new_blueprint_hash?
│  └─ correction_draft?
└─ overlay
   ├─ recovery?
   ├─ share?
   └─ correction?
~~~

F00 local state不是 durable product truth。

`runtime_processing`只是 F03 lifecycle的presentation projection；F00不得自行推進 checkpoint、關閉 token、判斷 deadline或授權 commit。

# 26. Browser Persistence

Phase 1 可以 local persistence：

- prompt draft
- unsent clarification draft
- unsent correction draft
- minimal recovery navigation context

預設不 local persistence：

- full Runtime Instance
- sensitive result
- DO_NOT_PERSIST fields
- provider/model raw output
- arbitrary Blueprint internals unless F05 cache需要且符合 policy

Browser persistence使用 versioned key + TTL。

Phase 1 canonical policy：

~~~text
prompt draft / clarification draft / correction draft / minimal recovery context
→ TTL = 7 days
~~~

Rules：

- SENSITIVE / DO_NOT_PERSIST values不進 local durable draft。
- 每次成功 submit / cancel / expiry都清理不再需要的 draft。
- version mismatch時丟棄不安全舊shape，不做 silent migration。
- retention truth由 DATA-MODEL + F07 shared privacy matrix擁有；F00只實作。

# 27. API / Function Integration

F00直接依賴 F01：

~~~text
POST /api/v1/intents
POST /api/v1/intents/{intent_id}/answers
POST /api/v1/intents/{intent_id}/compile
~~~

F00與 F03使用 local Runtime interfaces：

~~~text
createRuntimeInstance
hydrateInstance
dispatchRuntimeEvent → RuntimeOperationHandle
subscribeRuntimeOperation
evaluateResult
disposeRuntimeInstance
~~~

F05/F06/F12/F16 的 network/API exact contract尚未完成時，F00只依 semantic interface，不自行發明 endpoint。

# 28. Operation Idempotency UX

Create / answer / compile：

- logical operation開始即生成 Idempotency-Key。
- network retry沿用同 key。
- User明確修改 payload後為新 logical operation → 新 key。
- duplicate button tap不產生新 operation。
- UI可顯示「正在處理」，但不能因重試建立兩個 App。

# 29. Navigation / Back Behavior

## F00-UX-021

Browser Back / in-app Back：

- CLARIFICATION → EDITING：保留 answers draft。
- ASSUMPTION_REVIEW → EDITING：保留 proposal / edits。
- APP → CREATE 只透過 explicit Refine/New，不讓 accidental Back丟 active App。
- COMPARE → APP：預設返回 previous/current safe App，不自動 accept new。
- Blocking operation離開前盡可能保存 prompt draft。

不使用 destructive Back。

# 30. Loading / Skeleton Rules

## F00-UX-022

Loading / processing presentation只反映真的 operation work：

- ANALYZING：composer保留，顯示 operation state。
- BUILDING：可顯示 shell skeleton，不 fake generated content。
- HYDRATING：shell先顯示，Runtime ready後才互動。
- 每個被 F03 accepted / admitted 的 S03 Runtime interaction，都建立 operation token並進入 logical `GLOBAL_PROCESSING`。
- Runtime interaction極快且在同一 render frame內完成時，完整 loading frame可能不會實際 paint；這不構成 violation，也不得為了讓動畫可見而人工延長 operation。
- 有可靠 finite checkpoint plan時顯示 Stage label + checkpoint-derived Progress %；沒有可靠 checkpoints時只顯示 stage，不假造百分比。
- `100%` 只可在 F03 commit已成立後呈現；`commit ready` 不等於 `100%`。
- Soft Timeout維持 processing presentation與最後真實 checkpoint；Hard Timeout由 F03關閉 operation，再交 F12呈現 recovery。

避免 spinner覆蓋整個產品。

# 31. Cancel Semantics

## F00-UX-023

User可取消：

- ANALYZING request waiting
- BUILDING request waiting where safe
- correction draft / pending compare

Cancel後：

- prompt / intent context保留。
- 已成功 admission的 Blueprint不刪除。
- provider operation無法取消時，idempotency防 duplicate outcome。
- HYDRATING dispose後回 validated App reference / safe creation state。

# 32. Responsive Layout Baseline

Phase 1 mobile-first：

- primary CTA單手可達。
- clarification不要求 horizontal scroll。
- compare窄螢幕可 stacked previous/new。
- Shell chrome不遮 Runtime controls。
- keyboard彈出時 composer action仍可達。
- generated App container有 bounded width策略，但允許 full-width Capability。

# 33. Accessibility Baseline

## F00-UX-024

Required：

- keyboard navigation
- visible focus
- semantic labels
- loading state透過 aria-live適度通知
- field error programmatic association
- modal focus trap / return focus
- color不是唯一狀態指示
- primary touch target至少44 CSS px
- prefers-reduced-motion

F04 / Capability implementation仍需各自驗證 component accessibility。

# 34. Error Seed

| ID | Meaning | Recovery |
|---|---|---|
| F00-ERR-001 | SHELL_BOOT_FAILED | reload / safe home |
| F00-ERR-002 | LOCAL_DRAFT_PERSIST_FAILED | continue without persistence |
| F00-ERR-003 | INVALID_LOCAL_UI_STATE | reset affected overlay |
| F00-ERR-004 | DUPLICATE_SUBMIT_GUARD | ignore duplicate |
| F00-ERR-005 | RUNTIME_MOUNT_FAILED | F12 recovery |
| F00-ERR-006 | UNSUPPORTED_VIEW_STATE | safe home / diagnostics |

F00通常呈現其他 Function error，不重新編碼另一套 technical taxonomy。

# 35. Evidence Seed

正式 Event Envelope由 F07定義。

~~~text
F00-EVT-001 shell_opened
F00-EVT-002 capsule_viewed
F00-EVT-003 capsule_forked
F00-EVT-004 prompt_submitted
F00-EVT-005 clarification_shown
F00-EVT-006 clarification_submitted
F00-EVT-007 assumption_review_shown
F00-EVT-008 assumption_accepted
F00-EVT-009 assumption_edited
F00-EVT-010 app_ready
F00-EVT-011 share_opened
F00-EVT-012 remix_opened
F00-EVT-013 correction_opened
F00-EVT-014 recovery_shown
F00-EVT-015 recovery_action_selected
F00-EVT-016 compare_shown
F00-EVT-017 compare_accept_new
F00-EVT-018 compare_keep_previous
~~~

不要記 every keystroke。

# 36. UX Metrics

~~~text
Time to First Useful App
Capsule → Create conversion
Prompt → Clarification rate
Clarification completion rate
Assumption acceptance/edit rate
Build → App Ready rate
Recovery success rate
Share entry rate
Remix entry rate
Correction entry rate
Correction compare decision rate
~~~

不能把 App Ready 直接當 semantic success。

# 37. Acceptance Criteria

Core Flow：

- F00-AC-001 User可從空白 prompt 或 Capsule開始 Create。
- F00-AC-002 Capsule prefill永遠可編輯。
- F00-AC-003 Clear Intent不增加不必要 confirmation page。
- F00-AC-004 F01需要 clarification時，F00一次只呈現選定的1–3題。
- F00-AC-005 material proposal一定可見且可 Accept/Edit/Reject。
- F00-AC-006 prompt / answers在 recoverable failure後仍保留。
- F00-AC-007 VALIDATED Blueprint可進 F03 hydrate並切到 APP surface。

Runtime / Product Loop：

- F00-AC-008 normal Runtime interaction不觸發 global shell loading。**Working disposition：SUPERSEDED / DEPRECATED_FOR_BUILD_FREEZE；保留 stable ID / 原語意，由 F00-AC-029–032取代，不重用或改寫。**
- F00-AC-009 APP surface可到 Share / Remix / Correction入口。
- F00-AC-010 correction failure不破壞 current App。
- F00-AC-011 Compare可 Accept New / Keep Previous / Adjust Again。
- F00-AC-012 Keep Previous不 mutation old Blueprint。
- F00-AC-013 unsupported intent不 fake success。

Recovery：

- F00-AC-014 consumer不看到 raw 401/500/stack trace。
- F00-AC-015 recoverable failure至少有一個有效 next action。
- F00-AC-016 node-level Runtime failure不強迫離開整個 App。
- F00-AC-017 terminal failure提供 safe exit。

Safety / Privacy：

- F00-AC-018 DO_NOT_PERSIST value不進 local draft storage。
- F00-AC-019 duplicate tap不造成 duplicate logical create/compile。
- F00-AC-020 Shell不直接修改 Runtime Instance Store。
- F00-AC-021 Shell不把 LLM proposal顯示成 User fact。

Accessibility / Responsive：

- F00-AC-022 Phase 1 Core Create flow可全鍵盤操作。
- F00-AC-023 modal關閉後focus回合理觸發點。
- F00-AC-024 mobile width下 clarification / compare無必要 horizontal scroll。
- F00-AC-025 reduced-motion preference被 Shell animation尊重。

Evidence：

- F00-AC-026 Create / clarification / App Ready / recovery / share / remix / correction入口可量測。
- F00-AC-027 telemetry不記 every keystroke。
- F00-AC-028 App Ready不被 telemetry命名為 semantic success。

Runtime Processing Delta：

- F00-AC-029 每個被 F03 accepted / admitted 的 Runtime interaction都進入 logical global processing presentation；同一 render frame內完成而未 paint完整 loading frame不算 failure。
- F00-AC-030 checkpoint-derived Progress %只反映已完成的 planned checkpoints，且只有 commit成立後才可呈現100%。
- F00-AC-031 Runtime processing不得為了讓 loading可見而人工延長 action。
- F00-AC-032 Runtime Hard Timeout必須轉交 F12；integrity成立時回到安全 S03 last-known-good App，無法證明 integrity時進 terminal safe-state。

# 38. Test Mapping Seed

~~~text
F00-AC-001 → TEST-F00-001 create entry
F00-AC-003 → TEST-F00-003 fast path
F00-AC-004 → TEST-F00-004 clarification question cap
F00-AC-005 → TEST-F00-005 visible assumptions
F00-AC-006 → TEST-F00-006 preserve context on failure
F00-AC-007 → TEST-F00-007 validated-to-runtime
F00-AC-008 → TEST-F00-008 no global load on runtime interaction
F00-AC-010 → TEST-F00-010 preserve App on correction failure
F00-AC-011 → TEST-F00-011 compare decisions
F00-AC-013 → TEST-F00-013 unsupported honest UX
F00-AC-014 → TEST-F00-014 no raw engineering errors
F00-AC-019 → TEST-F00-019 duplicate submit guard
F00-AC-020 → TEST-F00-020 shell/runtime boundary
F00-AC-022 → TEST-F00-A11Y-001 keyboard create flow
F00-AC-024 → TEST-F00-RWD-001 mobile clarification/compare
F00-AC-029 → TEST-F00-029 runtime interaction global processing presentation
F00-AC-030 → TEST-F00-030 truthful checkpoint progress and 100% after commit
F00-AC-031 → TEST-F00-031 no artificial processing delay
F00-AC-032 → TEST-F00-032 timeout to F12 safe S03 or terminal state
~~~

# 39. Dependencies

Upstream：

- F01 lifecycle / API / clarification / assumptions
- F03 hydration / runtime / result
- F04 coverage status semantics
- Design-to-Delivery

Collaborators：

- F05 Share
- F06 Remix / Refine
- F07 Evidence
- F12 Recovery
- F16 Correction

# 40. Release / Migration

Phase 1 Shell：

~~~text
Discover
+ Prompt Composer
+ Clarification / Assumption
+ Build
+ Runtime Frame
+ Share / Remix / Correct entries
+ Recovery presentation
+ Compare
~~~

No account required before first value。

未來加入 Account / Realtime / Marketplace時，不得破壞：

~~~text
Prompt → Clarify only if needed → Build → Use
~~~

# 41. Open Decisions

目前沒有阻擋 Phase 1 Build Freeze Gate 的 open decision。

已閉合：

- F05 Share / Restore semantics與default mode已固定。
- F06 Remix / Refine source context與UX entry已固定。
- Local draft TTL / privacy由 DATA-MODEL + F07 shared privacy matrix固定。
- F12 Recovery message/action semantics已建立。
- F16 correction / compare / current-session Revert UX已建立。

非 blocker、可後續迭代：

1. Capsule content taxonomy / ranking。
2. Visual copy / layout A/B，不得改 semantic action mapping。
3. Durable cross-device version history留給 F08。

# Conclusion

F00 Current Truth：

~~~text
DISCOVER
→ EDIT
→ ANALYZE
→ clarify / review assumptions only when necessary
→ BUILD
→ HYDRATE
→ APP
→ Share / Remix / Correct
→ Compare / Recover without losing context
~~~

> F00 的工作不是替其他 Function 做決策，而是讓所有 Function 對 User 看起來像一個完整、連續、好懂的產品。


---

## Closed Working Delta — Runtime Global Loading + Timeout

> 狀態：WORKING_DELTA_CLOSED（2026-09-22）/ STEP2_RECONCILED
>
> STEP2 reconciliation：Runtime loading / timeout delta 已整合回 canonical sections；F00-AC-008保留 stable ID但已 superseded，不再進 Build Freeze required set。
>
> 來源：Phase 1 O05 Low-fi Review + DESIGN-WORKBENCH。

已批准的 Working Current Truth：

1. S03 normal local Runtime interaction 也要顯示 global loading / processing feedback。
2. Progress 統一採 Stage label + checkpoint-derived Progress %。
3. % 代表已完成 work checkpoints，不代表剩餘時間。
4. checkpoint 卡住時停在最後真實值，不人工灌高。
5. Runtime operation 必須有 Timeout → Humanized Recovery → safe S03 return。

這取代 Working 層的舊方向；既有 stable `F00-AC-008` 不改寫，標為 Working superseded，未來 Formal Refresh時 deprecated。

### F00 Presentation Contract

S03 interaction被 F03接受執行時：

~~~text
User Action
→ F03 ADMITTED + operation token created
→ GLOBAL_PROCESSING
→ COMMITTED → APP
or → TIMED_OUT / FAILED → F12 Recovery → safe APP / terminal safe-state
~~~

Presentation：
- 每個 admitted interaction必須進 logical global processing state；極快操作可以在 browser paint前完成，不要求人工延遲以強迫 loading frame可見。
- 有可靠 checkpoints → 顯示 Progress %。
- 沒有可靠 checkpoints → 顯示 stage / processing state，但不假造百分比。
- progress plan在 operation開始時固定為 finite ordered checkpoints；% = completed / planned。
- checkpoint必須單調且 operation-scoped；Soft Timeout時停在最後真實完成值。
- 只有 COMMITTED後可顯示100%；commit-ready仍不是100%。
- 不為了讓 loading 可見而刻意延長完成時間。
- Hard Timeout後若 last-known-good Runtime integrity成立，F12回到安全 S03；否則進 O03 terminal safe-state。

### F00 Acceptance Delta — Runtime Processing / Timeout

新增 `F00-AC-029`–`F00-AC-032` 與 `TEST-F00-029`–`TEST-F00-032`；machine-readable mapping同步在 `working/detailed-design/registries/acceptance-test-registry.json`。

F03 operation truth與 F12 recovery truth分別由其 Working文件擁有；F00只呈現，不自行判斷 commit / integrity。

---

## Closed Working Delta — S02 Composite Create Progress Projection

> 狀態：**WORKING_DELTA_CLOSED（2026-09-23） / STEP2_RECONCILED**
>
> Source Delta：`SD-20260922-002 — F01 Creation Progress Checkpoint Contract`。
>
> F00只擁有 cross-Function consumer orchestration，不改寫 F01 / F03 completion truth。

### F00-UX-025 — Composite Create Progress v1

S02 overall Create progress 使用固定七個 owner-tagged milestones：

~~~text
1  F01-CREATE-CP-01  INTENT_ANALYZED                 owner F01
2  F01-CREATE-CP-02  POLICY_EVALUATED                owner F01
3  F01-CREATE-CP-03  INTENT_RESOLVED                 owner F01
4  F01-CREATE-CP-04  CAPABILITY_COVERAGE_RESOLVED    owner F01
5  F01-CREATE-CP-05  BLUEPRINT_COMPOSED              owner F01
6  F01-CREATE-CP-06  BLUEPRINT_VALIDATED             owner F01/F02 truth
7  F00-CREATE-CP-07  APP_READY                       owner F03 READY truth
~~~

F00 不得自行完成任何 F01-owned checkpoint，也不得在 F03 尚未 READY 時完成 `APP_READY`。

Consumer percentage：

~~~text
progress_percent
= floor(completed_composite_checkpoints / 7 × 100)

1/7 → 14%
2/7 → 28%
3/7 → 42%
4/7 → 57%
5/7 → 71%
6/7 → 85%
7/7 → 100%
~~~

`100%` only when F03 READY / App target condition成立。

### Consumer Stage Projection

~~~text
理解想法
→ INTENT_ANALYZED / POLICY_EVALUATED / INTENT_RESOLVED

整理 App
→ CAPABILITY_COVERAGE_RESOLVED / BLUEPRINT_COMPOSED

檢查互動
→ F02 validation until BLUEPRINT_VALIDATED

準備 App
→ F03 hydration until APP_READY
~~~

Stage label 可在 checkpoint完成前先反映目前真的正在執行的 lifecycle state，但不得因此增加百分比。

### Waiting For User

Clarification / Assumption Review：

- 保留最後真實 progress snapshot作 context。
- processing animation停止。
- 進 User decision surface。
- User回答後再進後續 processing。
- 等待期間不得推進 %。

### F00 Acceptance Delta — Create Progress / Cross-Screen

新增：

- **F00-AC-033** S02 composite Create progress只能由 F01六個 checkpoint + F03 APP_READY truth組成；F00不得自行完成 source-owned checkpoint。
- **F00-AC-034** Clarification / Assumption waiting 必須凍結 progress，停止 processing animation，不因等待時間前進。
- **F00-AC-035** F01 VALIDATED 最多完成 composite 6/7（85%）；只有 F03 READY 才可顯示100%。
- **F00-AC-036** Normal S03 必須讓 User 明確選擇 `修改這個 App → S05A/REFINE` 或 `改成我的版本 → S05B/REMIX`；UI不得依 ownership、Shared來源或其他 metadata替 User猜 intent。
- **F00-AC-037** 從既有 S05 `查看原版`進 S03 Inspection Mode時，必須保留同一 S05 session / path / draft / preview context，並依 origin提供 `返回修改畫面`或`返回新版預覽`；不得建立第二個 S05 session。
- **F00-AC-038** Phase 1 Inspiration Capsule 的 `Try / Fork` 必須進 editable prefill → F01 Create；不得套用 Shared App 的 use-as-is restore semantics。

### F00 Test Mapping Delta

~~~text
F00-AC-033 → TEST-F00-PROG-001 owner-tagged composite Create progress
F00-AC-034 → TEST-F00-PROG-002 waiting-for-user freezes progress
F00-AC-035 → TEST-F00-PROG-003 100 percent only after F03 READY
F00-AC-036 → TEST-F00-036 explicit S03 refine/remix choice
F00-AC-037 → TEST-F00-037 returnable inspection preserves S05 context
F00-AC-038 → TEST-F00-038 inspiration capsule stays create flow
~~~

