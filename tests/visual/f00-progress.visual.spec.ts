import { expect, test, type Locator } from "@playwright/test";

import { clarifyingAnalysis } from "../api/f01-harness.js";
import { F01BrowserHost } from "../e2e/support/f01-browser-host.js";
import { composer, createButton } from "../e2e/support/f00-flow.js";

const TEAL_600 = "rgb(15, 118, 110)";
const AQUA_400 = "rgb(45, 212, 191)";
const YELLOW_400 = "rgb(244, 200, 76)";
const SURFACE_50 = "rgb(247, 250, 249)";
const BORDER_200 = "rgb(221, 232, 230)";

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

test("S02 visual: determinate Create progress is a teal-to-aqua meter with a tabular percentage and no yellow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(clarifyingAnalysis());
  await page.goto("/");
  await composer(page).fill("幫我做一個公司聚餐分帳工具");
  await createButton(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  const meter = page.getByRole("progressbar", { name: "建立進度" });
  await expect(meter).toHaveAttribute("aria-valuenow", "28");
  await expect(meter).toHaveAttribute("aria-valuetext", "28%，理解想法");
  await expect(page.locator(".progress-value")).toHaveText("28%");
  expect(await style(page.locator(".progress-value"), "font-variant-numeric")).toBe("tabular-nums");
  expect([await style(meter, "background-color"), await style(meter, "border-top-color")]).toEqual([SURFACE_50, BORDER_200]);

  const fill = meter.locator(".progress-fill");
  const gradient = await style(fill, "background-image");
  expect(gradient).toContain(TEAL_600);
  expect(gradient).toContain(AQUA_400);
  expect(gradient).not.toContain(YELLOW_400);
  const [rail, bar] = await Promise.all([meter.boundingBox(), fill.boundingBox()]);
  if (!rail || !bar) throw new Error("progress meter must be laid out");
  expect(Math.abs(bar.width - (rail.width - 2) * 0.28)).toBeLessThanOrEqual(2);
  await expect(page.locator(".activity-pulse")).toHaveCount(0);
  await testInfo.attach("s02-determinate-progress-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
