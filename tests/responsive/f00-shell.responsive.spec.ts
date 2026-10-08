import { expect, test, type Locator, type Page } from "@playwright/test";

import { clarifyingAnalysis } from "../api/f01-harness.js";
import { llmProposal } from "../contract/intent-envelope-fixtures.js";
import { F01BrowserHost } from "../e2e/support/f01-browser-host.js";

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };
const TOUCH_TARGET = 44;

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("element must be laid out");
  return found;
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const [scrollWidth, innerWidth] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
}

async function expectTouchTargets(targets: Locator): Promise<void> {
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    const size = await box(target);
    expect(size.height, await target.innerText()).toBeGreaterThanOrEqual(TOUCH_TARGET);
  }
}

function fourQuestionAnalysis(): ReturnType<typeof clarifyingAnalysis> {
  const base = clarifyingAnalysis();
  const required = (id: string) => llmProposal({ id, required_for_execution: true, can_default: false, expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 1 });
  return { ...base, missing_fields: [...base.missing_fields, required("budget"), required("days"), required("rounds")] };
}

test("S01 desktop layout: header navigation, three capsule columns, no bottom navigation", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const header = page.getByRole("navigation", { name: "主要導覽", exact: true });
  await expect(header.getByRole("listitem")).toHaveText(["首頁", "探索靈感", "我的 AppSoon"]);
  await expect(page.getByRole("navigation", { name: "主要導覽（底部）" })).toBeHidden();

  const cards = page.locator(".capsule-card");
  await expect(cards).toHaveCount(3);
  const [first, second, third] = await Promise.all([box(cards.nth(0)), box(cards.nth(1)), box(cards.nth(2))]);
  expect(new Set([first.y, second.y, third.y]).size).toBe(1);
  expect(first.x).toBeLessThan(second.x);
  expect(second.x).toBeLessThan(third.x);
  const composer = await box(page.locator(".composer"));
  expect(composer.height).toBeGreaterThanOrEqual(180);
  expect(composer.height).toBeLessThanOrEqual(240);
  await expectNoHorizontalScroll(page);
});

test("S01 mobile layout: bottom navigation, single column, touch-sized targets and no horizontal scroll", async ({ page }, testInfo) => {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await testInfo.attach("s01-mobile", { body: await page.screenshot(), contentType: "image/png" });
  await expect(page.getByRole("navigation", { name: "主要導覽", exact: true })).toBeHidden();
  const bottom = page.getByRole("navigation", { name: "主要導覽（底部）" });
  await expect(bottom.getByRole("listitem")).toHaveText(["首頁", "探索靈感", "我的 AppSoon"]);
  const nav = await box(bottom);
  expect(Math.round(nav.y + nav.height)).toBe(MOBILE.height);
  await expect(bottom.getByRole("button", { name: /建立/ })).toHaveCount(0);

  const cards = page.locator(".capsule-card");
  const [first, second] = await Promise.all([box(cards.nth(0)), box(cards.nth(1))]);
  expect(first.x).toBe(second.x);
  expect(second.y).toBeGreaterThan(first.y + first.height - 1);
  const create = await box(page.getByRole("button", { name: "建立 App", exact: true }));
  expect(create.width).toBeGreaterThan(MOBILE.width * 0.7);

  await expectTouchTargets(page.locator(".s01 button"));
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "試試看：旅遊行程規劃" }).click();
  await expect(page.getByRole("textbox", { name: "說出你想做的 App" })).toBeInViewport();
  const lastCard = cards.last();
  await lastCard.scrollIntoViewIfNeeded();
  const last = await box(lastCard.getByRole("button"));
  expect(last.y + last.height).toBeLessThanOrEqual((await box(bottom)).y + 1);
});

test("S02 mobile clarification: focused header, compact stages and the CTA never covers the last question", async ({ page }, testInfo) => {
  await page.setViewportSize(MOBILE);
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(fourQuestionAnalysis());
  await page.goto("/");
  await page.getByRole("textbox", { name: "說出你想做的 App" }).fill("幫我做一個公司聚餐分帳工具");
  await page.getByRole("button", { name: "建立 App", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator(".stage-label-short")).toHaveText(["理解", "整理", "檢查", "準備"]);
  await expect(page.locator(".stage-label-full").first()).toBeHidden();

  const questions = page.locator("fieldset.question");
  await expect(questions).toHaveCount(3);
  const cta = page.getByRole("button", { name: "繼續", exact: true });
  await cta.scrollIntoViewIfNeeded();
  const lastQuestion = await box(questions.last());
  const ctaBox = await box(cta);
  expect(ctaBox.y).toBeGreaterThanOrEqual(lastQuestion.y + lastQuestion.height);
  expect(ctaBox.height).toBeGreaterThanOrEqual(TOUCH_TARGET);
  expect(ctaBox.width).toBeGreaterThan(MOBILE.width * 0.7);
  await expectTouchTargets(page.locator(".s02 button"));
  await expectNoHorizontalScroll(page);
  await testInfo.attach("s02-mobile-clarification", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("S02 desktop layout: one focused content column within the approved width", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(clarifyingAnalysis());
  await page.goto("/");
  await page.getByRole("textbox", { name: "說出你想做的 App" }).fill("幫我做一個公司聚餐分帳工具");
  await page.getByRole("button", { name: "建立 App", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  const main = await box(page.locator(".s02-main"));
  expect(main.width).toBeGreaterThanOrEqual(760);
  expect(main.width).toBeLessThanOrEqual(840);
  expect(Math.abs(main.x + main.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(2);
  await expect(page.locator(".stage-label-full")).toHaveText(["理解想法", "整理 App", "檢查互動", "準備 App"]);
  const header = await box(page.locator(".s02-header"));
  expect(header.height).toBeGreaterThanOrEqual(64);
  expect(header.height).toBeLessThanOrEqual(72);
  await expectNoHorizontalScroll(page);
});
