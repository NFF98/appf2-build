import { expect, test, type Locator, type Page } from "@playwright/test";

import { S03SurfaceHarness } from "../e2e/support/s03-surface-harness.js";

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

async function expectVisibleTouchTargets(targets: Locator): Promise<void> {
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    expect(Math.round((await box(target)).height)).toBeGreaterThanOrEqual(TOUCH_TARGET);
  }
}

test.afterAll(async () => {
  await S03SurfaceHarness.shutdown();
});

test("S03 desktop layout: change and share actions live in the header, no bottom navigation", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await S03SurfaceHarness.open(page);
  const header = page.locator(".s03-header");
  for (const name of ["修改這個 App", "改成我的版本", "分享"]) await expect(header.getByRole("button", { name })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "App 導覽" })).toBeHidden();
  await expect(header.locator(".brand-name")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectVisibleTouchTargets(page.locator(".s03 button"));
});

test("S03 mobile layout: header keeps only home, title and overflow, actions move to a fixed bottom navigation", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await S03SurfaceHarness.open(page);
  const header = page.locator(".s03-header");
  for (const name of ["修改這個 App", "改成我的版本", "分享"]) await expect(header.getByRole("button", { name })).toBeHidden();
  await expect(header.locator(".brand-name")).toBeHidden();
  await expect(header.getByRole("button", { name: "回到首頁" })).toBeVisible();
  await expect(header.getByRole("button", { name: "更多選項" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "App 導覽" });
  await expect(nav.getByRole("button")).toHaveText(["目前 App", "修改", "分享"]);
  const navBox = await box(nav);
  expect(Math.round(navBox.y + navBox.height)).toBe(MOBILE.height);
  expect(Math.round(navBox.width)).toBe(MOBILE.width);
  await expectVisibleTouchTargets(nav.getByRole("button"));
  await expectVisibleTouchTargets(page.locator(".s03-main button"));
  await expectNoHorizontalScroll(page);

  // The last App control scrolls clear of the fixed navigation instead of hiding beneath it.
  const adjust = page.getByRole("button", { name: "調整結果" });
  await adjust.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const adjustBox = await box(adjust);
  expect(adjustBox.y + adjustBox.height).toBeLessThanOrEqual((await box(nav)).y);
});
