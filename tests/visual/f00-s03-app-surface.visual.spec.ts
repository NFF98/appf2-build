import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { S03SurfaceHarness } from "../e2e/support/s03-surface-harness.js";

const TEAL_600 = "rgb(15, 118, 110)";
const TEAL_50 = "rgb(233, 246, 244)";
const SURFACE_0 = "rgb(255, 255, 255)";
const SURFACE_50 = "rgb(247, 250, 249)";
const TEXT_600 = "rgb(88, 104, 101)";
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("element must be laid out");
  return found;
}

test.afterAll(async () => {
  await S03SurfaceHarness.shutdown();
});

test("S03 visual: the Generated App is the primary content inside minimal Design System chrome", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await S03SurfaceHarness.open(page);
  const header = page.locator(".s03-header");
  const frame = page.locator(".runtime-frame");
  const result = page.locator(".s03-result");
  await expect(page.getByRole("spinbutton", { name: "人數" })).toHaveValue("4");

  expect(await style(page.locator(".s03"), "background-color")).toBe(SURFACE_50);
  expect([await style(header, "background-color"), await style(header, "height")]).toEqual([SURFACE_0, "68px"]);
  expect(await style(page.locator(".s03-title"), "font-family")).toContain("Noto Sans TC");
  const share = header.getByRole("button", { name: "分享" });
  expect([await style(share, "background-color"), await style(share, "color")]).toEqual([TEAL_600, SURFACE_0]);
  expect([await style(frame, "background-color"), await style(frame, "border-top-left-radius")]).toEqual([SURFACE_0, "16px"]);
  expect([await style(result, "background-color"), await style(result, "border-top-left-radius")]).toEqual([SURFACE_0, "16px"]);
  expect(await style(result.locator("dt").first(), "color")).toBe(TEXT_600);

  const [headerBox, frameBox, resultBox] = await Promise.all([box(header), box(frame), box(result)]);
  expect(headerBox.height).toBeLessThan(frameBox.height + resultBox.height);
  expect(frameBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(resultBox.y).toBeGreaterThanOrEqual(frameBox.y + frameBox.height);
  expect(Math.abs(frameBox.x + frameBox.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(2);

  const text = await page.locator(".s03").innerText();
  expect(text).not.toMatch(/[{}]|FIXTURE|fixture|debug|content_hash|sha256:/u);
  await attachScreenshot(page, testInfo, "s03-desktop");
});

test("S03 visual: mobile change sheet and Inspection bar use the surface and accent tokens", async ({ page }, testInfo) => {
  await page.setViewportSize(MOBILE);
  await S03SurfaceHarness.open(page);
  const nav = page.getByRole("navigation", { name: "App 導覽" });
  expect(await style(nav.getByRole("button", { name: "目前 App" }), "color")).toBe(TEAL_600);
  expect(await style(nav.getByRole("button", { name: "分享" }), "color")).toBe(TEXT_600);
  await nav.getByRole("button", { name: "修改" }).click();
  const sheet = page.getByRole("dialog", { name: "你想怎麼改？" });
  await expect(sheet).toBeVisible();
  expect([await style(sheet, "background-color"), await style(sheet, "border-top-left-radius"), await style(sheet, "border-bottom-left-radius")]).toEqual([
    SURFACE_0,
    "20px",
    "0px"
  ]);
  const sheetBox = await box(sheet);
  expect(Math.round(sheetBox.y + sheetBox.height)).toBe(MOBILE.height);
  await attachScreenshot(page, testInfo, "s03-mobile-change-sheet");

  await page.keyboard.press("Escape");
  await S03SurfaceHarness.open(page, { inspection: "PREVIEW" });
  const inspection = page.getByRole("region", { name: "正在查看原版" });
  expect(await style(inspection, "background-color")).toBe(TEAL_50);
  await attachScreenshot(page, testInfo, "s03-mobile-inspection");
});
