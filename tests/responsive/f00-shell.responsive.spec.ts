import { expect, test, type Locator, type Page } from "@playwright/test";

import { clarifyingAnalysis } from "../api/f01-harness.js";
import { F01BrowserHost } from "../e2e/support/f01-browser-host.js";
import { assumptionRow, composer, createButton, fourQuestionAnalysis, sixTypeAnalysis } from "../e2e/support/f00-flow.js";

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
    expect(Math.round(size.height)).toBeGreaterThanOrEqual(TOUCH_TARGET);
  }
}

async function startCreate(page: Page, envelope: Parameters<F01BrowserHost["queueAnalysis"]>[0]): Promise<void> {
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(envelope);
  await page.goto("/");
  await composer(page).fill("幫我做一個公司聚餐分帳工具");
  await createButton(page).click();
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
  const composerBox = await box(page.locator(".composer"));
  expect(composerBox.height).toBeGreaterThanOrEqual(180);
  expect(composerBox.height).toBeLessThanOrEqual(240);

  await composer(page).fill(Array.from({ length: 30 }, (_, line) => `第 ${line + 1} 行需求`).join("\n"));
  const grown = await box(page.locator(".composer"));
  expect(grown.height).toBeGreaterThanOrEqual(320);
  expect(grown.height).toBeLessThanOrEqual(360);
  expect(await composer(page).evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
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
  const create = await box(createButton(page));
  expect(create.width).toBeGreaterThan(MOBILE.width * 0.7);

  await expectTouchTargets(page.locator(".s01 button"));
  await expectNoHorizontalScroll(page);

  await page.getByRole("button", { name: "試試看：旅遊行程規劃" }).click();
  await expect(composer(page)).toBeInViewport();
  const lastCard = cards.last();
  await lastCard.scrollIntoViewIfNeeded();
  const last = await box(lastCard.getByRole("button"));
  expect(last.y + last.height).toBeLessThanOrEqual((await box(bottom)).y + 1);
});

test("S02 mobile clarification: focused header, compact stages and the CTA never covers the last question", async ({ page }, testInfo) => {
  await page.setViewportSize(MOBILE);
  await startCreate(page, fourQuestionAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator(".stage-label-short")).toHaveText(["理解", "整理", "檢查", "準備"]);
  await expect(page.locator(".stage-label-full").first()).toBeHidden();
  const header = await box(page.locator(".s02-header"));
  expect(header.height).toBe(60);

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

test("S02 mobile typed editors: nested RECORD editing fits the viewport with touch-sized controls", async ({ page }, testInfo) => {
  await page.setViewportSize(MOBILE);
  await startCreate(page, sixTypeAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "確認幾個設定" })).toBeVisible();
  const menu = assumptionRow(page, "f_menu");
  await menu.getByRole("button", { name: "修改", exact: true }).click();
  await page.getByRole("button", { name: /^菜單的新值 › budget（/ }).click();
  await page.getByRole("button", { name: /^菜單的新值 › extras（/ }).click();

  await expectTouchTargets(menu.locator("button, input[type='text'], select"));
  const menuBox = await box(menu);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(MOBILE.width);
  await expectNoHorizontalScroll(page);
  await testInfo.attach("s02-mobile-typed-editors", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});

test("S02 desktop layout: one focused content column within the approved width", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await startCreate(page, clarifyingAnalysis());
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
