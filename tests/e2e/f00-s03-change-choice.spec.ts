import { expect, test, type Locator, type Page } from "@playwright/test";

import { S03SurfaceHarness } from "./support/s03-surface-harness.js";

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 640;
const bottomNav = (page: Page): Locator => page.getByRole("navigation", { name: "App 導覽" });
const header = (page: Page): Locator => page.locator(".s03-header");
const changeSheet = (page: Page): Locator => page.getByRole("dialog", { name: "你想怎麼改？" });
const resultValue = (page: Page): Locator => page.locator(".s03-result-item", { hasText: "每人金額" }).locator("dd");
const contentHash = (page: Page): Promise<string | null> => page.locator("body").getAttribute("data-content-hash");

test.afterAll(async () => {
  await S03SurfaceHarness.shutdown();
});

/** Mobile: the 「修改」 launcher alone selects nothing; the User must pick one of the two explicit options. */
async function chooseOnMobile(page: Page, option: "修改這個 App" | "改成我的版本"): Promise<void> {
  const trigger = bottomNav(page).getByRole("button", { name: "修改", exact: true });
  const before = (await S03SurfaceHarness.record(page)).entries;
  await trigger.click();
  await expect(changeSheet(page)).toBeVisible();
  await expect(changeSheet(page).getByRole("button", { name: "修改這個 App" })).toBeFocused();
  await expect(page.locator(".s03-main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(changeSheet(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await changeSheet(page).getByRole("button", { name: "取消" }).click();
  expect((await S03SurfaceHarness.record(page)).entries).toEqual(before);
  await trigger.click();
  await changeSheet(page).getByRole("button", { name: option }).click();
  await expect(changeSheet(page)).toHaveCount(0);
}

test("TEST-F00-036 S03 routes 修改這個 App → S05A/REFINE and 改成我的版本 → S05B/REMIX only by explicit User choice, never from source metadata", async ({ page }) => {
  const routes: Record<string, unknown> = {};
  const hashes: string[] = [];
  for (const variant of ["ORIGINAL", "SHARED_SOURCE"] as const) {
    await S03SurfaceHarness.open(page, { variant });
    await expect(page.locator("body")).toHaveAttribute("data-hydration", "READY");
    const hash = await contentHash(page);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    hashes.push(hash as string);
    expect((await S03SurfaceHarness.record(page)).entries, `${variant}: nothing is chosen on open`).toEqual([]);

    if (isMobile(page)) {
      await expect(header(page).getByRole("button", { name: "修改這個 App" })).toBeHidden();
      await chooseOnMobile(page, "修改這個 App");
      await chooseOnMobile(page, "改成我的版本");
    } else {
      await header(page).getByRole("button", { name: "修改這個 App" }).click();
      await header(page).getByRole("button", { name: "改成我的版本" }).click();
    }

    const { entries } = await S03SurfaceHarness.record(page);
    expect(entries, variant).toEqual([
      { choice: "MODIFY_THIS_APP", destination: "S05A", intent: "REFINE", baseContentHash: hash },
      { choice: "MAKE_MY_VERSION", destination: "S05B", intent: "REMIX", baseContentHash: hash }
    ]);
    routes[variant] = entries.map((entry) => ("choice" in entry ? { choice: entry.choice, destination: entry.destination, intent: entry.intent } : entry));
    await expect(resultValue(page)).toHaveText("30");
  }
  expect(hashes[0]).not.toBe(hashes[1]);
  expect(routes.SHARED_SOURCE).toEqual(routes.ORIGINAL);
});

test("S03 Inspection presentation offers the origin's return path, hides both change entries and keeps the source App operable", async ({ page }) => {
  for (const [origin, full, short] of [
    ["COMPOSER", "返回修改畫面", "返回修改"],
    ["PREVIEW", "返回新版預覽", "返回預覽"]
  ] as const) {
    await S03SurfaceHarness.open(page, { inspection: origin });
    await expect(page.locator("body")).toHaveAttribute("data-hydration", "READY");
    await expect(page.getByRole("region", { name: "正在查看原版" })).toBeVisible();
    await expect(page.getByRole("button", { name: "修改這個 App" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "改成我的版本" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "修改", exact: true })).toHaveCount(0);
    const back = isMobile(page) ? bottomNav(page).getByRole("button", { name: short, exact: true }) : page.getByRole("button", { name: full });
    await page.getByRole("spinbutton", { name: "人數" }).fill("6");
    await expect(resultValue(page)).toHaveText("20");
    await back.click();
    expect(await S03SurfaceHarness.record(page)).toEqual({ entries: [], returns: 1, homes: 0 });
  }
});

test("S03 home paths: Logo and the overflow 回到首頁 / 建立新的 App both leave through the Shell, not the App", async ({ page }) => {
  await S03SurfaceHarness.open(page);
  await header(page).getByRole("button", { name: "回到首頁" }).click();
  await header(page).getByRole("button", { name: "更多選項" }).click();
  await page.getByRole("menuitem", { name: "回到首頁 / 建立新的 App" }).click();
  expect(await S03SurfaceHarness.record(page)).toEqual({ entries: [], returns: 0, homes: 2 });
});
