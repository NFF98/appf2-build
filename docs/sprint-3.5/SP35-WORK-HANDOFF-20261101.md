# Sprint 3.5 — 通用 AI 引擎真正產品進度 SSOT／唯一下一關（2026-11-03，置頂覆蓋舊樣本標題）

## 2026-11-03 SSOT 覆核完成：真正已發布 App 網站 E2E 4/9 = 44.4%（修正錯誤的 2/9 最新置頂）

依使用者「兩個已跑過的複雜 App，先去看」指令，已獨立讀原 GitHub Actions + Supabase Postgres **現存的實際證據**，不是再做免費平台測試，更沒有重新花模型費。原已有 2/9 即時計數器+客戶備忘錄之外，**本輪補認既有兩項不同 AI App 產品成功**：

1. **#3 G10 閱讀書單（帶真 PG CRUD）**：AI Job `9eecc831-4bb9-4af4-ac88-546fd159c22d`，CODE `SUCCEEDED`、單筆 20¢ ceiling；原 frozen Docker QA [41364310433](https://github.com/NFF98/appf2-build/actions/runs/41364310433) 7/7，原網站 [41363905501](https://github.com/NFF98/appf2-build/actions/runs/41363905501) SUCCESS。獨立 Chromium 真網站／Postgres viewer 寫入、變更已讀、刪除、重新載入、另一 viewer 隔離 [41364683866](https://github.com/NFF98/appf2-build/actions/runs/41364683866) SUCCESS，log `REAL_PUBLISHED_RECIPIENT_FULL_PASS sample=g10-books`、`model_or_job_POST=0`。Supabase live `appf2_code_app`: share `4c07f75f-1f4b-43d2-9a66-dab6761b8414`, `ACTIVE/public_opt_in=true`, 原 bluehash `sha256:710314711d4704a81c380f537ab67225fc86632d430e5d510b26ad2fcbcab738`；現存 2 筆 viewer 測試紀錄。
2. **#4 G11 每日喝水紀錄（帶真 PG CRUD）**：AI Job `224ba726-de85-4a1c-ad3c-aef7eb0f334b`，CODE `SUCCEEDED`、單筆 20¢ ceiling；原 QA [41365402062](https://github.com/NFF98/appf2-build/actions/runs/41365402062) 7/7；原 owner workflow [41364911735](https://github.com/NFF98/appf2-build/actions/runs/41364911735) **FAILURE（保留歷史，絕不改寫）**，但 HTTP201 原 owner 已建 ACTIVE，後續獨立真網站 [41449070224](https://github.com/NFF98/appf2-build/actions/runs/41449070224) SUCCESS：新 Chromium 0→1→2→3、reload 保留、另一 viewer 隔離、刪除/重建、真 Worker/PG CRUD 2xx，`REAL_PUBLISHED_RECIPIENT_FULL_PASS sample=g11-water`，訪客 `model_or_job_POST=0`。Supabase live share `4acf553e-09a8-4568-86f2-20a78caceb4d` `ACTIVE/public_opt_in=true`、bluehash `sha256:d29d72c588335eb70fd51cee4dbf314ce6f28aa5d0b49d92ce261e01c0a374cb`，現存 PG 4 rows。真 UI 曾 >15s，標 `PERFORMANCE_SLOW`，不可算速度完成。
3. **帳本區別：** 這 4/9 是四個不同、可操作、已發布、可重用的 AI App 真網站 E2E；**不是** 4 件任意 AI 生成 Node 後端證明。G10/G11 當時 `VITE_WEB`、用平台已簽署的 `appf2Records` Worker→Postgres bridge，沒有證明原 `VITE_NODE` 的任意業務後端可長駐、正式服務 API。原 SSOT「2/9」置頂是在沒有檢視上述真證據下錯誤寫入，**此段正式取代該現況**；其他歷史 9/9 已知樣本不得自動灌成通用未知全端滿分。
4. **下一個唯一產品 Gate：** **4/9→5/9＝55.6%**，要全新複雜 App 真正 AI→多檔前端+其自寫後端→既有免費 Docker 隔離執行→對網站供應真 API→PostgreSQL（受控資料權限）→原 QA/獨立實際 Chromium/關閉重開/分享，且在同原 Job 留可追溯模型費用／錯誤修復。僅 CI/Node self-test、平台通用 CRUD、新 commit 均不得再 +1。
5. **費用/變更：** 本回合 provider POST=0，無新模型 charge，無新產品重測，供應商 invoice 仍未核實；舊 G10+G11 原 CODE 各 20¢ `max_charge_cents` 為 ceiling 而非本回合扣款。只因真實已完成但被漏算的產品驗收更新 SSOT；不得重發已付回應、開新 PR、合併、發 Production 或 Sprint4。

**權威 SPEC：** Design PR #45 `working/architecture-evolution/SP35-UNKNOWN-MULTIFILE-RELIABILITY-20261103.md` 頂端「產品帳本更正」，由原 GitHub 工作流程與 live Supabase DB 支持。以下舊紀錄保留歷史，只以本段為現況報表。

---


**最高指令：目標不是繼續修平台，而是讓真正產品從 22.2% 突破到 100%。禁止每次修改都沒有實際產品進度。**
**現況：通用未知複雜 App 產品驗收 2/9 = 22.2%；本次僅更新 SSOT，新增產品 PASS = 0，完成率不變。**

本文件舊段落的「7/9、8/9、9/9」屬已知 Staging 範例/舊九案例帳本，**不得與本次通用未知複雜完整 App 產品帳本混算**。設計唯一規格來源：Design PR #45 `working/architecture-evolution/SP35-UNKNOWN-MULTIFILE-RELIABILITY-20261103.md` 首段「產品完成率唯一執行目標 SSOT」。

## 三階段交付目標（按真正產品驗收計分）

1. **55.6%（5/9）：新增 3 個真正產品 PASS。** 既有 AI + 既有 Sandbox + 同一份多檔 App（前端、Node 後端）+ 真後端執行 + 實際 PostgreSQL 打通。以全新、未知的複雜要求在**真網站**驗證自然語言生成、實際操作、真 DB 寫讀、保存重開；不以 Node 自測、固定 CRUD 或 Docker CI 代替。
2. **88.9%（8/9）：再新增 3 個真正產品 PASS。** 對真錯誤做編譯、Runtime、API、DB 的根因診斷與自動修復；原 Job 可靠持續／中斷恢復；驗證完整 App 的保存、分享及重用，重開無重新付費。真瀏覽器、真後端、真資料庫及可稽核 Job 版本缺一不可。
3. **100%（9/9）：最後新增 1 個真正產品 PASS。** 使用未預先告知的未知複雜完整 App 需求，證明一般使用者只輸入自然語言，AI 自主完成生成、建置、獨立驗收、錯誤修復、後端資料流、授權交付；無 Cursor、PowerShell、Docker 或人工手改程式。未通過就不能宣稱 100%。

## 每次修改必須推進下一個產品驗收（無證據不加分）

- **眼前唯一產品目標：2/9 → 3/9 = 33.3%。** 直接處理「全新未知 AI 生成的完整 App 在真網站透過真後端 API 操作 PostgreSQL，保存並重開」的最早阻斷；不是做另一輪平台 smoke、既有範本或免費 CI。
- 每個 Build PR #419 修改，在提交前標明**一項未過的原產品 Gate + 真正阻斷 + 預期證據**，先更新 Design #45 SPEC，再 Implement；修改後只以**新真網站產品 E2E**和逐項驗收記錄升級計分。不能為了有 commit 而添加無關功能。沒有新增產品 PASS 則回報 **x/9 不變、失敗根因、證據、唯一待修點**，不虛報或以平台 PASS 灌水。
- 同一阻斷最多兩輪**有根因證據**的集中修復，沒改善即停止亂試並重估架構；保留原 Job/程式/失敗 receipt。不得重送未知結算的模型請求，不重複付費；新付費需先獲具體金額限額授權。只用原 Design #45、Build #419；不開 PR、不合併、不 Production、不 Sprint 4。
- **每回合進度回報欄位：** 真正產品 PASS x/9（%）；這次新增幾項 PASS；哪個實際新網站 App/原始自然語言；真網站／Sandbox／API／PG／重開／分享驗收證據及連結；阻斷／根因；模型 paid POST 次數、額度 ceiling、invoice 核帳狀態。**0 新 PASS 不得稱「真正產品突破」。**
- 上一工程基礎驗證 [#41550471325](https://github.com/NFF98/appf2-build/actions/runs/41550471325) 已 SUCCESS：既有網路隔離 Docker 內，同一 VITE_NODE 專案前端建置及 Node 後端自測成功，**不是**全新 AI 生成的長駐後端、真 PG 網站 E2E，故沒有讓產品 22.2% 上升；本文件不將它算成第 3 關。

---

# 2026-11-02 JST 第八件真網站產品通過，8/9=88.9%；最後G15先SPEC後免費preflight

- **G14 真網站 E2E SUCCESS**：唯一本批GPT-6新遊戲 `0aa5c5b9-9b59-429c-b246-d9530a232853`，CODE一次20¢ ceiling（1309/8326 tokens），新owner [41451412153](https://github.com/NFF98/appf2-build/actions/runs/41451412153) **completed/SUCCESS**，免費原QA [41452392255](https://github.com/NFF98/appf2-build/actions/runs/41452392255) 7/7 PASS，原網站HTTP201正式 ACTIVE，PG `public_opt_in=true`，公開 `https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/f6377216-86c2-400b-bc27-91586609836a`，blueprint hash `sha256:1d2a542f034672fa45a50c4b8d6d9ec7764f42a579a9d4eca4afd89fd4e7b40a`。全新Chromium真按未開門→需鑰匙→撿鑰匙→開門→出門逃脫→完成後不能再改→restart→reload重玩，`SP35 REMAINING CANDIDATE FULL PRODUCT PROOF PASS: g14-escape`；訪客`model_or_job_POST=0`。確實**8/9**，工具3、遊戲2、Postgres3，距9/9**只欠第三款不同遊戲**。
- **費用保守新批責任**：G5/G9/G10/G11/G12/G14全部完整且明確關閉所有未來paid，每件已發CODE20¢ ceiling合120¢；G6/G7/G8 failed/paused 各44¢保守留132¢；本批 `252¢/308¢`、另舊10/31四筆32¢未決獨立保留；不能說是供應商實扣，invoice NOT_VERIFIED。第九款新Job最多44¢，`252+44=296<=308`，前提先無相同舊Job／無新IN_FLIGHT及成本帳本重新核對；G14/過往作品一律禁止paid重生或補算PASS。
- **G15已Design#45§0.29先凍結**：「雙人猜拳對決」原自然需求、七條 source-bound QA及三回合另一Chrome holdout；下一實作只可在Build原PR#419更新`deploy/scripts/sp35-remaining-scenarios.mjs`、`deploy/scripts/sp35-remaining-native-website-e2e.mjs`及免費 preflight 對 scenario count，不得造範本/硬編遊戲程式。先在原PR免費全部`--preflight-all`無付費模型通過，才在同一workflow marker `[SP35-REMAINING-PAID-ONE-SHOT] [SP35-SAMPLE-g15-rps]`建立最後**一個新原網站Job**。必須真Docker QA、原建立者ACTIVE發布、另一新Chrome三回合操作、重開0模型才能到9/9；不通過最多兩輪證據修復且預算護欄優先，不得假PASS。原PR#419/#45，不merge、Production、Sprint4、另開PR。

---

# 2026-11-02 JST 再突破：G12 閱讀時間估算器原 AI 全鏈 7/9（77.8%）

- **唯一全新原生網站 GPT-6 Job** `0700ab27-5e10-4bd4-93ea-ff515a1fc672`，原Staging owner [run 41449772821](https://github.com/NFF98/appf2-build/actions/runs/41449772821) **completed/SUCCESS**，唯一模型 [run 41450149913](https://github.com/NFF98/appf2-build/actions/runs/41450149913) GPT-6.1 Sol CODE `SUCCEEDED`, 20¢ ceiling（input1541/output4131 tokens）；沒有第二次付費模型。原七條 QA free Docker + Chromium [run 41450603067](https://github.com/NFF98/appf2-build/actions/runs/41450603067) **7/7 PASS**（4.00、3.00、0.75、0.00、0速錯誤、清除）。原 P-256 owner 真網站 HTTP201 正式 ACTIVE 已存 PG `appf2_code_app`，公開 [閱讀時間估算器](https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/9758e421-e04e-4474-8c48-8e97e110f3c6)，share `9758e421-e04e-4474-8c48-8e97e110f3c6`，immutable hash `sha256:7a1d71ea833d63088895cc1ffeebea5acb16e5d9ca2868dc5e20a4bf0d096f59`，`public_opt_in=true`。
- **第二全新 Chrome 真操作 PASS**：同原owner run逐項真UI填字數速度、按估算4.00、改150/200得0.75、輸入速度0真看到「速度必須大於0」且無Infinity/NaN、清除看到「尚未估算」、reload後再算600/240得2.50，最後 `SP35 REMAINING CANDIDATE FULL PRODUCT PROOF PASS: g12-reading`，訪客`model_or_job_POST=0`，不是單元fixture或舊卡重開加分。產品 **7/9=77.8%**，分類：工具3、遊戲1、Postgres3，**欠兩款不同真遊戲**。
- **成本／風險非發票**：G12 本次新模型1次、20¢ max；原批准新增總風險上限308¢，已完整關閉 G5/G9/G10/G11/G12 的未用授權各只保留已發出20¢=>100¢；G6/G7/G8 fail/paused 各保留44¢=>132¢；合計保守 `232¢/308¢`，舊四筆10/31未決32¢獨立保留，provider invoice NOT_VERIFIED；G12 以後絕不能重送CODE/REPAIR。
- **下一步/交接**：先唯讀Supabase `appf2_agent_model_call` 及 `appf2_agent_model_runner_request`，確認無G14「小屋逃脫」既有付費Job/已完成App、不並行，G14已Design#45§0.25與Build原`sp35-remaining-scenarios.mjs`凍結；既有 batch `232+44=276<=308¢`，才在**原 #419** 以 `[SP35-REMAINING-PAID-ONE-SHOT] [SP35-SAMPLE-g14-escape]`單一commit trigger**一次**新 Job，絕不重新跑任何G6/G7/G8/G11/G12。G14若成功8/9，最後第九款須先Design#45凍結**另一完全不同遊戲**原prompt與至少7條 source-bound QA，再Build#419一套通用Runner執行；只可模型一次一Job、不超原308¢總風險。停止改變Production、合併、新PR、Sprint4。成功證據與費用持續寫本檔，若無關卡完成照實FAIL不加分。

---

# 2026-11-02 JST 新結算：G11 原AI喝水紀錄真全鏈 PASS，產品 6/9（66.7%）

- **最終成功實證**：G11原P-256網站Job `224ba726-de85-4a1c-ad3c-aef7eb0f334b`、唯一CODE GPT-6.1 Sol `SUCCEEDED/20¢ ceiling`、原凍結Docker/Chromium QA `7/7 PASS`（receipt run [41365402062](https://github.com/NFF98/appf2-build/actions/runs/41365402062)）、原網站流程 [41364911735](https://github.com/NFF98/appf2-build/actions/runs/41364911735) 最終 **FAILURE**，但原owner已HTTP201正式發布 ACTIVE `4acf553e-09a8-4568-86f2-20a78caceb4d`，保留不可改寫失敗歷史。原公開 [喝水紀錄](https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/4acf553e-09a8-4568-86f2-20a78caceb4d)，blueprint hash `sha256:d29d72c588335eb70fd51cee4dbf314ce6f28aa5d0b49d92ce261e01c0a374cb`；只讀PG已確認 ACTIVE/public_opt_in。首次公開新訪客16秒看不到杯數2，免費原來18秒 [41448485261](https://github.com/NFF98/appf2-build/actions/runs/41448485261) 同樣失敗，但兩次 PostgreSQL 真實寫入`{kind:water,cups:2}`；絕不冒稱那些FAIL為PASS。
- **SPEC→Build零付費通用修復**：Design原[#45 SPEC H-001](https://github.com/NFF98/appf2-design/pull/45)先明定真PG原UI允許**最多45秒**可見結果，慢於15秒揭露；Build原#419 `deploy/scripts/sp35-published-recipient-proof.mjs`有界等待及執行耗時記錄，不刪一項 frozen QA、不修改原生成App、Job/hash、不得SQL補來源或換owner。原流程另一免費獨立 [41449070224](https://github.com/NFF98/appf2-build/actions/runs/41449070224) **completed/SUCCESS**：真 AI UI 一個新Chromium 0→1→2→3、reload仍3、第二全新Chromium viewer仍0與資料隔離、刪除→0、reload仍0、再建立1、reload保留1，signed Worker/PG records list/create/update/delete 全部2xx、`model_or_job_POST=0`；log `REAL_PUBLISHED_RECIPIENT_FULL_PASS sample=g11-water`。全鏈嚴格閉環後才從5/9加至**6/9=66.7%**（工具2、遊戲1、真PG3）。
- **速度未達優化目標**：真實UI其中`16159ms`與`15755ms`，標`PERFORMANCE_SLOW`，不能把允許45秒解讀成效能達標。此次新模型呼叫0；G11原已發CODE單筆20¢ ceiling，provider **invoice NOT_VERIFIED**。
- **保守新增授權帳本**：G5/G9/G10/G11四個完整且禁止再次付費Job `4×20=80¢`，G6/G7/G8三個未完成各保留44¢：`3×44=132¢`，總 `212¢/308¢`（非實際扣款）；另歷史10/31四筆未決總32¢單獨保留，不重POST；全部新增paid Job已開始7（其中完整4、失敗/暫停3），加上原baseline2完成6/9。G11 paid chain一律不再重送。下一獨立新樣本 **g12-reading** 原需求/7項QA已在Design§0.24及 Build `sp35-remaining-scenarios.mjs` frozen；只有先唯讀核對無舊相同Job、無新未決模型、此批保守風險212+下一Job44=256<=308後，才能提交**唯一**新paid marker啟動，絕不多件並發。其後需繼續遊戲缺口和真產品9/9；保持僅Build#419/Design#45、不merge/Production/Sprint4。

---

# 2026-11-02 JST 最新：5/9（55.6%），G10 完整驗收關閉

G10 閱讀書單原Job `9eecc831-4bb9-4af4-ac88-546fd159c22d`、唯一CODE20¢ SUCCEEDED（1313/6652tokens）；QA [41364310433](https://github.com/NFF98/appf2-build/actions/runs/41364310433) 7/7；原網站 [41363905501](https://github.com/NFF98/appf2-build/actions/runs/41363905501) SUCCESS、1 CREATE/1 HTTP201 publish；ACTIVE `4c07f75f-1f4b-43d2-9a66-dab6761b8414`、blueprint `sha256:710314711d4704a81c380f537ab67225fc86632d430e5d510b26ad2fcbcab738`。額外免費 [41364683866](https://github.com/NFF98/appf2-build/actions/runs/41364683866) SUCCESS：list/create/update/delete 2xx、兩新Chromium/viewer隔離、已讀刷新保留、刪除刷新、再次新增重讀、0 model/Job POST。PG有兩個獨立測試viewer各自真payload {title:小王子,read:false}。同owner anonymous ID；分享creatorKey與Agent ownerThumb為不同表示，不能直接等值join判不存在，已依正式publish驗證及原log核對。

baseline2+G5+G9+G10=5/9（工具2/遊戲1/PG2）；本新增批次6個paid Job，完整3、blocked/failed3。G10付費命令關閉，不再自動修復。新增授權保守風險192¢（3closed×20+3blocked×44）；8calls上界152¢，非invoice。下一G11單Job44→236<=308¢；舊32¢不重送。已唯讀確認尚無每日喝水紀錄Job，下一件只啟動g11-water一次，禁止paid rerun；只原#419/#45、不merge/Production/Sprint4。

---

# 活動中：G10 原 Job 已建立，禁止重送（2026-11-02 JST）

接管已啟動唯一一次 G10 閱讀書單；[原網站工作流41363905501](https://github.com/NFF98/appf2-build/actions/runs/41363905501)，原 Job `9eecc831-4bb9-4af4-ac88-546fd159c22d`。模型 runner [41364070765](https://github.com/NFF98/appf2-build/actions/runs/41364070765)，CODE journal IN_FLIGHT、max20¢，整Job44¢，尚無QA/ACTIVE，不計分。不能重新跑paid workflow或同prompt；先只讀原journal/runner/QA/公開結果。

真產品已核4/9，完整證據見下一節。保守新授權風險含G10為216/308¢，舊32¢另列；invoice NOT_VERIFIED。當前 Cua 有公開G9 tab1，沒有歷史G6 owner tab；不得假造owner或重送G6。

---

# 2026-11-02 JST 接管核實：4/9（44.4%）；下一件 G10 尚未啟動

- G9 原 Job `9b5b9dce-142d-417a-9ca1-77113d7642ae` 全網站 [41334608554](https://github.com/NFF98/appf2-build/actions/runs/41334608554) SUCCESS：原 frozen QA 7/7、HTTP201、ACTIVE `a451295e-49e0-401e-855f-923152dbc65f`、獨立 Chromium/reload/零生成。額外 [41335358726](https://github.com/NFF98/appf2-build/actions/runs/41335358726) SUCCESS：水平、兩方向斜線、滿欄拒絕、勝後鎖定及重玩。PG 已核 public_opt_in=true，blueprint `sha256:f6c011bac6535597b1343a7604a44678d105a0052ffff89ba83a9291aa612509`。G9 唯一 CODE20¢ SUCCEEDED，1372/5747 tokens；本工作明確關閉其付費命令，後續只零生成重用。
- 因此 baseline2+G5+G9=4/9；2工具/1遊戲/1資料庫。G6暫停、G7/G8失敗，全部保留不計分。G8 repair 已 SUCCEEDED；第二 QA41334297332 仍6/7，全鏈41333481856 FAILURE，不能再標 in_progress。
- 最新免費 Foundation41335358675、公開重用41335358616 SUCCESS；指定舊41316476210 staging實際執行步驟SUCCESS，paid skipped。歷史負面骰子稽核與舊四治理Gate FAIL仍保留，不宣稱全庫通過。
- 既有308¢新增授權之保守風險：G5閉20+G6暫44+G7失44+G8失44+G9閉20=172¢；下一G10最多44→216¢<=308。已發出七calls上界132¢，不是發票；舊32¢未決另外保留，不重送。接管本輪尚無新增付費呼叫。
- 下一步只啟動先凍結G10閱讀書單一次原生網站鏈，保留Job/來源；QA/ACTIVE後另跑免費真PG HTTP CRUD/reload/第三Chrome隔離並讀PG核對才加分。不得重跑任何paid全鏈；只原#419/#45、不merge/Production/Sprint4。

---

# 最新接續：3/9（33.3%）；G8原Job修復中；瀏覽器環境已不可用

本段覆蓋下方舊「G6正在Cua操作／七次即停止」的即時狀態，歷史保留。Human已批准繼續全部，僅原Build#419/Design#45，無merge/Production/Sprint4。

- G5完整PASS關閉，原Job8880979c-d09d-44ef-aaa7-bd114a31a967；QA41329192200 7/7；ACTIVE760b46d4-19b7-4092-b53a-d5276eaf9068；公開新Chromium41329592905 attempt2全原需求/reload/holdout/0新模型。因此原2+G5=3。
- **G6暫停未計分**：3d494f27-6fdc-4037-b607-831e0f881620，CODE41331408357 SUCCEEDED20¢，但原Cua環境移除前未套用源碼/QA，Job CREATED/rev0。不得重建需求、重送CODE、SQL替換owner或匯出私鑰。只有原profile可用時取已保存模型結果續跑0新增模型。現工具未提供cua_repl，不可呼叫消失工具。
- **G7失敗未計分**：3f46af99-25f9-487d-bac7-e0ecfec5e0fc；原網站全鏈41331845180 FAILURE；CODE20¢＋REPAIR16¢均SUCCEEDED；QA41332322885與41332829113均6/7 reset FAIL，未ACTIVE。根因是本工作凍結QA的前置條件錯誤：翻一張牌不改配對數0，text_appears要求先消失，故reset一直0無過渡。原程式有正確reset；不能改原QA/receipt冒PASS，不再付修復。Design§0.23已明記。
- **G8唯一活動Job**55ae5d78-e986-401a-91bb-70949f46c7da；原網站owner全鏈 [41333481856](https://github.com/NFF98/appf2-build/actions/runs/41333481856) in_progress。CODE41333627739 SUCCEEDED20¢/1267in4352out，source84ca11ff...；QA41333867328為6/7 win FAIL；同Job REPAIR16¢ runner41334081101 IN_FLIGHT。先讀最終journal與第二QA/發布/訪客，不再啟動其他paid。初查原source邏輯正確但玩法靜態文案亦含「解謎成功」，可能導致text_appears沒有absent過渡；須據第二結果根因分析，不假稱模型遊戲邏輯錯誤。
- **費用規範以Design§0.24最新為準**：不增加新增總308¢/每Job44¢。完整驗收且明確關閉的Job僅釋放尚未發送保留額，仍保留全部實際發出模型max_charge總上界；暫停/失敗/未知維持44¢。G5閉20+G6暫44+G7失44+G8活動44=152¢保守風險；已發出6calls上限112¢（G8repair未知，絕非invoice）。舊10/31四筆32¢另列不重送。每新Job前read-only逐筆重查帳本，risk+44<=308才可序列一次新需求。失敗/blocked全部保留，完成9/9不是生成嘗試100%成功率。
- 為補足3tool/3game/3DB，§0.24已先凍結全新g12-reading/g13-order（不是重生G6/G7）。原六樣本不變，新增兩組已寫manifest；free preflight commit2d1b9e4，只做56 source quotes/拒絕無授權，不付費。須先完成g8/g9/g10/g11再考慮兩替代且核預算。
- CI fallback是實際Chrome原網站UI：deploy/scripts/sp35-remaining-native-website-e2e.mjs，每paid marker只一個新owner Job、原文7QA/44c/同意、QA後另明確發布、另chromium.launch訪客原操作/reload。**禁止重跑paid全鏈**，失敗保留原Job。下一件g9-connect由原workflow加唯一新commit marker啟動；之後g10-books/g11-water。
- postgres額外必須用sp35-published-recipient-proof.mjs現成免費job：實際UI→簽章records HTTP list/create/update/delete全部2xx、refresh等待真list、另Chrome viewer隔離、read-only PG確認payload；單純memory QA/ACTIVE不計分。
- published-recipient-free-only僅改sample/share再commit [SP35-RECIPIENT-FREE-ONCE]，不含paid marker；新paid每次只 [SP35-REMAINING-PAID-ONE-SHOT]＋[SP35-SAMPLE-指定未見sample]，先核帳，前一模型已終結才啟動。workflow已有8個sample選項，無自動loop。
- 必須持續到真9/9或不可越過的實際外部/額度阻斷。每里程碑繁中約100字，成功證據/費用/阻斷/下一步；結束再更新此檔與closeout，不叫Human操作本機。

---

# 最新 2026-11-02 JST：真產品已 3/9（33.3%），G6正在原owner網站執行

**覆蓋下方舊2/9/公開FAIL checkpoint。G5最終全鏈已真PASS，不重生不再付費。**
- 原G5 `8880979c-d09d-44ef-aaa7-bd114a31a967` CODE1次/20¢上限，1889/5042 tokens；QA #41329192200 7/7；ACTIVE share `760b46d4-19b7-4092-b53a-d5276eaf9068`，原碼/source/blueprint hash完全未改。
- 表單事件策略的最終 **Foundation #41330733610、完整Staging #41330733503均SUCCESS**，7種因果/安全變體全PASS：without-adapter負例、public/private、已preventDefault不雙執行、invalid、惡意top/blank無表單網路/彈窗，仍allow-scripts/no allow-forms/CSP網路none。
- **公開訪客 #41329592905 attempt2 SUCCESS，job124920698547**：真新Chromium計算1100/275、600/3=200、零人拒絕/無Infinity NaN舊結果、重設、holdout100/3/5=35、reload再算，model/Job POST0。已只重跑該free recipient job，未rerun paid模型。Cua公開tab3另真算1100/275，截圖已取得；tab3已markDeliverable。
- PG重核同原owner、ACTIVE/public_opt_in、blueprint `sha256:1e8806cb43f40f6ddc7e1ee0fab35d76199fe6a1a3b3141ee4a8f7ac1c842be1`，model_calls1/ceiling20¢。因此**原2+新G5=3/9**，不是拿工程fixture或舊重開加分。詳細已寫固定closeout最新頂端（6fd2b4e）。
- **活動中G6長度換算器 Job `3d494f27-6fdc-4037-b607-831e0f881620`**，17:24:34Z由**同持續Cua tab1 / ownerTab**真網站新需求建立，7原QA入庫、44¢ cap；request_hash `sha256:878be5f8f6e8aa82bc6ac8b529fc7992ce5706c32fbde8577bf01992e6670dbb`。先查其model journal/run/QA/UI，**不要新建同需求Job/不要重送CODE**。
- Cua REPL已保留 `frozenInputs`（六項原文/plan，從已凍結manifest轉為純JSON共享檔）、`prepareFrozenSample(id)` helper（只填原UI和44¢/5同意，不點生成），`ownerTab` tab1（已markHandoff）、`mealPublicTab` tab3（已markDeliverable）。共享純輸入檔 main `/workspace/scratch/sp35-frozen-browser-input.json` ↔ browser `/home/oai/share/sp35-frozen-browser-input.json`，非金鑰。若REPL不可用，先依cua文檔綁既有tab1，不關原profile；可重新從該JSON取純prompt/QA資料填UI。每新候選只做一次初始生成click，Pub需等QA後另勾同意/點發布；保持原Job可恢復。
- 至G5完成批准的7新paid名額已用1（Job reserve44¢/模型ceiling20¢），G6是第2個將占44¢；最大仍7×44=308¢，舊未決32¢另列，不重送。G6完成再依g7-memory/g8-lights/g9-connect/g10-books/g11-water，逐件，不同時model。所有已付原碼進度保留。
- 每件完成後在 `.github/workflows/sp35-one-paid-ai-real-e2e.yml` **只修改published-recipient-free-only job**的sample/env真share UUID，用 `[SP35-RECIPIENT-FREE-ONCE]` 啟動免費新Chromium原App操作；不包含paid marker。不重用G5的share冒充新生成。DB兩件還須真HTTP CRUD/refresh/第二獨立browser隔離與只讀PG records核對。這個免費job的script `sp35-published-recipient-proof.mjs` 已有六manifest操作，無新生成route。若免費test失敗，保存原Job而非重付源碼。
- 繼續工作到9/9或真費用/外部阻斷；用每里程碑約100字繁中回報。只原#419/#45，不merge/Production/Sprint4。

---

# 2026-11-02 JST 最新 checkpoint：G5已付費成功、7/7、ACTIVE，但公開form互動FAIL，策略修正驗證中

**真產品仍2/9（22.2%），禁止加分。** Model G5 `8880979c-d09d-44ef-aaa7-bd114a31a967` **CODE SUCCEEDED**，1889 input/5042 output，max_charge20¢（不是invoice）；44¢Job cap。這是已批准7個/308¢中的**第1個paid Job**，後續6個名額264¢。舊32¢未決保留。**不要重送CODE，不要重生餐費**。

- 原生Cua Browser tab **1 / ownerTab**，已markHandoff，原owner非匯出式key/Job/QA全在同profile；不要關閉。tab **3 / mealPublicTab** 是已發布頁面，URL已實際開啟 `https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/760b46d4-19b7-4092-b53a-d5276eaf9068`。
- Model [#41328942825](https://github.com/NFF98/appf2-build/actions/runs/41328942825) SUCCESS；6檔（3 TS模組）snapshot project `sha256:4ed7629c245c14fa76e68a145b38de5091fc26bb932ed6360445a296872fcf0d`，原碼永久保留。
- [Docker/獨立QA #41329192200](https://github.com/NFF98/appf2-build/actions/runs/41329192200) SUCCESS，7/7；built artifact `sha256:278c251d4e04422fe5222ac66d0c4db2be27360dae340eab77ad3eacd9fc51fe`。
- 原owner UI另勾明確公開同意並發布，PG確認share `760b46d4-19b7-4092-b53a-d5276eaf9068` **ACTIVE/public_opt_in/同owner**，blueprint `sha256:1e8806cb43f40f6ddc7e1ee0fab35d76199fe6a1a3b3141ee4a8f7ac1c842be1`。**只ACTIVE不算產品成功**。
- [免費獨立公開訪客 #41329592905](https://github.com/NFF98/appf2-build/actions/runs/41329592905) **FAIL**：1000/4/10填好點計算，沒有1100。Cua在公開tab3與私人tab1都真重現，未假PASS。
- 根因已分析：原Vite JS 5871字完整包於公開13619字JS（起點7749），沒有漏原碼；計算listener綁form submit。sandbox **allow-scripts** 會在派發submit之前拒絕原生forms，普通plain-page QA因而不代表真sandbox（HTML標準）。不應付費重寫餐費邏輯或偷偷加allow-forms。
- Design #45 **§0.21 SPEC first**（6b149c0），在兩輪入口修復後換**通用受信任DOM事件適配策略**：submit button真click→preventDefault原生動作→驗證欄位→在同opaque frame派發cancelable SubmitEvent。**不加allow-forms/same-origin、不改CSP禁網/禁form-action、不動AI artifact/code/hash**；私人和公開frame共用固定adapter、各加精確CSP hash；原source/Job保留，新增模型0。
- Build已有 `src/app/runtime/code-dom-events.ts` + public/private renderer；可信免費因果/安全實驗 `deploy/scripts/sp35-no-network-form-events-e2e.mjs`（無adapter負例、public/private計算/重設、invalid驗證、click preventDefault不重複、惡意_top/_blank表單不能送網路）。它使用同實際renderer，不執行App特定計算以冒充產品。
- 最終策略候選 HEAD **412de4c4e7274dac913a528e96cb357f9ad84b42**，免費Foundation **#41330733610**、Staging **#41330733503** 執行中，需讀最終結論。早先c16d6ea跑的lint FAIL（私有CSP漏引用eventHash、fixture max-depth）已精確修正，不能改稱PASS。沒有新增App/費用。
- **接續**：若免費因果/安全實驗SUCCESS且Staging完整SUCCESS，先reload **公開tab3**（只重開既有card、0AI）按相同1000/4/10證明1100/275；保留owner tab1不生成新Job。再用GitHub `rerun_workflow_job` **只重跑 #41329592905的published-recipient-free-only那個免費job**（先fetch jobs取id；其他paid jobs全部SKIPPED，不重跑整個paid workflow）。測試腳本含100/3/5 holdout、錯誤/重設/reload/0generation。新公開完整PASS+PG同hash不變才3/9。
- 策略實驗FAIL時保留原證據，先根因分析，不假PASS。後續六件原文/42條QA已在§0.19和manifest，依下方詳細指南逐一同owner原生UI推進。持續到9/9或真實超額/不可解阻斷；不再重問這7件已批准費用。

---

# 2026-11-02 JST — 正在執行，最新狀態優先於下方舊交接

Human已回覆「批准繼續做完全部」。已在Design #45 H-001 §0.17記錄有限上限：**剩餘7個新paid Job，每個≤44¢，合計≤308¢**，一次一個，不限額重問、不批次並發；舊32¢未決風險另列、不重送。原產品仍**2/9（22.2%）**，到真ACTIVE＋獨立新browser通過才加分。

## 活動中的原生owner與真模型（不可重建或再付CODE）

- **持續cloud Browser tab 1**，handle `ownerTab`，URL `https://appf2-sp35-417-staging.juiyuang69.workers.dev/`，已markHandoff。原需求「餐費分攤工具」及原始7條QA已從網站UI填入，5項同意已勾、Job cap44¢。只透過UI操作，不讀取/匯出私鑰。保持tab/profile，不要關閉或初始化另一個代替owner；在後續turn先按cua文檔恢復既有tab1、重新markHandoff。
- **新G5原Job `8880979c-d09d-44ef-aaa7-bd114a31a967`**，原prompt request_hash `sha256:cbfb7a6ec51fc4d0ad55156b4d063f42fe9afb2225b46e644985164ff5229714`，原始7條QA已入庫。Model `sp35_free_ai_code_v1` **IN_FLIGHT，20¢ max_charge**，實扣NOT_VERIFIED，整Job44¢。**禁止另建同prompt付費Job或重跑CODE**。
- [真模型 Runner #41328942825](https://github.com/NFF98/appf2-build/actions/runs/41328942825) private-paid-ai正執行唯一一次model POST。下一步只讀journal/Runner/原tab狀態；等源碼保存及免費Docker/獨立QA結果。未知結果不POST重送。
- 0/7後續真正PASS尚未增加；本輪paid Job額度占用1×44¢（後續6個名額264¢），單次CODE上限20¢只是保留，不冒充invoice。

## 已完成兩輪集中修復及換策略（不要第三輪盲修）

- 第一根因：CREATE1400拒絕1950 bytes合法中文；§0.16最小4096修正、[Staging #41326481475](https://github.com/NFF98/appf2-build/actions/runs/41326481475) SUCCESS。
- 第二根因：free-ai-stage等完整800字原文路由仍1400。§0.18修為精確CREATE/publish/free-ai-stage/free-ai-repair-evidence/qa-generate4096，其餘1400/24000/200000不變，所有PoP/owner/QA/budget保留。FREE_ONLY停用的舊qa-generate仍提前均勻404（不開啟它、不為測試調安全順序）；正規啟用環境仍4096單元驗證。
- **最終完整免費** [Staging #41328297162](https://github.com/NFF98/appf2-build/actions/runs/41328297162) **SUCCESS**：所有實際啟用原文路由>1400<=4096錯PoP404，>4096拒絕413、agent-progress>1400仍413，停用legacy QA保持404，全部其餘免費回歸已核對。
- [Foundation #41328297159](https://github.com/NFF98/appf2-build/actions/runs/41328297159) SUCCESS；新測試腳本候選d3eeec9之 [Foundation #41328802733](https://github.com/NFF98/appf2-build/actions/runs/41328802733) 也SUCCESS。舊四Gate Human Task前檢實際FAIL，不報PASS、不阻本產品。
- 正式publish合約為**201 Created**（正確），接受200/201但必須ACTIVE真row+URL+新browser實際操作，不能只等200而誤報失敗。原QA7條不變。
- 前兩個UI入口嘗試無model POST：#41326123312取消前無matching Job；#41327212659之空Job `b439ed54-4a9a-4f2d-8a32-14c06df42d53` 有7 QA但model_call/runner_request=0，已取消原ephemeral waiter，Job/QA保留；不可冒充舊owner復原。它們沒有AI原始碼、不占paid名額，不許把它們當產品PASS。
- §0.20策略改為持續owner cloudtab保存原身份＋獨立免費CI訪客驗證，不再丟棄已付費owner。不要再盲目迴圈重新生成。

## 成功後及後續六件

1. 原owner tab1等同Job免費Docker收據**七項全部PASS**與實際預覽，再勾「我同意將目前這份經過完整QA的App公開發布」，點正式發布。讀UI錯誤，保持owner。4xx失敗閉鎖；5xx最多同owner/idempotency免費一次，不重做模型。
2. 獨立讀PG `appf2_code_app` 真ACTIVE/public_opt_in、source/QA/preview/blueprint hashes一致。取得**原tab真share link**，不要編造URL。
3. 已準備 `deploy/scripts/sp35-published-recipient-proof.mjs`，僅接受既有share UUID、白名單sample，完全0 generation；它在**新的Chromium process**實際操作公開原App/reload/reuse，DB類再第三個browser比隔離並觀察真records HTTP CRUD。原workflow `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 之 `published-recipient-free-only` job等待固定share，目前env placeholder不是可用卡。
4. 將該原workflow此job兩個env設定真 `APPF2_SP35_SAMPLE: g5-meal` / `APPF2_EXISTING_SHARE_ID: 真UUID`，提交唯一 `[SP35-RECIPIENT-FREE-ONCE]` marker；**不包含任何PAID marker**。免費訪客全PASS+PG核帳後才3/9。
5. 其餘原自然需求/42 QA先凍於Design §0.19（commit48933e9），Build已有 `sp35-remaining-scenarios.mjs`，順序g6-length（工具）、g7-memory/g8-lights/g9-connect（遊戲）、g10-books/g11-water（真PG）。已用實際parseQaPlan免費驗6份/42條schema，原自然文<=800、各7 QA<=8steps。一次一個、各44¢、保留同原Job與所有source。每筆新Job前重核journal+7名額/308¢餘額，任何已付不重生。
6. 可用持續owner UI填下一原prompt+frozen plan（資料全在manifest），原Job keys保留；或已備妥逐一CI驗收腳本 `sp35-remaining-native-website-e2e.mjs`，但不可在owner尚IN_FLIGHT時並發新paid Job。優先保持owner可恢復的策略。原workflow之 `one-remaining-native-original-request` **只有**同次message含 `[SP35-REMAINING-PAID-ONE-SHOT]` 和一個 `[SP35-SAMPLE-g6-length]` 等才會paid；不要隨意觸發。所有free/paid marker必須分開。
7. 每個完成里程碑回報真x/9、evidence、max reservation vs invoice unknown、阻斷與下一步。失敗保留原Job，不改QA，不偽造PG owner，不超額、不第三輪盲修。只原#419/#45，不merge/Production/Sprint4。

---

# APPf2 Sprint 3.5 → ChatGPT Work execution handoff (2026-11-01)

**DO WORK, not a fresh planning discussion.** User has approved continuation and wants real products operational and real costs bounded. Only existing Build PR #419 and Design PR #45. Never Sprint 4, merge, Production deploy, prompt the user for CLI/Cursor/Work re-selection, or pretend CI-only checks are products.

## Single source of truth / permissions

- Build: https://github.com/NFF98/appf2-build/pull/419 ; branch `product/sprint-3.5-complex-intent-recovery-20261026`.
- Design: https://github.com/NFF98/appf2-design/pull/45 ; branch `product/blueprint-code-artifact-hybrid-20261028`; SPEC `working/architecture-evolution/BLUEPRINT-CODE-ARTIFACT-HYBRID.md` §0.12–0.14. **Spec first** for any change in acceptance/cost/architecture.
- Product SSOT: `docs/sprint-3.5/SP35-FIVE-CORE-PRODUCT-CLOSEOUT.md` (on Build #419).
- Exactly **2/9 real successful independent NEW AI-created products = 22.2%**; third PASS requires new distinct signed native website owner to generate APP and save code, frozen original 7/7 independent network-denied Docker+Chromium QA, **200/ACTIVE published new share card**, and **fresh stranger Chromium actually clicking the AI-authored published App** (including reload/reuse with **0 guest model requests**). Baseline 1 tool + 1 PostgreSQL CRUD. Original desired category mix 3 simple tools, 3 interactive games, 3 real PostgreSQL apps. No fixed fixtures, old public cards or 7/7 without publication may increase numerator.

## 413 incident, paid state, and current code

- Real G3 new AI Tic-Tac-Toe `31d6a1f4-df41-4c41-8f92-5800a937c7c7`: GPT code succeeded, 6 source files, isolated Chromium QA 7/7, original creator publication did **NOT** result in public link, no guest; owner ephemeral P-256 private key expired. Preserve only. Source Run https://github.com/NFF98/appf2-build/actions/runs/41311674915.
- Real G4 new AI stones game `7045a009-6bfc-4889-8f1b-df03ba93c406`: GPT code succeeded, 7 source files, original Chromium 7/7, **owner publish HTTP 413 AGENT_JOB_TOO_LARGE**, no share/guest; owner ephemeral P-256 expired. Source Run https://github.com/NFF98/appf2-build/actions/runs/41313398452 ; isolated QA https://github.com/NFF98/appf2-build/actions/runs/41313795170. No recovery with SQL/admin bypass; do not re-run model for these old jobs.
- Confirmed root cause: `src/edge/agent-jobs.ts` generic POST max 1400 bytes erroneously applied to `/publish-code-app`. Valid Chinese 800-char prompt plus metadata exceeds it **before auth**. SPEC §0.14 freezes exact publication route max **4096 raw bytes**, keeping other 1400/24000/200000 caps, owner P-256, same-Origin, unchanged QA hash/ACTIVE gating.
- Code patch on Build PR `c810ed8`; free unit `tests/api/sp35-agent-publication-size-limit.api.test.ts`; real staging readonly negative-PoP `deploy/scripts/sp35-staging-publish-size-readonly-smoke.mjs`; workflow `.github/workflows/sp35-staging-only.yml` runs real staging smoke AFTER deploy, no model.
- Early first staging one-shot run https://github.com/NFF98/appf2-build/actions/runs/41316281418 FAILED early on ESLint (2 game scripts max-depth + staging smoke Node globals), **not** a 413 logic failure. Precisely scoped lint fixes committed `4f3e97e`, `36823f4`, `e14a468`. Second isolated staging one-shot run **https://github.com/NFF98/appf2-build/actions/runs/41316476210** was started with one marker `[SP35-G0-FREE-STAGING-ONCE]`; Foundation https://github.com/NFF98/appf2-build/actions/runs/41316476230. Read actual final conclusions and live smoke evidence; if pending, continue in same work. These are **free** staging and QA, not new paid App.
- Cost: G3/G4 each 44c **per-Job maximum reservation** with one 20c successful CODE ceiling each; **NOT provider invoices**. Earlier November 1 total SUCCEEDED model ceiling was 188c before G3, and October 31 unresolved IN_FLIGHT/BLOCKED_UNCERTAIN 32c risk; read-only reconcile with Supabase `xxwnxetwufwyiisgaqhl`, never assume uncertain exposure is zero. User authorizes additional bounded progress but no unlimited spend; propose finite per-Job 44c and do not exceed without explicit approval. Never spawn multiple paid Jobs in a loop, retry an unresolved model call, or reset old ledger. Do not print secrets.

## Continue executing, not just reporting

1. Inspect latest existing two PR HEADs and SPEC. Inspect staging run #41316476210 logs/steps and free Foundation run #41316476230; fix real failures **within at most 2 focused evidence-backed repair rounds** in the SAME Build PR, SPEC first where appropriate. Do not repeatedly fire Workflows with old paid markers.
2. Verify in current **isolated Staging** `https://appf2-sp35-417-staging.juiyuang69.workers.dev` that invalid-PoP long Chinese share payload >1400 and <=4096 gets **404 not 413**; >4096 gets **413**; other Agent >1400 gets **413**; health/readiness 200. This is a SECURITY/INGRESS PASS only, NOT product 3/9.
3. Run free existing published-App multi-browser reuse to confirm no regression; never re-generate paid source to prove regression. If necessary adjust only deploy/tests code in existing PR.
4. After confirmed fix and **only with explicit finite budget for a new distinct creative App**, use native website owner P-256 consent to start one NEW model Job capped 44c. Freeze original 7 QA criteria based on human requirement BEFORE AI. Capture publish POST HTTP status/code and UI alert while the **original owner Chrome context remains alive**; on 5xx at most one same-owner same-idempotency free retry, 4xx FAIL_CLOSED. Require new published ACTIVE share URL and fresh separate visitor Chrome interacting with actual immutable App. Save jobId/shareId/Run IDs/console and evidence. Advance 2→3/9 only if ALL PASS.
5. Iterate one genuinely distinct App at a time toward 9/9 within user-approved costs; simple tools, games, and PostgreSQL apps. Each independent acceptance must prove original use case with functional actions, persistence for DB, share/reload, no fake App. Two repairs max before root-cause strategy switch. Never imply Work or CI will autonomously monitor for eternity; deliver saved handoff if session ends.
6. Every meaningful milestone report in Traditional Chinese concise **real product PASS x/9 (%), new job count, paid ceilings vs verified invoices, last error/code, next concrete action**. Do not claim success based only on unit/CI.

## Work products

- Commit changes only in Build PR #419 / Design PR #45; always cite GitHub Actions evidence and actual Postgres rows for count decisions.
- No merge, no Production deploy, no Sprint 4. Prioritize user-visible functional Stage A: one sentence → real interactive App card → saved, shared, reused.
- No asking user to open Cursor, paste PowerShell, or repeat context. If budget or external permissions really block, say the exact blocker and preserve the current version.


## Work 接管查證與下一筆費用暫停（2026-11-01，日本時間）

- **產品仍 2/9（22.2%）**。本 Work 新增 paid model POST = 0；沒有新 Job/ACTIVE share，不能升到3/9。
- 原 Staging [#41316476210](https://github.com/NFF98/appf2-build/actions/runs/41316476210) **completed/success**，已逐項核對全部 step 及完整 job logs；paid markers false、paid model jobs skipped。真 ingress：>1400且<=4096中文錯PoP為404；>4096及其他Agent>1400為413。視窗/全屏、舊卡重用、PG橋/兩次Chrome冷啟動等指定免費回歸 step成功。
- Foundation 原 #41316476230 是 **cancelled**，不可改寫為成功；同舊程式後續 [#41316637632](https://github.com/NFF98/appf2-build/actions/runs/41316637632) **SUCCESS**，types/lint/API/runtime/Docker/Chromium全部實際執行。
- **負面證據仍在**：Staging末段舊十八啦稽核刻意保存 TWO_PAIRS_TWELVE、TRIPLE_MUST_REROLL、結果/排行/規則缺頁；corrected live published card另外驗證成功。不能把workflow success說成所有舊App合格。既有CI Gate在 Human Task授權預檢失敗，完整舊Gate skipped；不是產品新測試PASS，不拿它阻擋本Sprint。
- Supabase只讀重新核帳：2026-11-01 UTC **12筆SUCCEEDED GPT-6.1-sol，model_call ceiling 228¢**；10/31兩筆IN_FLIGHT+兩筆BLOCKED_UNCERTAIN，各8¢共**32¢未決風險**。供應商實扣仍NOT_VERIFIED；最後成功model journal created_at=2026-11-01T13:54:54.797822Z。本Work沒有增加模型journal。禁止重送這四筆。
- G3/G4原44¢兩個獨立批准均已各自執行，不存在可推定的下一個44¢餘額。**下一新Job等待Human明確批准新增最高US$0.44**；舊32¢風險另列且不可當零。不要因「持續」字眼觸發paid marker。

### 已完成的下一款免費準備（不是產品PASS）

- SPEC first：Design #45 H-001 §0.15，commit b85cc1673012a5dae4009721930c4276d94c51a6，下一款**全新餐費分攤工具**，凍結七條原需求QA；不是重生已付井字棋/拿石頭。
- Build #419新增 `deploy/scripts/sp35-fifth-native-website-meal-tool-e2e.mjs`：真原生首頁owner、44¢ Job cap、七項QA、200發布診斷、ACTIVE link、**另一個全新Chromium process**填表/計算/錯誤/重設/reload再算，guest model/Job POST必須0；尚未執行paid path。
- 實際平台 `parseQaPlan` 本地檢查成功：7 criteria、最多6 steps、source_quote均來自原prompt；syntax與無授權拒絕檢查成功。欄位用number/spinbutton避免QA角色歧義。
- 原既有 `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 已準備G5 job；最終免費 [#41317624931](https://github.com/NFF98/appf2-build/actions/runs/41317624931) g5-meal-free-preflight SUCCESS，syntax/frozen plan/未授權拒絕/Staging readiness GET 全成功，g5 paid及所有其他paid job **SKIPPED**。
- 最終工程候選HEAD `bd1e4b0ffe81fb260123f32038274ef982ba152f`；最終Foundation #41317625058 與live reuse #41317624981需依下面最終核對結果。文件追加commit只改交接/記錄，不啟動付費。

### 下一個Work直接接續指令

先讀本節、#419/#45最新HEAD與最終免費runs。若Human仍未批准**新的44¢單Job**，停在PAUSED_BUDGET，僅免費查修，**不提交paid marker、不新建付費Job**。批准後先只讀重核Supabase appf2_agent_model_call（包含原32¢風險，invoice未查仍標NOT_VERIFIED），再只於原 #419 的 `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 加一行當次授權紀錄，以唯一 `[SP35-G5-MEAL-PAID-ONE-SHOT]` commit message啟動**一次**。不要rerun舊G3/G4/舊paid workflow。

持續等待原G5 Job/免費Docker Chromium，最多兩輪集中修復且不超44¢、未知模型結果不得POST重送。必須核對該**新**job source/version、原凍結7/7 QA、200 ACTIVE新share、PG真ACTIVE/hash，以及新的獨立Chromium實際填表/算1100與275、600/3=200、零人拒絕、重設、reload再算、guest生成0。全部通過才+1為3/9；若失敗保留原Job/source/receipt及HTTP錯誤，在同PR分析根因。只Sprint3.5、不新PR、不merge、不Production。

### 最終免費結果（本Work已核對，非新產品驗收）

- [Foundation #41317625058](https://github.com/NFF98/appf2-build/actions/runs/41317625058) **completed/success**：精確工程候選 bd1e4b0 types/lint/build/API/runtime、temporal QA、多檔/browser、network-denied Docker、真Staging Job→Docker全完成。
- [Live published reuse #41317624981](https://github.com/NFF98/appf2-build/actions/runs/41317624981) **completed/success**：既有App兩browser實際操作/reload與新Agent無同意零呼叫回歸。
- [G5免費預檢 #41317624931](https://github.com/NFF98/appf2-build/actions/runs/41317624931) **completed/success**；所有paid jobs skipped。沒有新AI Job、沒有新published card，所以仍2/9。
- 本輪沒有新的真產品故障需要集中修復；**阻斷是下一筆US$0.44新授權尚未取得**。原413修正已部署且免費驗證，不能拿免費PASS補分。最後ledger重核仍12筆/228¢ ceiling；invoice unknown；舊32¢ risk仍保留。
