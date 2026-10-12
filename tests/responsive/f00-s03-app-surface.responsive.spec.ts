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

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  await S03SurfaceHarness.prepare();
});

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

test("S03 Inspection at narrow widths: the context strip keeps the full return wording beside the short navigation slot, and both return", async ({ page }) => {
  for (const [origin, full, short] of [
    ["COMPOSER", "返回修改畫面", "返回修改"],
    ["PREVIEW", "返回新版預覽", "返回預覽"]
  ] as const) {
    await page.setViewportSize(DESKTOP);
    await S03SurfaceHarness.open(page, { inspection: origin });
    const strip = page.getByRole("region", { name: "正在查看原版" });
    const cta = strip.getByRole("button", { name: full, exact: true });
    const nav = page.getByRole("navigation", { name: "App 導覽" });
    await expect(cta).toBeVisible();
    await expect(nav).toBeHidden();
    const [desktopStrip, desktopCta] = await Promise.all([box(strip), box(cta)]);
    expect(Math.round(desktopCta.y + desktopCta.height)).toBeLessThanOrEqual(Math.round(desktopStrip.y + desktopStrip.height));

    for (const width of [MOBILE.width, 360, 320]) {
      await page.setViewportSize({ width, height: MOBILE.height });
      await expect(cta).toBeVisible();
      await expect(nav.getByRole("button")).toHaveText(["目前 App", short, "分享"]);
      const [stripBox, ctaBox, headerBox, mainBox, navBox] = await Promise.all([
        box(strip),
        box(cta),
        box(page.locator(".s03-header")),
        box(page.locator(".s03-main")),
        box(nav)
      ]);
      expect(ctaBox.x).toBeGreaterThanOrEqual(0);
      expect(ctaBox.x + ctaBox.width).toBeLessThanOrEqual(width);
      expect(Math.round(ctaBox.height)).toBeGreaterThanOrEqual(TOUCH_TARGET);
      expect(await cta.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(stripBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
      expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(mainBox.y + 1);
      expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(navBox.y);
      await expectVisibleTouchTargets(nav.getByRole("button"));
      await expectNoHorizontalScroll(page);
    }

    await cta.focus();
    await page.keyboard.press("Enter");
    await nav.getByRole("button", { name: short, exact: true }).click();
    expect(await S03SurfaceHarness.record(page)).toEqual({ entries: [], returns: 2, homes: 0 });
  }
});
