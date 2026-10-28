import {expect,test,type Page} from "@playwright/test";
import {composer,createButton} from "./support/f00-flow.js";
import {APP_ORIGIN,S03WorkerHost} from "./support/s03-worker-host.js";
import {PublishedBrowserBackend} from "./support/sp35-published-backend.js";

let backend:PublishedBrowserBackend;
test.beforeAll(async()=>{await S03WorkerHost.prepare();});
test.beforeEach(async({page},info)=>{
  backend=await PublishedBrowserBackend.create();
  await backend.host.attach(page);
  info.annotations.push({type:"provenance",description:
    "Real browser/F01/F02/F03/F05 server code, scripted 0-cost model + in-memory DB fixture (NOT real staging DB or live provider)"});
});
test.afterAll(async()=>{await S03WorkerHost.shutdown();});

const people=(p:Page)=>p.getByRole("spinbutton",{name:"人數"});
const result=(p:Page)=>p.locator(".s03-result-item",{hasText:"每人金額"}).locator("dd");

/** This is *not* the CI LifePilot/moving private owner context. New fixture owner consents in UI. */
test("F05 stranger chooses genuinely published card, operates and reloads; owner state isolated; zero new AI",async({page,browser},info)=>{
  await page.goto(APP_ORIGIN);
  await composer(page).fill("請做一個可以計算家庭聚餐分帳金額的工具");
  await createButton(page).click();
  await expect(page.locator(".s03")).toBeVisible({timeout:25000});
  await expect(result(page)).toHaveText("30");
  await people(page).fill("6");
  await expect(result(page)).toHaveText("20");

  const generatedCalls=backend.modelCalls();
  expect(generatedCalls).toBe(2); // scripted Prompt A + B. NOT paid provider.
  await page.locator(".s03-header").getByRole("button",{name:"分享",exact:true}).click();
  const modal=page.getByRole("dialog",{name:"公開分享這個 App？"});
  await expect(modal).toContainText("個人操作紀錄不會分享");
  await modal.getByRole("button",{name:"確認公開（不使用 AI）"}).click();
  const link=page.getByRole("region",{name:"公開分享連結"}).getByRole("link");
  await expect(link).toBeVisible();
  const url=await link.getAttribute("href");
  expect(url).toMatch(/^https:\/\/appf2\.test\/share\/[0-9a-f-]{36}$/u);
  expect(backend.activeShares()).toHaveLength(1);
  const share=backend.activeShares()[0]!.share_id;
  await info.attach("creator-published",{body:JSON.stringify({share_id:share,zero_paid_provider_calls:true}),contentType:"application/json"});

  // Stranger has a different cookie jar, keys, localStorage and sessionStorage.
  const stranger=await browser.newContext();
  const recipient=await stranger.newPage();
  await backend.host.attach(recipient);
  await recipient.goto(APP_ORIGIN);
  await expect(recipient.getByRole("heading",{name:"公開現成 App"})).toBeVisible();
  // App title is the canonical scripted F03 title, not the user prompt or a placeholder.
  const realCard=recipient.locator(".saved-app-card",{hasText:"聚餐分帳"}).last();
  await expect(realCard.getByRole("button",{name:"直接使用（不用 AI）"})).toBeVisible();
  await realCard.getByRole("button",{name:"直接使用（不用 AI）"}).click();
  await expect(recipient.locator(".s03")).toBeVisible({timeout:20000});
  await expect(result(recipient)).toHaveText("30");
  await expect(people(recipient)).toHaveValue("4");
  await people(recipient).fill("5");
  await expect(result(recipient)).toHaveText("24");
  await recipient.reload();
  await expect(recipient.locator(".s03")).toBeVisible({timeout:20000});
  await expect(people(recipient)).toHaveValue("5");
  await expect(result(recipient)).toHaveText("24");
  expect(backend.modelCalls()).toBe(generatedCalls);
  expect(backend.apiCalls().filter(c=>c.startsWith("POST /api/v1/intents"))).toHaveLength(2);

  // A second recipient cannot see or modify the first recipient's private state.
  const stranger2=await browser.newContext();
  const fresh=await stranger2.newPage();
  await backend.host.attach(fresh);
  await fresh.goto(url!);
  await expect(fresh.locator(".s03")).toBeVisible({timeout:20000});
  await expect(people(fresh)).toHaveValue("4");
  await expect(result(fresh)).toHaveText("30");
  expect(backend.modelCalls()).toBe(generatedCalls);
  await info.attach("stranger-real-app",{body:await recipient.screenshot({fullPage:true}),contentType:"image/png"});

  backend.revoke(share);
  await fresh.reload();
  await expect(fresh.locator(".app-recovery")).toContainText("先前的 App 無法安全恢復。");
  expect(backend.modelCalls()).toBe(generatedCalls);
  await stranger.close();
  await stranger2.close();
});