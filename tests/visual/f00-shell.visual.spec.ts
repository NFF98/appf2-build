import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { clarifyingAnalysis } from "../api/f01-harness.js";
import { F01BrowserHost } from "../e2e/support/f01-browser-host.js";
import { assumptionRow, composer, createButton, sixTypeAnalysis, twoAssumptionAnalysis } from "../e2e/support/f00-flow.js";

const TEAL_600 = "rgb(15, 118, 110)";
const TEAL_500 = "rgb(18, 149, 138)";
const YELLOW_400 = "rgb(244, 200, 76)";
const DANGER_700 = "rgb(185, 28, 28)";
const SURFACE_50 = "rgb(247, 250, 249)";
const TEXT_600 = "rgb(88, 104, 101)";
const DESKTOP = { width: 1280, height: 900 };

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

const style = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

/** Every computed color / background / border color used inside `selector`. */
function usedColors(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluate((root) => {
    const colors = new Set<string>();
    for (const node of [root, ...root.querySelectorAll("*")]) {
      const computed = getComputedStyle(node);
      for (const value of [computed.color, computed.backgroundColor, computed.borderTopColor, computed.backgroundImage]) colors.add(value);
    }
    return [...colors];
  });
}

async function startCreate(page: Page, envelope: Parameters<F01BrowserHost["queueAnalysis"]>[0]): Promise<F01BrowserHost> {
  const host = await F01BrowserHost.attach(page);
  host.queueAnalysis(envelope);
  await page.goto("/");
  await composer(page).fill("幫我做一個公司聚餐分帳工具");
  await createButton(page).click();
  return host;
}

test("S01 visual: prompt-first Creator Canvas uses Design System tokens and no search-engine UI", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  const hero = page.getByRole("heading", { level: 1, name: "意圖就是 App" });
  await expect(hero).toBeVisible();

  expect(await style(hero, "font-family")).toContain("Noto Sans TC");
  expect(parseFloat(await style(hero, "font-size"))).toBeGreaterThanOrEqual(40);
  expect(await style(page.locator(".s01-hero-accent"), "color")).toBe(TEAL_600);
  expect([await style(createButton(page), "background-color"), await style(createButton(page), "color")]).toEqual([TEAL_600, "rgb(255, 255, 255)"]);
  await createButton(page).hover();
  await expect.poll(() => style(createButton(page), "background-color")).toBe(TEAL_500);

  await expect(composer(page)).toHaveAttribute("placeholder", "告訴我你想做什麼…");
  await expect(composer(page)).toHaveValue("");
  const [textColor, ghostColor] = await composer(page).evaluate((node) => [getComputedStyle(node).color, getComputedStyle(node, "::placeholder").color]);
  expect(ghostColor).not.toBe(textColor);
  expect(await style(page.locator(".discover-nav-header .is-active"), "border-bottom-color")).toBe(TEAL_600);

  const [heroBox, composerBox, inspirationBox] = await Promise.all([hero, page.locator(".composer"), page.locator(".inspiration")].map((locator) => locator.boundingBox()));
  if (!heroBox || !composerBox || !inspirationBox) throw new Error("S01 sections must be laid out");
  expect(heroBox.y + heroBox.height).toBeLessThanOrEqual(composerBox.y);
  expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(inspirationBox.y);
  expect(Math.abs(composerBox.x + composerBox.width / 2 - DESKTOP.width / 2)).toBeLessThanOrEqual(2);

  await expect(page.locator('input[type="search"], [role="search"]')).toHaveCount(0);
  await expect(page.getByText(/搜尋|登入|註冊/)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "試試這些靈感" })).toBeVisible();
  await expect(page.locator(".capsule-card").first().getByRole("img")).toBeVisible();
  await attachScreenshot(page, testInfo, "s01-desktop");
});

test("S02 visual: focused workspace shows teal stage progress and no yellow before completion", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await startCreate(page, clarifyingAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "還差一點資訊" })).toBeVisible();

  const current = page.locator(".stage-current");
  await expect(current).toHaveAttribute("aria-current", "step");
  expect(await style(current.locator(".stage-marker"), "border-top-color")).toBe(TEAL_600);
  expect(await style(current, "color")).toBe(TEAL_600);
  expect((await usedColors(page, ".s02")).filter((color) => color.includes(YELLOW_400))).toEqual([]);

  await expect(page.locator(".s02-header").getByRole("button")).toHaveText(["← 回到建立 App"]);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  const primary = page.getByRole("button", { name: "繼續", exact: true });
  expect(await style(primary, "background-color")).toBe(TEAL_600);

  await primary.click();
  const error = page.locator("fieldset.question .field-error");
  await expect(error).toHaveText("請回答這一題");
  expect(await style(error, "color")).toBe(DANGER_700);
  expect(await error.evaluate((node) => getComputedStyle(node, "::before").backgroundImage)).toContain("svg");
  await attachScreenshot(page, testInfo, "s02-clarification-desktop");
});

test("S02 visual: assumption review rows show name, value and a neutral source tag", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  await startCreate(page, twoAssumptionAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "確認幾個設定" })).toBeVisible();

  const row = page.locator("li.assumption", { hasText: "幣別" });
  const [name, value, tag] = await Promise.all([".assumption-name", ".assumption-value", ".source-tag"].map((selector) => row.locator(selector).boundingBox()));
  if (!name || !value || !tag) throw new Error("assumption row parts must be laid out");
  expect(name.x).toBeLessThan(value.x);
  expect(value.x).toBeLessThan(tag.x);
  const tagStyle = [await style(row.locator(".source-tag"), "background-color"), await style(row.locator(".source-tag"), "color")];
  expect(tagStyle.join(" ")).not.toContain(YELLOW_400);
  expect(tagStyle).not.toContain(TEAL_600);
  const actions = page.locator(".workspace-actions .btn");
  await expect(actions).toHaveText(["修改需求", "用這些設定繼續"]);
  expect(await style(actions.nth(1), "background-color")).toBe(TEAL_600);
  await attachScreenshot(page, testInfo, "s02-assumption-review-desktop");
});

test("S02 visual: typed editors are structured controls and disabled controls stay readable without opacity", async ({ page }, testInfo) => {
  await page.setViewportSize(DESKTOP);
  const host = await startCreate(page, sixTypeAnalysis());
  await expect(page.getByRole("heading", { level: 1, name: "確認幾個設定" })).toBeVisible();
  for (const id of ["d_rounding", "e_add_ons", "f_menu"]) await assumptionRow(page, id).getByRole("button", { name: "修改", exact: true }).click();
  await page.getByRole("button", { name: /^菜單的新值 › budget（/ }).click();

  const menu = assumptionRow(page, "f_menu");
  await expect(menu.locator("textarea, [contenteditable]")).toHaveCount(0);
  await expect(menu.getByRole("combobox")).toHaveCount(8);
  await expect(assumptionRow(page, "d_rounding").getByRole("radio")).toHaveCount(3);
  await expect(assumptionRow(page, "e_add_ons").getByRole("checkbox")).toHaveCount(3);
  expect(await style(menu.locator(".node-toggle[aria-expanded='true']"), "color")).toBe(TEAL_600);
  expect(await style(menu.locator(".text-input").first(), "border-top-left-radius")).toBe("12px");
  await attachScreenshot(page, testInfo, "s02-typed-editors-desktop");

  const primary = page.getByRole("button", { name: "用這些設定繼續" });
  await primary.evaluate((node) => node.setAttribute("disabled", ""));
  await expect(primary).toBeDisabled();
  await expect(primary).toHaveCSS("background-color", SURFACE_50);
  await expect(primary).toHaveCSS("color", TEXT_600);
  await expect(primary).toHaveCSS("opacity", "1");
  expect(host.callsTo("/answers")).toEqual([]);
});
