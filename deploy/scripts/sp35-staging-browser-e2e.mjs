// REAL browser journey against isolated staging: Discover -> Create -> Generated App -> Home.
// Bounded real model calls for Hello World E2E and LifePilot-style analysis; no mocks or secret/response-body logging.
import { chromium } from "@playwright/test";
import path from "node:path";

const origin=new URL(process.env.APPF2_STAGING_URL?.trim()||"");
if(origin.protocol!=="https:" ||
   !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) ||
   origin.pathname!=="/" || origin.search || origin.hash){
  throw Error("STAGING BROWSER: isolated workers.dev HTTPS target required");
}
const taskMode=process.env.APPF2_SP35_BROWSER_TASKS_ALLOWED === "1";
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}});
const page=await context.newPage();
const screenshot=path.join(process.env.RUNNER_TEMP||"/tmp","appf2-sp35-browser.png");
try {
  await page.goto(origin.origin,{waitUntil:"domcontentloaded",timeout:40_000});
  const input=page.locator("#composer-input");
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: REAL Discover React UI rendered");
  await input.fill(taskMode
    ? "幫我做一個漂亮又好用的待辦清單，可以新增任務、勾選完成、刪除任務，還能看到今天完成多少。"
    : "Create a read-only one-screen welcome app titled Hello World. Show the text Hello World. No user input, payments, accounts, or external services.");
  // Watch actual signed API responses BEFORE clicking. A terminal 422 must fail
  // immediately, not spend 210s pretending the generated App might still mount.
  const helloAnalysis = page.waitForResponse(r => r.request().method() === "POST" &&
    new URL(r.url()).pathname === "/api/v1/intents", {timeout:110_000});
  const helloCompile = page.waitForResponse(r => r.request().method() === "POST" &&
    new URL(r.url()).pathname.startsWith("/api/v1/intents/") && new URL(r.url()).pathname.endsWith("/compile"),
    {timeout:150_000}).catch(() => null);
  await page.locator(".composer-create").click();
  console.log("STAGING BROWSER: clicked actual Create App button");
  const initial = await helloAnalysis;
  const initialData = await initial.json().catch(() => ({}));
  console.log("STAGING BROWSER HELLO ANALYSIS: HTTP="+initial.status()+
    " CODE="+String(initialData?.error?.code || "NONE")+
    " STATUS="+String(initialData?.data?.status || "NONE"));
  if (initial.status() !== 200 || initialData?.data?.status !== "READY")
    throw Error("STAGING BROWSER: Hello World analysis not READY; no generated App PASS");
  const build = await helloCompile;
  if (build === null) throw Error("STAGING BROWSER: Hello World compile never reached Worker");
  const buildData = await build.json().catch(() => ({}));
  const buildOk = build.status() === 200 && buildData?.data?.status === "VALIDATED" &&
    /^sha256:[a-f0-9]{64}$/.test(String(buildData?.data?.content_hash || ""));
  console.log("STAGING BROWSER HELLO COMPILE: HTTP="+build.status()+
    " CODE="+String(buildData?.error?.code || "NONE")+" VALIDATED="+buildOk);
  if (!buildOk) throw Error("STAGING BROWSER: Hello World F02 compile failed; App cannot mount");
  await page.locator(".s03-app").waitFor({state:"visible",timeout:45_000});
  const content=await page.locator(".s03-app").textContent();
  const hasText=taskMode ? Boolean(content?.trim()) : Boolean(content?.includes("Hello World"));
  console.log("STAGING BROWSER: generated S03 app mounted; REQUESTED_CONTENT_PRESENT="+hasText);
  if(!hasText)throw Error("STAGING BROWSER: Generated App visible but expected content missing");
  if(taskMode){
    const app=page.locator(".s03-app");
    const taskInput=app.locator("input[type=text], input:not([type]), textarea").first();
    if(await taskInput.count()===0)throw Error("STAGING TASKS: missing editable task input");
    const add=app.getByRole("button",{name:/新增|加入|add|create|\+/i}).first();
    if(await add.count()===0)throw Error("STAGING TASKS: missing labeled add action");
    const rows=app.locator(".rt-list-item");
    const values=["E2E-A","E2E-B","E2E-C"];
    for(const [index,value] of values.entries()){
      await taskInput.fill(value);
      await add.click();
      await rows.nth(index).getByText(value,{exact:true}).waitFor({state:"visible",timeout:12000});
    }
    if(await rows.count()!==3)throw Error("STAGING TASKS: add must create exactly three rows");
    const stats=app.locator(".rt-stat");
    if(await stats.count()<2)throw Error("STAGING TASKS: missing total/completed metrics");
    async function stat(index){
      const raw=await stats.nth(index).locator(".rt-stat-value").innerText();
      return Number(raw.trim());
    }
    if(await stat(0)!==3||await stat(1)!==0)
      throw Error("STAGING TASKS: initial total/completed metrics incorrect");
    const mark=rows.nth(1).getByRole("button",{name:/完成|勾選|切換|complete|done|check/i}).first();
    if(await mark.count()===0)throw Error("STAGING TASKS: missing row-specific complete button");
    await mark.click();
    if(await stat(0)!==3||await stat(1)!==1)
      throw Error("STAGING TASKS: completion count must increase for row B");
    const remove=rows.nth(0).getByRole("button",{name:/刪除|移除|delete|remove/i}).first();
    if(await remove.count()===0)throw Error("STAGING TASKS: missing row-specific delete button");
    await remove.click();
    if(await rows.count()!==2)throw Error("STAGING TASKS: delete must remove exactly one row");
    if((await rows.allTextContents()).some(v=>v.includes("E2E-A")))
      throw Error("STAGING TASKS: deleted row A remains");
    if(!(await rows.nth(0).innerText()).includes("E2E-B")||!(await rows.nth(1).innerText()).includes("E2E-C"))
      throw Error("STAGING TASKS: wrong row removed");
    if(await stat(0)!==2||await stat(1)!==1)
      throw Error("STAGING TASKS: final total/completed metrics wrong");
    console.log("STAGING TASKS: REAL A/B/C ADD + B COMPLETE + A DELETE + TOTAL2 COMPLETED1 PASS");
  }
  await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole("button",{name:"更多選項"}).click();
  await page.getByRole("menuitem",{name:"回到首頁 / 建立新的 App"}).click();
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: runtime app + home navigation PASS; screenshot saved");

  if (process.env.APPF2_SP35_BROWSER_COMPLEX_ALLOWED !== "1") {
    console.log(taskMode
    ? "STAGING BROWSER: NATURAL_TASK_LIST FULL CRUD+METRICS PASS; avoided extra paid LifePilot model request"
    : "STAGING BROWSER: HELLO_WORLD_ONLY PASS; avoided extra paid LifePilot model request");
  } else {
  // A single complex 5-feature analysis verifies the reported real-world
  // LifePilot incident (invalid schema followed by a short timeout budget).
  // Success here verifies analysis, NOT full complex-app implementation.
  const lifePilot = [
    "Create LifePilot, a beautiful mobile-first personal life organizer for daily use.",
    "The dashboard must immediately show what to do today, what to buy or remember, and how the week is going.",
    "Feature one: My Today lists scheduled tasks, priorities, progress and a friendly encouraging message.",
    "Feature two: Smart Tasks lets users add, edit, delete and mark tasks complete, filter by priority and due date,",
    "organize tasks into groups and categories and see live progress without page reloads.",
    "Feature three: Shopping List lets users enter groceries with quantities, check purchased items, edit and remove",
    "entries, and see a remaining-to-buy count. Feature four: Money Snapshot lets users enter daily expenses, assign",
    "categories, set a weekly spending budget and see the total and remaining budget update.",
    "Feature five: Healthy Habits tracks simple wellness habits such as drinking water, walking, reading and exercise,",
    "with daily completion and a transparent weekly streak count. Preserve input across refreshes where supported.",
    "Design requirements: warm elegant visual style, soft color palette, typography hierarchy, balanced card spacing,",
    "accessible interactions, friendly icons and a small tasteful celebration when daily goals are met.",
    "Build for desktop and mobile with responsive layout and simple consistent navigation between the five feature areas.",
    "Include safe editable sample data so the first view looks meaningful rather than an empty scaffold.",
    "Every button should perform its labeled action, including add, update, complete, delete, filter and navigate.",
    "Progress and expense totals must recalculate immediately after changes without fake static counters.",
    "A first-time user should understand how to use each feature without documentation, with helpful empty states.",
    "No login, accounts, subscriptions, payments, third-party integrations, API keys or external service dependence.",
    "Never claim unavailable functions work: represent missing capabilities accurately and allow the core experience",
    "to remain useful. If a requirement cannot be implemented with registered components, avoid invented components.",
    "Do not silently drop requested data, or present a visual mockup as an executable feature.",
    "Take the user's explicitly named features seriously; ask only essential questions that cannot safely default.",
    "The finished product should feel like a delightful daily assistant that people want to open every morning."
  ].join(" ");
  if(lifePilot.length < 1800) throw Error("STAGING COMPLEX: test fixture unexpectedly short");
  await input.fill(lifePilot);
  const analysisResponse = page.waitForResponse(r => {
    const u = new URL(r.url());
    return r.request().method() === "POST" && u.pathname === "/api/v1/intents";
  }, {timeout:100_000});
  // Observe the actual browser's second step BEFORE submitting, so a fast
  // compile response cannot race the response listener. No bypasses/mocks.
  const compileResponse = page.waitForResponse(r => {
    const u = new URL(r.url());
    return r.request().method() === "POST" &&
      u.pathname.startsWith("/api/v1/intents/") && u.pathname.endsWith("/compile");
  }, {timeout:190_000}).catch(() => null);
  await page.locator(".composer-create").click();
  const resp = await analysisResponse;
  const result = await resp.json().catch(()=>({}));
  const status = result?.data?.status;
  console.log("STAGING COMPLEX ANALYSIS: HTTP "+resp.status()+
    " CODE="+String(result?.error?.code||"NONE")+
    " STATUS="+(typeof status==="string"?status:"NONE")+
    " PROMPT_LENGTH="+lifePilot.length);
  if(resp.status()!==200 || !["READY","NEEDS_CLARIFICATION","READY_WITH_VISIBLE_ASSUMPTIONS"].includes(status)){
    throw Error("STAGING COMPLEX ANALYSIS: not yet verified for multi-feature LifePilot (no fake PASS)");
  }
  console.log("STAGING COMPLEX ANALYSIS: real 5-feature Prompt A PASS; compile/interactive proof follows.");
  if(status === "READY_WITH_VISIBLE_ASSUMPTIONS"){
    // This is a synthetic fixture. Confirm through the actual browser UI.
    const answersResponse = page.waitForResponse(r => r.request().method()==="POST" &&
      new URL(r.url()).pathname.endsWith("/answers"), {timeout:100_000});
    await page.getByRole("button", {name:"用這些設定繼續"}).click();
    const answerResponse = await answersResponse;
    const answerJson = await answerResponse.json().catch(()=>({}));
    console.log("STAGING COMPLEX CONFIRM: HTTP="+answerResponse.status()+" STATUS="+String(answerJson?.data?.status||"NONE"));
    if(answerResponse.status()!==200 || answerJson?.data?.status!=="READY")
      throw Error("STAGING COMPLEX: confirmation not READY; no false E2E PASS");
  } else if(status!=="READY"){
    throw Error("STAGING COMPLEX: essential questions require real user answers; no false E2E PASS");
  }
  const response = await compileResponse;
  if(response === null)throw Error("STAGING COMPLEX COMPILE: no browser compile response; full E2E NOT VERIFIED");
  const payload = await response.json().catch(() => ({}));
  const compileOk = response.status() === 200 &&
    payload?.data?.status === "VALIDATED" &&
    /^sha256:[0-9a-f]{64}$/.test(String(payload?.data?.content_hash||""));
  console.log("STAGING COMPLEX COMPILE: HTTP="+response.status()+
    " CODE="+String(payload?.error?.code||"NONE")+" VALIDATED="+compileOk);
  if(!compileOk)throw Error("STAGING COMPLEX: F02 Blueprint compile/validation NOT VERIFIED");
  await page.locator(".s03-app").waitFor({state:"visible",timeout:140_000});
  const appText = (await page.locator(".s03-app").innerText())||"";
  const requested = ["My Today", "Smart Tasks", "Shopping List", "Money Snapshot", "Healthy Habits"];
  const missing = requested.filter(feature => !appText.toLowerCase().includes(feature.toLowerCase()));
  console.log("STAGING COMPLEX RUNTIME: S03_MOUNTED=true FEATURE_LABELS_PRESENT="+
    (requested.length-missing.length)+"/"+requested.length+" MISSING="+missing.join(","));
  if(missing.length)throw Error("STAGING COMPLEX: generated app omitted requested named features; full E2E NOT VERIFIED");
  // A rendered mockup is not evidence of working state or persistence.
  const app = page.locator(".s03-app");
  const interactiveCount = await app.locator("button:not([disabled]),input:not([disabled]),textarea:not([disabled])").count();
  console.log("STAGING COMPLEX INTERACTION: ACTIVE_CONTROLS="+interactiveCount);
  if(interactiveCount===0)throw Error("STAGING COMPLEX: all requested features appear static; interactivity NOT VERIFIED");
  console.log("STAGING COMPLEX: Blueprint validated and five labels visible, but CRUD and persisted data still NOT VERIFIED.");
  }
} catch(error) {
  await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
  throw Error("STAGING BROWSER: real user journey FAILED ("+String(error?.name||"unknown")+
    "); review browser screenshot and step evidence",{cause:error});
} finally {
  await browser.close();
}
