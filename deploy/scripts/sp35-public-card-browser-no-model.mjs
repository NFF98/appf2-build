// Offline-cost, browser-real F05 acceptance: production UI + real F01/F02/F03/F05
// components, scripted provider and in-memory DB only. Does NOT claim live staging
// publication or a preexisting CI LifePilot creator's authorisation.
import {createServer as createViteServer} from "vite";
import {chromium,expect} from "@playwright/test";
import {join} from "node:path";

const vite=await createViteServer({root:process.cwd(),configFile:false,
  server:{middlewareMode:true,hmr:false,ws:false},appType:"custom",logLevel:"error"});
let browser,ownerContext,visitorContext,secondContext;
let Host;
try{
  const hostModule=await vite.ssrLoadModule("/tests/e2e/support/s03-worker-host.ts");
  const fixtureModule=await vite.ssrLoadModule("/tests/e2e/support/sp35-published-backend.ts");
  Host=hostModule.S03WorkerHost;
  const origin=hostModule.APP_ORIGIN;
  await Host.prepare();
  const host=await Host.start();
  const fixture=new fixtureModule.PublishedBrowserBackend(host.backend);
  host.setApiOverride(r=>fixture.handle(r));
  browser=await chromium.launch({headless:true});
  ownerContext=await browser.newContext();
  const owner=await ownerContext.newPage();
  await host.attach(owner);
  await owner.goto(origin);
  await owner.getByRole("textbox",{name:"說出你想做的 App"}).fill("幫我做一個可以調整人數的聚餐分帳工具");
  await owner.getByRole("button",{name:"建立 App",exact:true}).click();
  await expect(owner.locator(".s03")).toBeVisible({timeout:30000});
  const value=p=>p.locator(".s03-result-item",{hasText:"每人金額"}).locator("dd");
  const people=p=>p.getByRole("spinbutton",{name:"人數"});
  await expect(value(owner)).toHaveText("30");
  await people(owner).fill("6");
  await expect(value(owner)).toHaveText("20");
  const fixtureModelCalls=fixture.modelCalls();
  if(fixtureModelCalls!==2)throw Error("MODEL: expected scripted F01 analysis+compose only");
  await owner.locator(".s03-header").getByRole("button",{name:"分享",exact:true}).click();
  const dialog=owner.getByRole("dialog",{name:"公開分享這個 App？"});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("個人操作紀錄不會分享");
  await dialog.getByRole("button",{name:"確認公開（不使用 AI）"}).click();
  const link=owner.locator('[aria-label="公開分享連結"]').getByRole("link");
  await expect(link).toBeVisible();
  const publishedUrl=await link.getAttribute("href");
  if(!publishedUrl?.startsWith(origin+"/share/"))throw Error("PUBLISH: no authorized live share URL");
  const list=fixture.activeShares();
  if(list.length!==1)throw Error("PUBLISH: expected one explicit authorized share");
  const shareId=list[0].share_id;

  visitorContext=await browser.newContext();
  const visitor=await visitorContext.newPage();
  await host.attach(visitor);
  await visitor.goto(origin);
  const card=visitor.locator(".saved-app-card",{hasText:"聚餐分帳"}).last();
  await expect(card.getByRole("button",{name:"直接使用（不用 AI）"})).toBeVisible();
  await card.getByRole("button",{name:"直接使用（不用 AI）"}).click();
  await expect(visitor.locator(".s03")).toBeVisible({timeout:30000});
  await expect(value(visitor)).toHaveText("30");
  await expect(people(visitor)).toHaveValue("4");
  await people(visitor).fill("5");
  await expect(value(visitor)).toHaveText("24");
  await visitor.reload();
  await expect(visitor.locator(".s03")).toBeVisible({timeout:30000});
  await expect(people(visitor)).toHaveValue("5");
  await expect(value(visitor)).toHaveText("24");

  secondContext=await browser.newContext();
  const second=await secondContext.newPage();
  await host.attach(second);
  await second.goto(publishedUrl);
  await expect(second.locator(".s03")).toBeVisible({timeout:30000});
  await expect(people(second)).toHaveValue("4");
  await expect(value(second)).toHaveText("30");
  if(fixture.modelCalls()!==fixtureModelCalls)throw Error("NO-AI: a stranger launch re-called model");
  if(host.apiCalls().filter(x=>x.startsWith("POST /api/v1/intents")).length!==2)
    throw Error("NO-AI: a stranger launch re-called F01");
  const screenshot=join(process.env.RUNNER_TEMP??"/tmp","sp35-public-real-browser-fixture.png");
  await visitor.screenshot({path:screenshot,fullPage:true});
  fixture.revoke(shareId);
  await second.reload();
  await expect(second.locator(".app-recovery")).toContainText("先前的 App 無法安全恢復。",{timeout:30000});
  if(fixture.modelCalls()!==fixtureModelCalls)throw Error("NO-AI: revoke retry called model");
  console.log("PUBLIC CARD BROWSER FIXTURE REAL UI PASS: owner consent, stranger card, live F03 change 4->5, 30->24, reload, isolation, revoke, F01 new=0, model new=0");
  console.log("PUBLIC CARD FIXTURE SCREENSHOT "+screenshot);
  console.log("PUBLIC CARD LIMIT: scripted model, in-memory DB. Not live Supabase published share.");
}finally{
  await secondContext?.close().catch(()=>{});
  await visitorContext?.close().catch(()=>{});
  await ownerContext?.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  await Host?.shutdown().catch(()=>{});
  await vite.close();
}
