import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { composer, createButton, press } from "./support/f00-flow.js";
import { APP_ORIGIN, S03WorkerHost } from "./support/s03-worker-host.js";

const PROMPT = "幫我做一個朋友聚餐依人數分帳的小工具";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 640;
const s05 = (page: Page): Locator => page.locator(".s05");
const draftInput = (page: Page): Locator => s05(page).getByRole("textbox", { name: "你想怎麼改？" });
const inspection = (page: Page): Locator => page.getByRole("region", { name: "正在查看原版" });
const fullReturn = (page: Page): Locator => inspection(page).getByRole("button", { name: "返回修改畫面", exact: true });
const bottomNav = (page: Page): Locator => page.getByRole("navigation", { name: "App 導覽" });
const shortReturn = (page: Page): Locator => bottomNav(page).getByRole("button", { name: "返回修改", exact: true });
const peopleInput = (page: Page): Locator => page.getByRole("spinbutton", { name: "人數" });
const resultValue = (page: Page): Locator => page.locator(".s03-result-item", { hasText: "每人金額" }).locator("dd");

let host: S03WorkerHost;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(180_000);
  await S03WorkerHost.prepare();
});

test.beforeEach(async ({ page }, testInfo) => {
  host = await S03WorkerHost.start();
  await host.attach(page);
  testInfo.annotations.push({ type: "provenance", description: host.provenance });
});

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach("worker-calls", { body: [...host.apiCalls(), ...host.blocked.map((url) => `BLOCKED ${url}`)].join("\n"), contentType: "text/plain" });
});

test.afterAll(async () => {
  await S03WorkerHost.shutdown();
});

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("element must be laid out");
  return found;
}

/** Opens one path through the normal S03 entry the User sees on this viewport (header on desktop, chooser on mobile). */
async function openPath(page: Page, option: "修改這個 App" | "改成我的版本"): Promise<void> {
  if (isMobile(page)) {
    await bottomNav(page).getByRole("button", { name: "修改", exact: true }).click();
    await page.getByRole("dialog", { name: "你想怎麼改？" }).getByRole("button", { name: option }).click();
  } else {
    await page.locator(".s03-header").getByRole("button", { name: option }).click();
  }
  await expect(s05(page)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: option })).toBeFocused();
}

async function sessionOf(page: Page): Promise<{ id: string | null; path: string | null }> {
  return { id: await s05(page).getAttribute("data-change-session"), path: await s05(page).getAttribute("data-change-path") };
}

/** S03 Inspection Mode: the source App runs as before, the change entries are gone and only the return path is offered. */
async function expectInspection(page: Page): Promise<void> {
  await expect(s05(page)).toHaveCount(0);
  await expect(inspection(page)).toBeVisible();
  await expect(inspection(page).getByText("正在查看原版", { exact: true })).toBeVisible();
  await expect(fullReturn(page)).toBeVisible();
  for (const name of ["修改這個 App", "改成我的版本", "修改"]) await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "返回新版預覽" })).toHaveCount(0);
  await expect(page.locator(".s03-title")).toHaveText("聚餐分帳");
  await expect(page.locator(".s03-main")).toBeFocused();
  if (!isMobile(page)) {
    await expect(bottomNav(page)).toBeHidden();
    return;
  }
  // Mobile: full wording in the context strip above the Runtime, and the short label in the three-slot navigation.
  await expect(bottomNav(page).getByRole("button")).toHaveText(["目前 App", "返回修改", "分享"]);
  await expect(shortReturn(page)).toBeVisible();
  const [strip, cta, main, nav] = await Promise.all([box(inspection(page)), box(fullReturn(page)), box(page.locator(".s03-main")), box(bottomNav(page))]);
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  expect(cta.x).toBeGreaterThanOrEqual(0);
  expect(cta.x + cta.width).toBeLessThanOrEqual(viewport.width);
  expect(Math.round(cta.height)).toBeGreaterThanOrEqual(44);
  expect(strip.y + strip.height).toBeLessThanOrEqual(main.y + 1);
  expect(cta.y + cta.height).toBeLessThanOrEqual(nav.y);
}

test("TEST-F00-037 S05 查看原版 from the Composer keeps the same S05A / S05B session, path and draft through S03 Inspection Mode and returns to it (Preview origin needs an F06 Preview, which this build cannot produce)", async ({
  page
}, testInfo) => {
  // Two paths, each with two or three full Inspection round trips through the real Runtime.
  testInfo.setTimeout(90_000);
  testInfo.annotations.push({
    type: "scope",
    description: "Composer origin only: no F06 child Preview exists in this build, so the Preview origin (返回新版預覽) is not reachable and is not claimed."
  });
  await page.goto(`${APP_ORIGIN}/`);
  await composer(page).fill(PROMPT);
  await createButton(page).click();
  await expect(page.locator(".s03")).toBeVisible({ timeout: 20_000 });
  await expect(resultValue(page)).toHaveText("30");
  await peopleInput(page).fill("6");
  await expect(resultValue(page)).toHaveText("20");
  const settled = { calls: host.calls.length, model: host.backend.modelCalls() };
  const url = page.url();

  const sessions: string[] = [];
  const headcounts = [8, 10, 12, 15, 20, 24];
  let people = 6;
  for (const [option, path, draft] of [
    ["修改這個 App", "S05A", "把結果改成也顯示總金額"],
    ["改成我的版本", "S05B", "改成可以輸入小費比例"]
  ] as const) {
    await openPath(page, option);
    const opened = await sessionOf(page);
    expect(opened.path).toBe(path);
    expect(opened.id).toMatch(UUID);
    expect(sessions).not.toContain(opened.id);
    sessions.push(opened.id as string);
    await expect(s05(page).getByRole("button", { name: "使用新版" })).toHaveCount(0);
    await expect(s05(page).getByRole("button", { name: "使用我的版本" })).toHaveCount(0);
    await draftInput(page).fill(draft);

    // F06 is not part of this build: 「開始修改」 says so in place and keeps the draft; nothing is generated.
    await s05(page).getByRole("button", { name: "開始修改" }).click();
    await expect(s05(page).getByRole("status")).toHaveText("「開始修改」目前還不能使用，你寫的修改內容和原版都還在。");
    await expect(draftInput(page)).toHaveValue(draft);
    await attachScreenshot(page, testInfo, `composer-${path}`);

    // Every return control the viewport offers is used once: full-wording CTA (pointer, then keyboard) and, on mobile, the short nav slot.
    const returns: Locator[] = isMobile(page) ? [fullReturn(page), shortReturn(page), fullReturn(page)] : [fullReturn(page), fullReturn(page)];
    for (const [index, control] of returns.entries()) {
      await s05(page).getByRole("button", { name: "查看原版" }).click();
      await expectInspection(page);
      if (index === 0) await attachScreenshot(page, testInfo, `inspection-${path}`);
      // The source App stays operable: a real local action commits in Inspection Mode.
      people = headcounts.shift() ?? Number.NaN;
      await peopleInput(page).fill(String(people));
      await expect(resultValue(page)).toHaveText(String(120 / people));
      if (index === returns.length - 1) await press(control, "Enter");
      else await control.click();
      await expect(page.getByRole("heading", { level: 1, name: option })).toBeFocused();
      expect(await sessionOf(page)).toEqual(opened);
      await expect(draftInput(page)).toHaveValue(draft);
    }

    // 回原 App ends this session; the original App, its result and normal change entries are back unchanged.
    await s05(page).getByRole("button", { name: "回原 App" }).click();
    await expect(s05(page)).toHaveCount(0);
    await expect(inspection(page)).toHaveCount(0);
    await expect(page.locator(".s03-title")).toHaveText("聚餐分帳");
    await expect(peopleInput(page)).toHaveValue(String(people));
    await expect(resultValue(page)).toHaveText(String(120 / people));
  }

  expect(sessions).toHaveLength(2);
  expect(page.url()).toBe(url);
  expect({ calls: host.calls.length, model: host.backend.modelCalls() }).toEqual(settled);
  expect(host.blocked).toEqual([]);
});
