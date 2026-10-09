import { expect, test } from "@playwright/test";

import { ANON, clarifyingAnalysis, failedWith, readyAnalysis } from "../api/f01-harness.js";
import { isAnswers, isCompile, isCreate } from "./support/f01-browser-host.js";
import {
  assumptionRow,
  assumptionsOf,
  composer,
  createButton,
  expectBuildValidated,
  fourQuestionAnalysis,
  openDiscover,
  questionsOf,
  RECOVERY_TITLE,
  responseData,
  stageList,
  startCreate,
  workspaceHeading
} from "./support/f00-flow.js";

test("TEST-F00-001 a blank prompt never submits; a typed prompt actually enters F01 creation", async ({ page }) => {
  const host = await openDiscover(page);
  await createButton(page).click();
  await expect(page.getByRole("alert")).toHaveText("請先說說你想做什麼 App");
  await expect(composer(page)).toBeFocused();
  await composer(page).fill("   ");
  await createButton(page).click();
  expect(host.calls).toEqual([]);

  host.queueAnalysis(readyAnalysis()).queueValidBlueprint();
  await startCreate(page, "幫我做一個公司聚餐分帳工具");
  await expectBuildValidated(page);
  const [create] = host.callsTo("/api/v1/intents");
  expect(create?.body).toEqual({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: "幫我做一個公司聚餐分帳工具", source: { type: "DIRECT_PROMPT", capsule_id: null } });
  expect(create?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(host.calls.map((call) => [call.path.split("/").at(-1), call.status])).toEqual([
    ["intents", 200],
    ["compile", 200]
  ]);
  expect(responseData(host.callsTo("/compile")[0]).status).toBe("VALIDATED");
});

test("TEST-F00-AC-002 a capsule prefill stays editable and the edited text of the User is what F01 receives", async ({ page }) => {
  const host = await openDiscover(page);
  await page.getByRole("button", { name: "試試看：預算試算" }).click();
  const prefill = "幫我做一個每月預算試算 App：輸入收入和各類支出，算出剩餘金額和各類別占比。";
  await expect(composer(page)).toHaveValue(prefill);
  await expect(composer(page)).toBeEditable();
  await expect(composer(page)).toBeFocused();

  const edited = "幫我做一個兩人共用的每月預算試算 App，支出要分成固定和變動兩類。";
  await composer(page).fill(edited);
  await page.getByRole("button", { name: "試試看：習慣追蹤" }).click();
  await expect(composer(page)).toHaveValue(/習慣追蹤 App/);
  await composer(page).fill(edited);

  host.queueAnalysis(readyAnalysis()).queueValidBlueprint();
  await createButton(page).click();
  await expectBuildValidated(page);
  const [create] = host.callsTo("/api/v1/intents");
  expect(create?.body.raw_intent).toBe(edited);
  expect(JSON.stringify(create?.body)).not.toContain("每月預算試算 App：輸入收入");
  await page.getByRole("button", { name: "查看需求" }).click();
  await expect(page.locator("#intent-panel")).toContainText(edited);
});

test("TEST-F00-003 a clear intent takes the fast path straight into building without any confirmation step", async ({ page }) => {
  const host = await openDiscover(page);
  const release = host.holdNext(isCompile);
  host.queueAnalysis(readyAnalysis()).queueValidBlueprint();
  await startCreate(page, "幫我做一個公司聚餐分帳工具，輸入人數算每人應付");

  await expect(workspaceHeading(page)).toHaveText("正在把需求變成 App");
  await expect(stageList(page).nth(0)).toContainText("已完成");
  await expect(stageList(page).nth(1)).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("button", { name: /繼續|確認|用這些設定繼續/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看需求" })).toBeVisible();
  release();

  await expectBuildValidated(page);
  const create = host.callsTo("/api/v1/intents")[0];
  expect(responseData(create)).toMatchObject({ status: "READY", questions: [] });
  expect(assumptionsOf(create).map((entry) => entry.classification)).toEqual(["FACT"]);
  expect(host.callsTo("/answers")).toEqual([]);
  expect(host.callsTo("/compile")[0]?.body).toEqual({ intent_version: responseData(create).intent_version });
});

test("TEST-F00-004 each round renders only the F01-selected questions (at most three) and validates before sending", async ({ page }) => {
  const host = await openDiscover(page);
  host.queueAnalysis(fourQuestionAnalysis());
  await startCreate(page, "幫我做一個公司聚餐分帳工具");
  await expect(workspaceHeading(page)).toHaveText("還差一點資訊");

  const create = host.callsTo("/api/v1/intents")[0];
  const firstRound = questionsOf(create);
  expect(firstRound).toHaveLength(3);
  const fieldsets = page.locator("fieldset.question");
  await expect(fieldsets).toHaveCount(3);
  expect(await fieldsets.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-question-id")))).toEqual(firstRound.map((question) => question.question_id));
  for (const [index, question] of firstRound.entries()) await expect(fieldsets.nth(index).locator("legend")).toContainText(question.prompt);
  await expect(page.getByText(/第\s*\d\s*輪/)).toHaveCount(0);

  const asked = new Set(firstRound.flatMap((question) => question.semantic_item_ids));
  for (const assumption of assumptionsOf(create).filter((entry) => asked.has(entry.assumption_id))) {
    const row = assumptionRow(page, assumption.assumption_id);
    await expect(row).toContainText("請在上方的問題中決定這一項");
    await expect(row.getByRole("button")).toHaveCount(0);
  }

  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect(fieldsets.locator(".field-error")).toHaveText(["請回答這一題", "請回答這一題", "請回答這一題"]);
  await fieldsets.nth(0).getByRole("textbox").fill("六個人");
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect(fieldsets.nth(0).locator(".field-error")).toHaveText("請輸入有效的數字");
  await expect(fieldsets.nth(0).getByRole("textbox")).toHaveAccessibleDescription("請輸入有效的數字");
  expect(host.callsTo("/answers")).toEqual([]);

  for (const [index, value] of ["6", "2500", "2"].entries()) await fieldsets.nth(index).getByRole("textbox").fill(value);
  await page.getByRole("button", { name: "繼續", exact: true }).click();

  await expect(fieldsets).toHaveCount(1);
  const firstAnswers = host.callsTo("/answers")[0];
  expect(firstAnswers?.body.answers).toEqual(firstRound.map((question, index) => ({ question_id: question.question_id, value: [6, 2500, 2][index] })));
  const secondRound = questionsOf(firstAnswers);
  expect(secondRound).toHaveLength(1);
  await expect(fieldsets.first()).toHaveAttribute("data-question-id", secondRound[0]?.question_id ?? "");
  await page.getByText("已提供的資訊").click();
  await expect(page.locator(".provided-item dd")).toHaveText(["6", "2500", "2"]);

  host.queueValidBlueprint();
  await fieldsets.first().getByRole("textbox").fill("4");
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expectBuildValidated(page);
  expect(host.callsTo("/answers").map((call) => call.status)).toEqual([200, 200]);
});

test("TEST-F00-006 prompt and answers survive recoverable failures and Retry repeats the same logical operation", async ({ page }) => {
  const host = await openDiscover(page);
  const prompt = "幫我做一個公司聚餐分帳工具，人數之後再告訴你";
  host.queueAnalysis(clarifyingAnalysis());
  await startCreate(page, prompt);
  await expect(workspaceHeading(page)).toHaveText("還差一點資訊");

  host.dropNext(isAnswers);
  await page.locator("fieldset.question").first().getByRole("textbox").fill("8");
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
  await expect(page.getByRole("region", { name: "你剛才填寫的內容" }).locator(".provided-item > dd")).toHaveText(["8"]);
  await page.getByRole("button", { name: "查看／修改需求" }).click();
  await expect(page.locator("#intent-panel")).toContainText(prompt);
  await page.getByRole("button", { name: "查看／修改需求" }).click();

  await page.getByRole("button", { name: "回去修改" }).click();
  await expect(workspaceHeading(page)).toHaveText("還差一點資訊");
  await expect(page.locator("fieldset.question").first().getByRole("textbox")).toHaveValue("8");
  host.harness.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
  const [dropped, delivered] = host.callsTo("/answers");
  expect(dropped?.status).toBeNull();
  expect(delivered?.status).toBe(200);
  expect(delivered?.idempotencyKey).toBe(dropped?.idempotencyKey);
  expect(delivered?.body).toEqual(dropped?.body);
  const [failedCompile] = host.callsTo("/compile");
  expect(failedCompile?.status).toBe(502);
  expect(failedCompile?.response?.error).toMatchObject({ code: "F01-ERR-006", retryable: true });
  await expect(stageList(page).nth(0)).toContainText("已完成");

  host.queueValidBlueprint();
  host.harness.clock.advance(1_000);
  await page.getByRole("button", { name: "再試一次" }).click();
  await expectBuildValidated(page);
  const compiles = host.callsTo("/compile");
  expect(compiles.map((call) => call.status)).toEqual([502, 200]);
  expect(compiles[1]?.idempotencyKey).toBe(compiles[0]?.idempotencyKey);
  expect(host.callsTo("/api/v1/intents")).toHaveLength(1);
  await page.getByRole("button", { name: "查看需求" }).click();
  await expect(page.locator("#intent-panel")).toContainText(prompt);
});

test("TEST-F00-038 Try on a capsule only prefills the editable composer and Create goes through F01 Create, never a restore", async ({ page }) => {
  const host = await openDiscover(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/")) requests.push(`${request.method()} ${path}`);
  });
  const card = page.getByRole("article", { name: "聚餐分帳" });
  await page.getByRole("button", { name: "生活" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "全部" }).click();
  await page.getByRole("button", { name: "探索更多" }).click();
  await expect(card.getByRole("img", { name: "聚餐分帳 App 預覽" })).toBeVisible();
  await card.getByRole("button", { name: "試試看：聚餐分帳" }).click();

  const prefill = "幫我做一個聚餐分帳 App：輸入總金額、人數和服務費比例，算出每個人應付多少。";
  await expect(composer(page)).toHaveValue(prefill);
  await expect(page.getByRole("heading", { level: 1, name: "意圖就是 App" })).toBeVisible();
  expect(requests).toEqual([]);
  expect(page.url()).toMatch(/\/$/);

  await composer(page).press("End");
  await composer(page).pressSequentially("服務費 10%。");
  host.queueAnalysis(readyAnalysis()).queueValidBlueprint();
  await createButton(page).click();
  await expectBuildValidated(page);
  expect(requests).toEqual(["POST /api/v1/intents", expect.stringMatching(/^POST \/api\/v1\/intents\/[^/]+\/compile$/)]);
  const [create] = host.calls;
  expect(isCreate(create?.path ?? "")).toBe(true);
  expect(create?.body).toEqual({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: `${prefill}服務費 10%。` });
  expect(create?.body).not.toHaveProperty("context");
  expect(responseData(create).status).toBe("READY");
});
