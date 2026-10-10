# S01 — Discover / Start

> **PHASE 1 FREEZE AUDIT：PASS — Phase 1 applicable truth passed Final Audit and is eligible for Human-approved Build Freeze; Phase 2/3+ and deferred content are excluded.**

> Governance：本檔為 UI/UX Working Current Truth；Build Freeze / delivery lifecycle 以 `working/common-core/DESIGN-TO-DELIVERY.md` 為準。

> Screen ID：S01
>
> 狀態：**WORKING — ④A LOW_FI_APPROVED / ④B HIGH_FI_STEP1–4 APPROVED — WORKING BASELINE**
>
> Phase：Phase 1
>
> Screen-level canonical owner：`working/detailed-design/UI-UX/screens/S01-DISCOVER-START.md`
>
> Function behavior source：`working/detailed-design/functions/F00-EXPERIENCE-SHELL.md`（Working Current Truth）
>
> 注意：本文件只固定目前已確認的 Screen-level UI/UX。若需要改 F00 behavior contract，必須回 F00 Working Review。

# 1. User Outcome

S01 的核心任務：

> **讓第一次進 appf2 的 User，不需要先學 Prompt Engineering，就能很快理解「我可以把現在的想法直接做成 App」，並開始 Create。**

不是讓 User 先理解 appf2 的全部功能，也不是把首頁做成傳統搜尋首頁或 App Store。

# 2. Product / UX Direction — Approved

目前已確認：

1. **Prompt-first + Inspiration supporting**。
2. User 可以完全不看 Capsule，直接輸入想法開始。
3. Inspiration Capsules 用來降低空白輸入門檻、示範可能性並支援 Fork / Edit / Run。
4. 首頁資訊保持乾淨、低干擾。
5. 不強迫登入 / 註冊才能取得 First Value。
6. Must not resemble Google / Search UI。
7. S01 的感覺應偏向 **Creator / App-making entry**，不是 Search page。

# 3. Low-fi Information Architecture

S01 目前固定四個核心區塊：

## A. Brand / Value Statement

必要內容：

- appf2 brand。
- 主訊息：**意圖就是 App**。
- 一句簡短人話，說明「把你的想法／需求直接變成可用 App」。

目的：
- User 第一眼就知道 appf2 做什麼。
- 不塞大量產品教育或技術詞。

## B. Prompt Composer

S01 的主要操作核心。

必要能力：

- natural-language input。
- Ghost Text / example hint。
- Primary CTA：**建立 App**。
- prompt draft 可編輯。
- User 不需先選 model / blueprint / capability / technical settings。

Visual rule：

> Composer 應具有 Creator Canvas / Command Surface 感，不使用「中央 Logo + 單一搜尋框」的 Google/Search 首頁語言。

## C. Inspiration Capsules

用途：

- 給 User「原來可以這樣做」的靈感。
- 顯示 outcome / app-like preview，而不是只有 Prompt 文字。
- 可直接 Try / Fork / Prefill 後修改。
- 第一屏只放少量精選內容，避免首頁變成大型 catalog。

## D. Explore More

用途：

- 想看更多的 User 可以繼續 Explore。
- 不讓 Explore 壓過 Create。
- Explore 是 supporting path，不是 S01 primary path。

# 4. Low-fi Desktop Composition

方向：

~~~text
┌────────────────────────────────────────────────┐
│ appf2                         minimal controls │
│                                                │
│ 意圖就是 App                                   │
│ 短句：把你的想法直接變成可用 App               │
│                                                │
│ ┌──────────────────────────────┐  ┌──────────┐ │
│ │ Prompt / Creator Surface     │  │ 建立 App →│ │
│ │                              │  └──────────┘ │
│ └──────────────────────────────┘               │
│   optional prompt suggestion chips             │
│                                                │
│ START FROM AN IDEA                             │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│ │ Capsule  │ │ Capsule  │ │ Capsule  │         │
│ │ preview  │ │ preview  │ │ preview  │         │
│ │ Try →    │ │ Try →    │ │ Try →    │         │
│ └──────────┘ └──────────┘ └──────────┘         │
│                                      Explore → │
└────────────────────────────────────────────────┘
~~~

注意：
- Header / 右上角只保留必要 controls。
- 不必要 theme icon、decorative icon、Sign-in pressure、複雜 navigation 不進 Phase 1 首屏 baseline。
- Desktop 可利用較寬空間呈現更強的 Creator feeling，但不增加無必要資訊。

# 5. Low-fi Mobile Composition

方向：

~~~text
┌──────────────────────────┐
│ appf2        minimal UI │
│                          │
│ 意圖就是 App             │
│ 短句                     │
│                          │
│ ┌──────────────────────┐ │
│ │ Prompt Composer      │ │
│ │                      │ │
│ └──────────────────────┘ │
│ [      建立 App →      ] │
│ suggestion chips         │
│                          │
│ 試試這些靈感             │
│ ┌──────────────────────┐ │
│ │ Capsule / Preview    │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ Capsule / Preview    │ │
│ └──────────────────────┘ │
│               Explore → │
└──────────────────────────┘
~~~

Mobile rule：
- Prompt Composer + Create CTA 必須容易找到。
- Capsule 採垂直 stack / swipe-friendly presentation，避免必要 horizontal scroll。
- 不因小螢幕增加額外 navigation clutter。

# 6. Primary Interactions

## S01-ACT-001 — Direct Create

~~~text
User types intent
→ Create
→ enter S02 Create Workspace
~~~

Behavior semantics 由 F00 / F01 擁有；S01 只負責 initiation presentation。

## S01-ACT-002 — Start from Capsule

~~~text
User selects Capsule
→ prefill editable prompt / creation context
→ User can edit
→ Create
→ S02
~~~

Capsule metadata 不可偷偷變成 User Explicit fact；此語意仍由 F00/F01 contract控制。

## S01-ACT-003 — Explore

~~~text
User selects Explore
→ expanded inspiration discovery
~~~

Phase 1 是否採同頁展開或獨立 surface，留待後續 Screen review；不可因此阻塞 primary Create path。

# 7. S01 States

目前 Low-fi 需要涵蓋：

- EMPTY / INITIAL。
- USER_TYPING。
- CAPSULE_PREFILLED。
- LOCAL_INPUT_INVALID（例如空內容 / client-required constraint）。
- READY_TO_SUBMIT。

真正的 ANALYZING / CLARIFICATION / ASSUMPTION / BUILDING / HYDRATING 主要由 S02 承接，不讓 S01 同時承載整個 creation lifecycle。

# 8. Navigation / Header Guardrail

Phase 1 S01 Header：

- 必須乾淨。
- appf2 brand 必須可辨識。
- 非必要 controls 不出現在首屏。
- 不因「以後可能需要」就提前放 Docs / Community / Settings / model picker。
- Registration 不得阻擋 First Value。

右上不必要圖案與裝飾已被明確排除。

# 9. ④B High-fi Contract — Approved

> Approved by User：2026-09-22
>
> 狀態：**Step 1–4 CLOSED / WORKING BASELINE**
>
> Canonical rule：本節是 S01 唯一有效的 High-fi Current Truth。舊的 High-fi discussion / summary / duplicate sections 已合併至此，不再作獨立 authority。
>
> Implementation precedence：
> 1. 本節 Step 1–4；
> 2. `working/detailed-design/UI-UX/DESIGN-SYSTEM.md`；
> 3. approved visual reference；
> 4. 其他示意圖。
>
> 若圖片生成誤差與文字 contract 衝突，文字 contract 優先。

## Step 1 — Structure Lock ✅

### Header — Structure

Desktop：

~~~text
appf2 Logo | 首頁 | 探索靈感 | 我的 App
~~~

Rules：
- 必須包含「首頁」。
- Profile 暫不出現。
- 「我的 App」Phase 1 顯示明確 `Soon` / unavailable placeholder，不假裝已有完整 workspace。
- 不放 Search / Login / Notification / Docs / Community / Model Picker。
- 不放額外 Create。
- 首頁 active state採文字 + Teal indicator，不用大色塊。

Mobile：
- 不使用 hamburger。
- Header只保留必要 brand / page chrome。
- 主要 navigation由底部 nav承接。

### Hero — Structure

- 主標固定：**意圖就是 App**。
- 副標目前不顯示；保留 breathing room。
- Hero保持 compact，不做大型 marketing banner / promo strip / illustration wall。

### Creator Composer

- S01 唯一 Primary Create entry。
- 支援 natural-language、multi-line long-form intent、Ghost Text / example hint、suggestion chips。
- Primary CTA只有：**建立 App**。
- suggestion chips只作 supporting prefill，不搶 CTA。
- 不在 Header / Mobile bottom nav重複 Create。

### Inspiration

High-fi presentation固定為 **作品展示卡 / App Preview Card**，不是 Prompt card、social feed或 App Store listing。

卡片資訊：

~~~text
App 使用畫面預覽
↓
App 名稱
↓
一句 outcome
↓
試試看 →
~~~

- 不放 author / like / comment / rating / Featured badge / overflow noise。
- Inspiration是 supporting creation path，不得壓過 Composer。

### Category Navigation / Explore

Category navigation位於作品卡上方：

~~~text
全部 | 生產力 | 生活 | 學習 | 工具
~~~

- 純文字 tabs，不使用 category icon grid。
- `探索靈感` = S01 top-level / persistent Discover navigation entry；目的地是 S01 Inspiration區，不建立獨立 Explore Screen。
- `探索更多 →` = Inspiration區內的 local continuation CTA；User正在看 Capsules時，就近載入 / 展開更多 Capsules，留在 S01。
- 兩者可使用同一份 Inspiration content source，但 **action contract不同**：前者負責到達 Inspiration區，後者負責在該區繼續探索。
- 不得因 destination同屬 S01 Inspiration區，就把兩個入口視為 duplicate action。
- Cross-screen navigation scope仍以 Screen Inventory為準；不得把 `探索靈感`自行擴張成 S02–S06都常駐的 global nav。

### Footer

- 可放 appf2官方 social icons。
- Footer保持低視覺權重。
- 不放「分享這個 App」；App Share只屬 S03 / O01。

### Mobile Bottom Navigation

固定：

~~~text
首頁 | 探索靈感 | 我的 App
~~~

- 不放 Create。
- 不放 Profile。
- 「我的 App」顯示 `Soon` / unavailable state。
- Create仍只由 Creator Composer提供。

### Creation Progress Handoff Boundary

- S01只負責 Create submit entry；真正的 ANALYZING / CLARIFICATION / ASSUMPTION / BUILDING / HYDRATING主要由 S02承接。
- 可視化生成進度是重要 UX，但 S01不承載整個 creation lifecycle。
- S01不得顯示 Prompt A / Validator / Blueprint等工程語言。
- 不用 generic spinner假裝整個 creation progress；progress presentation依 S02 / O05 truth。

### Explicitly Not Present

Cursor不得自行新增：
- 強制 Sign in / Sign up作為取得 First Value的前置條件；
- Dashboard / 複雜 Sidebar / 完整 My Apps workspace；
- Blueprint / Registry / Runtime technical controls；
- 大型 App Store-like catalog；
- 第二個 Create入口；
- Profile / hamburger / Search / Notification；
- promo banner；
- category icon grid；
- App Store-like metadata；
- social metrics；
- design-system說明區；
- 未批准的 secondary hero copy。

## Step 2 — Geometry + Visual Hierarchy Lock ✅

### Desktop

- Creator Composer initial height：約 `180–220px`。
- Composer auto-grow到約 `320–360px`後才 internal scroll。
- Inspiration：3 cards / row。
- card preview約佔視覺面積 60%。
- Hero compact，不浪費首屏。
- Header單列、低密度、低視覺重量。

Attention hierarchy：

~~~text
Creator Composer
> Hero message
> Inspiration previews
> Explore / Footer chrome
~~~

### Mobile

- Composer initial height：約 `160–180px`。
- Composer同樣 auto-grow，達上限後 internal scroll。
- Inspiration cards單欄。
- category文字 tabs可水平 scroll。
- bottom nav fixed + safe-area aware。
- 內容不得被 bottom nav遮住。
- 不要求必要 horizontal scroll。

### Responsive / Flow

- Desktop / Mobile 都維持 Prompt-first。
- Mobile不因空間不足新增 hamburger / duplicate controls。
- Header / Hero / Composer / Inspiration / Footer依自然 document flow排列。
- 作品卡 preview不可在 Mobile縮成過小 thumbnail。

## Step 3 — Detailed High-fi Visual Rules Lock ✅

### Direction A / Brand Balance

S01套用：**Clean Creator Canvas + Playful Energy**。

- Neutral / White = 主要 canvas。
- Teal = brand / creation / active anchor。
- Yellow = small energy accent。
- Default composition target約：
  `70% Neutral / 20% Teal / ≤10% Yellow`。
- Teal → Aqua → Yellow gradient只用於有限 brand / creation moments，不整頁鋪滿。
- 不使用大型霓虹 glow、重陰影、高飽和彩虹分類。

### Header — Visual Treatment

- active navigation = Teal text + subtle indicator。
- 不使用大型 filled tab。
- icon / control touch target ≥44 CSS px。
- `我的 App · Soon`不能只靠顏色表示 unavailable。

### Hero — Visual Treatment

- 主標是主要 brand statement。
- Teal可用於文字 / small accent。
- Yellow不得作整塊 Hero背景。

### Composer

- white / soft neutral surface。
- radius採 Design System 12–16px family。
- subtle border / restrained elevation。
- Focus使用 visible Teal focus treatment，不能只靠 shadow。
- placeholder / Ghost Text必須弱於真實 user input但仍可讀。
- Disabled / Loading / Invalid依 Design System component state contract，不用 opacity-only。

### Inspiration Cards

- neutral surface + restrained border / elevation。
- hover可小幅 elevation或 border emphasis。
- 不用大型 glow / scale jump。
- card CTA wording維持 Consumer copy：`試試看 →`。

### Category / Explore / Footer

- active category = Teal text + underline / indicator。
- Explore = ghost / secondary。
- Footer social icons使用一致 icon family，具 visible focus。

### Motion

- Hover約 `120ms`。
- 一般 transition約 `180ms`。
- 不使用持續 decorative animation搶 Composer注意力。
- prefers-reduced-motion移除不必要 slide / pulse，保留 state change。

### Accessibility

- touch target ≥44 CSS px。
- active / disabled / selected不可只靠顏色。
- keyboard focus順序依：
  Header → Composer → Create → Inspiration → Explore → Footer。
- body / control contrast、focus、disabled semantics需通過 Design System accessibility gate。
- Composer需有明確 label / accessible name。

## Step 4 — Final Visual Reference Lock ✅

Approved visual：

![S01 Discover Start High-fi v1](../references/S01-Discover-Start-Highfi-v1.png)

Canonical path：

`working/detailed-design/UI-UX/references/S01-Discover-Start-Highfi-v1.png`

Repository PNG blob SHA：

`e2048861c2df0c4226190b64b8bf827648470261`

Reference boundary：
- 圖片鎖定 composition / density / visual impression / Desktop-Mobile relationship。
- sample content / decorative props不自動成為 Function requirement。
- 圖片不得新增 Profile / hamburger / duplicate Create / icon category grid / App Store metadata等未批准元素。
- Step 1–3文字 contract + Design System + F00/F01 Function truth優先於圖片生成誤差。

# 10. Review Status / Change Control

> **④A LOW_FI_APPROVED / ④B HIGH_FI_STEP1–4 APPROVED — WORKING BASELINE**

- S01 High-fi Step 1–4已 CLOSED。
- 任何已批准 Structure / Geometry / Visual Rule / image reference改動，必須 reopen對應 Step。
- 若後續 Cursor需要額外 component anatomy / state matrix / animation detail，可新增 `Step 4.5 — <Layer Name> Lock`；不得用 Step 4.5 偷改 Step 1–4。
- 涉及 Function behavior則回 F00/F01 Working Review。
- STEP2 content reconciliation已完成；仍待 Final Audit + Human-approved Build Freeze。

### Final Cross-Screen High-fi Review — CLOSED / VERIFIED

> Verified：2026-09-24
>
> FG-01–FG-07 已全部完成修正與決策；2026-09-24 final full-set re-audit 未發現新的 material cross-screen finding。**Final Cross-Screen High-fi Gate = CLOSED / VERIFIED。**
>
> Final cross-screen authority：**Step 1–3 textual contract + Design System + Fxx Function truth > Step 4 visual reference。**
>
> Final re-audit確認：S03 使用 approved v2 canonical reference；其餘既有 canonical PNG維持不變。圖片不覆蓋 Step 1–3 textual contract / Design System / Fxx Function truth。
