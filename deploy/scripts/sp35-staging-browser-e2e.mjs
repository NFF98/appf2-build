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
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}});
const page=await context.newPage();
const screenshot=path.join(process.env.RUNNER_TEMP||"/tmp","appf2-sp35-browser.png");
try {
  await page.goto(origin.origin,{waitUntil:"domcontentloaded",timeout:40_000});
  const input=page.locator("#composer-input");
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: REAL Discover React UI rendered");
  await input.fill("Create a read-only one-screen welcome app titled Hello World. Show the text Hello World. No user input, payments, accounts, or external services.");
  await page.locator(".composer-create").click();
  console.log("STAGING BROWSER: clicked actual Create App button");
  await page.locator(".s03-app").waitFor({state:"visible",timeout:210_000});
  const content=await page.locator(".s03-app").textContent();
  const hasText=Boolean(content?.includes("Hello World"));
  console.log("STAGING BROWSER: generated S03 app mounted; EXPECTED_HELLO_TEXT="+hasText);
  if(!hasText)throw Error("STAGING BROWSER: Generated App visible but requested text not rendered");
  await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole("button",{name:"更多選項"}).click();
  await page.getByRole("menuitem",{name:"回到首頁 / 建立新的 App"}).click();
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: runtime app + home navigation PASS; screenshot saved");

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
  console.log("STAGING COMPLEX ANALYSIS: real 5-feature Prompt A PASS; full 5-feature app NOT VERIFIED.");
} catch(error) {
  await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
  throw Error("STAGING BROWSER: real user journey FAILED ("+String(error?.name||"unknown")+
    "); review browser screenshot and step evidence",{cause:error});
} finally {
  await browser.close();
}
