import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { clarifyingAnalysis, readyAnalysis } from "../api/f01-harness.js";
import { llmProposal, nffDefault } from "../contract/intent-envelope-fixtures.js";
import { F01BrowserHost } from "../e2e/support/f01-browser-host.js";

const TEAL_600 = "rgb(15, 118, 110)";
const YELLOW_400 = "rgb(244, 200, 76)";
const DESKTOP = { width: 1280, height: 900 };

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

/** Every computed color / background / border color used inside `selector`. */
function usedColors(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((root) => {
    const colors = new Set<string>();
    for (const node of [root, ...root.querySelectorAll("*")]) {
      const style = getComputedStyle(node);
      for (const value of [style.color, style.backgroundColor, style.borderTopColor, style.backgroundImage]) colors.add(value);
    }
    return [...colors];
  });
}

async function startCreate(page: Page, envelope: Parameters<F01BrowserHost["queueAnalysis"]>[0]): Promise<void> {
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(envelope);
  await page.goto("/");
  await page.getByRole("textbox", { name: "說出你想做的 App" }).fill("幫我做一個公司聚餐分帳工具");
  await page.getByRole("button", { name: "建立 App", exact: true }).click();
}

test("S01 visual: prompt-first Creator Canvas uses Design System tokens and no search-engine UI", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const hero = page.getByRole("heading", { level: 1, name: "意圖就是 App" });
  const input = page.getByRole("textbox", { name: "說出你想做的 App" });
  const create = page.getByRole("button", { name: "建立 App", exact: true });
  await expect(hero).toBeVisible();

  expect(await hero.evaluate((node) => getComputedStyle(node).fontFamily)).toContain("Noto Sans TC");
  expect(parseFloat(await hero.evaluate((node) => getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(40);
  expect(await page.locator(".s01-hero-accent").evaluate((node) => getComputedStyle(node).color)).toBe(TEAL_600);
  expect(await create.evaluate((node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color])).toEqual([TEAL_600, "rgb(255, 255, 255)"]);

  await expect(input).toHaveAttribute("placeholder", "告訴我你想做什麼…");
  await expect(input).toHaveValue("");
  const [textColor, ghostColor] = await input.evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node, "::placeholder").color]);
  expect(ghostColor).not.toBe(textColor);

  const heroBox = await hero.boundingBox();
  const composerBox = await page.locator(".composer").boundingBox();
  const inspirationBox = await page.locator(".inspiration").boundingBox();
  if (heroBox === null || composerBox === null || inspirationBox === null) throw new Error("S01 sections must be laid out");
  expect(heroBox.y + heroBox.height).toBeLessThanOrEqual(composerBox.y);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(inspirationBox.y);
  expect(Math.abs(composerBox.x + composerBox.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(2);

  await expect(page.locator('input[type="search"], [role="search"]')).toHaveCount(0);
  await expect(page.getByText(/搜尋|登入|註冊/)).toHaveCount(0);
  await expect(page.locator(".capsule-card").first().getByRole("img")).toBeVisible();
  await attachScreenshot(page, testInfo, "s01-desktop");
});

test("S02 visual: focused workspace shows teal stage progress and no yellow before completion", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await startCreate(page, clarifyingAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  const current = page.locator(".stage-current");
  await expect(current).toHaveAttribute("aria-current", "step");
  expect(await current.locator(".stage-marker").evaluate((node) => getComputedStyle(node).borderTopColor)).toBe(TEAL_600);
  expect(await current.evaluate((node) => getComputedStyle(node).color)).toBe(TEAL_600);
  expect((await usedColors(page, ".s02")).filter((color) => color.includes(YELLOW_400))).toEqual([]);

  await expect(page.locator(".s02-header").getByRole("button")).toHaveText(["← 回到建立 App"]);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const primary = page.getByRole("button", { name: "繼續", exact: true });
  expect(await primary.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(TEAL_600);
  await attachScreenshot(page, testInfo, "s02-clarification-desktop");
});

test("S02 visual: assumption review rows show name, value and a neutral source tag", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await startCreate(page, {
    ...readyAnalysis(),
    assumptions: [nffDefault({ id: "currency", description: "幣別", proposed_default: "TWD" }), llmProposal({ id: "tip_rate", description: "小費比例", expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 10 })]
  });
  await expect(page.getByRole("heading", { level: 1, name: "確認幾個設定" })).toBeVisible();

  const row = page.locator("li.assumption", { hasText: "幣別" });
  const [name, value, tag] = await Promise.all([".assumption-name", ".assumption-value", ".source-tag"].map((selector) => row.locator(selector).boundingBox()));
  if (name === undefined || value === undefined || tag === undefined || name === null || value === null || tag === null) throw new Error("assumption row parts must be laid out");
  expect(name.x).toBeLessThan(value.x);
  expect(value.x).toBeLessThan(tag.x);
  const tagStyle = await row.locator(".source-tag").evaluate((node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node).color]);
  expect(tagStyle.join(" ")).not.toContain(YELLOW_400);
  expect(tagStyle).not.toContain(TEAL_600);
  const actions = page.locator(".workspace-actions .btn");
  await expect(actions).toHaveText(["修改需求", "用這些設定繼續"]);
  expect(await actions.nth(1).evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(TEAL_600);
  await attachScreenshot(page, testInfo, "s02-assumption-review-desktop");
});
