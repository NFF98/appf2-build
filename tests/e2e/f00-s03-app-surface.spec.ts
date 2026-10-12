import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { composer, createButton } from "./support/f00-flow.js";
import { APP_ORIGIN, S03WorkerHost } from "./support/s03-worker-host.js";

const PROMPT = "幫我做一個朋友聚餐依人數分帳的小工具";
const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/u;

const s03 = (page: Page): Locator => page.locator(".s03");
const resultValue = (page: Page): Locator => page.locator(".s03-result-item", { hasText: "每人金額" }).locator("dd");
const peopleInput = (page: Page): Locator => page.getByRole("spinbutton", { name: "人數" });
const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 640;

let host: S03WorkerHost;

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

/** S01 natural language → F01 CREATE/compile → secure delivery + admission → F03 READY → S03, through the real UI. */
async function openGeneratedApp(page: Page): Promise<void> {
  await page.goto(`${APP_ORIGIN}/`);
  await composer(page).fill(PROMPT);
  await createButton(page).click();
  await expect(s03(page)).toBeVisible({ timeout: 20_000 });
  await expect(resultValue(page)).toHaveText("30");
}

test("TEST-F00-007 VALIDATED Blueprint is delivered, admitted, F03-hydrated and shown as the S03 APP surface; a local action commits without any request", async ({ page }, testInfo) => {
  await openGeneratedApp(page);

  const [create, compile, grant, body, admission, ...extra] = host.calls;
  expect(extra, host.apiCalls().join("\n")).toEqual([]);
  expect(create).toMatchObject({ method: "POST", path: "/api/v1/intents", status: 200 });
  const intentId = (JSON.parse(create?.body ?? "{}") as { data: { intent_id: string } }).data.intent_id;
  expect(compile).toMatchObject({ method: "POST", path: `/api/v1/intents/${intentId}/compile`, status: 200 });
  expect(grant).toMatchObject({ method: "GET", path: `/api/v1/intents/${intentId}/blueprint-access-grant`, status: 200 });
  const grantData = (JSON.parse(grant?.body ?? "{}") as { data: { intent_blueprint_access_grant: string; content_hash: string } }).data;
  expect(grantData.content_hash).toMatch(CONTENT_HASH);
  expect(body).toMatchObject({ method: "GET", path: `/b/${grantData.content_hash}`, status: 200 });
  expect(admission).toMatchObject({ method: "GET", path: `/api/v1/blueprints/${grantData.content_hash}/execution-admission`, status: 200 });
  expect(JSON.parse(admission?.body ?? "{}")).toMatchObject({ data: { executable: true, content_hash: grantData.content_hash, trust_status: "VALIDATED" } });
  expect(host.backend.modelCalls()).toBe(2);

  // S03: the Generated App is the primary content, the S02 workspace is gone, and the grant stayed in memory only.
  await expect(page.locator(".s02")).toHaveCount(0);
  await expect(page.locator(".s03-title")).toHaveText("聚餐分帳");
  await expect(page.locator(".s03-main")).toBeFocused();
  await expect(page.locator(".runtime-frame").getByRole("heading", { name: "聚餐分帳" })).toBeVisible();
  await expect(peopleInput(page)).toHaveValue("4");
  await expect(page.locator(".rt-stat-value")).toHaveText("30");
  await expect(page.getByText("{")).toHaveCount(0);
  const leaked = await page.evaluate(
    (token) => [location.href, document.cookie, JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })].some((text) => text.includes(token)),
    grantData.intent_blueprint_access_grant
  );
  expect(leaked).toBe(false);
  await attachScreenshot(page, testInfo, "s03-ready");

  // One real local User action: F03 commits the new state and the canonical result follows, with zero requests.
  const before = { calls: host.calls.length, model: host.backend.modelCalls() };
  await peopleInput(page).fill("6");
  await expect(resultValue(page)).toHaveText("20");
  await expect(page.locator(".rt-stat-value")).toHaveText("20");
  await expect(peopleInput(page)).toHaveValue("6");
  expect({ calls: host.calls.length, model: host.backend.modelCalls() }).toEqual(before);
  expect(host.blocked).toEqual([]);
  await attachScreenshot(page, testInfo, "s03-after-local-action");
});

test("TEST-F00-AC-009 S03 reaches the Share / Remix / Correction entries while the current App stays intact", async ({ page }, testInfo) => {
  await openGeneratedApp(page);
  const settled = host.calls.length;
  const url = page.url();

  if (isMobile(page)) {
    const nav = page.getByRole("navigation", { name: "App 導覽" });
    await expect(nav.getByRole("button", { name: "目前 App" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("button", { name: "分享", exact: true }).click();
    await nav.getByRole("button", { name: "修改", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "你想怎麼改？" });
    await expect(sheet.getByRole("button")).toHaveText(["修改這個 App", "改成我的版本", "取消"]);
    await attachScreenshot(page, testInfo, "s03-mobile-change-sheet");
    await sheet.getByRole("button", { name: "改成我的版本" }).click();
    await expect(sheet).toHaveCount(0);
  } else {
    const header = page.locator(".s03-header");
    for (const name of ["修改這個 App", "改成我的版本", "分享"]) await expect(header.getByRole("button", { name, exact: true })).toBeEnabled();
    await header.getByRole("button", { name: "分享", exact: true }).click();
    await header.getByRole("button", { name: "修改這個 App" }).click();
    await header.getByRole("button", { name: "改成我的版本" }).click();
    await attachScreenshot(page, testInfo, "s03-desktop-entries");
  }
  const correction = page.locator(".s03-result").getByRole("button", { name: "調整結果" });
  await expect(correction).toBeVisible();
  await correction.click();

  // Entries are boundaries only: no request, no navigation, and the same App with the same committed result.
  await expect(s03(page)).toBeVisible();
  await expect(resultValue(page)).toHaveText("30");
  await expect(peopleInput(page)).toHaveValue("4");
  expect(page.url()).toBe(url);
  expect(host.calls.length).toBe(settled);
  expect(host.blocked).toEqual([]);
});
