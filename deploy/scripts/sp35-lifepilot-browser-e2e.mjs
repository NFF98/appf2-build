// One bounded, real AI -> F02 -> F03 -> Playwright LifePilot journey. No mocked responses.
// This E2E is intentionally FAIL-CLOSED: a rendered card or button is not functional proof.
import { chromium } from "@playwright/test";
import path from "node:path";

const origin = new URL(process.env.APPF2_STAGING_URL?.trim() || "");
if (origin.protocol !== "https:" || !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) ||
    origin.pathname !== "/" || origin.search || origin.hash) throw Error("LIFEPILOT: isolated staging HTTPS URL required");
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
const page = await context.newPage();
const imageFile = path.join(process.env.RUNNER_TEMP || "/tmp", "appf2-sp35-browser.png");
const failures = [];
const results = [];

const demand = [
  "Build LifePilot, a working single-page personal organizer with FIVE labeled sections.",
  "Use these exact English section headings: My Today, Smart Tasks, Shopping List, Money Snapshot, Healthy Habits.",
  "All features must use executable registered controls and mutable typed state, not static mockups.",
  "Keep each editable task and shopping list bounded to 18 items maximum for safe local operation.",
  "My Today: show today's task completion count or progress live-linked to Smart Tasks.",
  "Smart Tasks: Task name input, Add task button, edit a selected row's title, Complete task, Delete task,",
  "and filter tasks by priority; changes must target the clicked row rather than the first row.",
  "Shopping List: shopping item name plus numeric quantity, Add item, mark item purchased,",
  "edit quantity and display the live count of items still to buy.",
  "Money Snapshot: editable numeric weekly budget, numeric expense entry, Add expense,",
  "live total spent and remaining budget after every expense.",
  "Healthy Habits: Walking habit, an interactive mark-complete action, live completed-habits metric.",
  "Each feature must have its own clearly titled section using registered available layout components.",
  "Buttons must perform their labeled operations. Keep changes locally for the current browser tab where supported.",
  "No logins, network integrations, external services, payment processing or fabricated cross-device sync.",
  "If a required feature cannot be implemented, do not present it as working."
].join(" ");

function requireTrue(condition, message) {
  if (!condition) throw Error(message);
}
async function check(label, fn) {
  try {
    await fn();
    results.push(label);
    console.log("STAGING LIFEPILOT " + label + ": PASS");
  } catch (error) {
    failures.push(label);
    // Sanitized diagnostic: never expose API body, prompt or private user data.
    console.log("STAGING LIFEPILOT " + label + ": FAIL " + String(error?.message || "unknown").slice(0, 180));
  }
}
function feature(name) {
  // Bind assertions to the nearest independent feature layout, never the app root.
  const heading = page.locator(".s03-app .rt-text-HEADING")
    .filter({ hasText: new RegExp("^" + name + "$") }).first();
  return heading.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rt-container ')][1]");
}
async function section(name) {
  const target = feature(name);
  requireTrue(await target.count() === 1, "missing dedicated feature section: " + name);
  return target;
}
async function pressIn(where, expression, description) {
  const button = where.getByRole("button", { name: expression }).first();
  requireTrue(await button.count() === 1, "missing " + description + " action");
  await button.click({ timeout: 8_000 });
}
async function firstText(where, value) {
  const input = where.locator("input[type=text], input:not([type]), textarea").first();
  requireTrue(await input.count() === 1, "missing text input");
  await input.fill(value);
}
async function numberField(where, value) {
  const input = where.locator('input[type="number"]').first();
  requireTrue(await input.count() === 1, "missing numeric input");
  await input.fill(String(value));
}
async function metrics(where) {
  const values = await where.locator(".rt-stat-value").evaluateAll(elements =>
    elements.filter(element => !element.closest(".rt-list"))
      .map(element => element.textContent || ""));
  return values.map(text => Number(text.replace(/[^0-9.-]/g, ""))).filter(Number.isFinite);
}
async function ensureMetricsChange(before, after, label) {
  requireTrue(before.length > 0 && after.length === before.length &&
    before.some((value, index) => value !== after[index]), label + " metrics did not change");
}
try {
  await page.goto(origin.origin, { waitUntil: "domcontentloaded", timeout: 40_000 });
  const composer = page.locator("#composer-input");
  await composer.waitFor({ state: "visible", timeout: 15_000 });
  await composer.fill(demand);
  const intentRequest = page.waitForResponse(r => r.request().method() === "POST" &&
    new URL(r.url()).pathname === "/api/v1/intents", { timeout: 110_000 });
  const compileRequest = page.waitForResponse(r => r.request().method() === "POST" &&
    /^\/api\/v1\/intents\/[^/]+\/compile$/.test(new URL(r.url()).pathname),
    { timeout: 190_000 }).catch(() => null);
  await page.locator(".composer-create").click();
  const analysis = await intentRequest;
  const first = await analysis.json().catch(() => ({}));
  const status = first?.data?.status;
  console.log("STAGING LIFEPILOT ANALYSIS: HTTP=" + analysis.status() +
    " STATUS=" + String(status || "NONE") + " CODE=" + String(first?.error?.code || "NONE"));
  requireTrue(analysis.status() === 200 && ["READY", "READY_WITH_VISIBLE_ASSUMPTIONS"].includes(status),
    "real complex intent analysis not executable");
  if (status === "READY_WITH_VISIBLE_ASSUMPTIONS") {
    const answerRequest = page.waitForResponse(r => r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/answers"), { timeout: 100_000 });
    await page.getByRole("button", { name: "用這些設定繼續" }).click();
    const answer = await answerRequest;
    const data = await answer.json().catch(() => ({}));
    requireTrue(answer.status() === 200 && data?.data?.status === "READY", "clarification not READY");
  }
  const compilation = await compileRequest;
  requireTrue(compilation !== null, "no real F02 compile request");
  const built = await compilation.json().catch(() => ({}));
  const validated = compilation.status() === 200 && built?.data?.status === "VALIDATED" &&
    /^sha256:[0-9a-f]{64}$/.test(String(built?.data?.content_hash || ""));
  console.log("STAGING LIFEPILOT F02: HTTP=" + compilation.status() +
    " VALIDATED=" + validated + " CODE=" + String(built?.error?.code || "NONE"));
  requireTrue(validated, "real LifePilot Blueprint was not admitted by F02");
  await page.locator(".s03-app").waitFor({ state: "visible", timeout: 60_000 });
  const labels = ["My Today", "Smart Tasks", "Shopping List", "Money Snapshot", "Healthy Habits"];
  for (const label of labels) {
    const present = await page.locator(".s03-app").getByText(label, { exact: true }).count() > 0;
    console.log("STAGING LIFEPILOT FEATURE " + label + ": " + (present ? "RENDERED" : "MISSING"));
  }

  let todayBefore = [];
  await check("MY_TODAY_BASELINE", async () => {
    todayBefore = await metrics(await section("My Today"));
    requireTrue(todayBefore.length > 0, "today progress has no live numeric metric");
  });
  await check("SMART_TASKS_CRUD", async () => {
    const tasks = await section("Smart Tasks");
    await firstText(tasks, "LP-TASK-A");
    await pressIn(tasks, /add task/i, "Add task");
    const taskPriority = tasks.getByRole("combobox", { name: /^Task priority$/i }).first();
    requireTrue(await taskPriority.count() === 1, "task priority selector missing");
    await taskPriority.selectOption("High");
    await firstText(tasks, "LP-TASK-B");
    await pressIn(tasks, /add task/i, "Add task");
    const rows = tasks.locator(".rt-list-item");
    requireTrue(await rows.filter({ hasText: "LP-TASK-A" }).count() === 1 &&
      await rows.filter({ hasText: "LP-TASK-B" }).count() === 1, "added rows not displayed");
    const rowB = rows.filter({ hasText: "LP-TASK-B" });
    const editor = tasks.getByRole("textbox", { name: /edit task|new title/i }).first();
    requireTrue(await editor.count() === 1, "no editable title for selected task");
    await editor.fill("LP-TASK-B-EDITED");
    await pressIn(rowB, /edit/i, "edit selected row B");
    requireTrue(await rows.filter({ hasText: "LP-TASK-B-EDITED" }).count() === 1 &&
      await rows.filter({ hasText: "LP-TASK-A" }).count() === 1, "task editing did not target selected row");
    const before = await metrics(tasks);
    await pressIn(rows.filter({ hasText: "LP-TASK-B-EDITED" }), /complete|mark done/i, "complete row B");
    await ensureMetricsChange(before, await metrics(tasks), "task completion");
    await pressIn(rows.filter({ hasText: "LP-TASK-A" }), /delete task|delete|remove/i, "delete row A");
    requireTrue(await rows.filter({ hasText: "LP-TASK-A" }).count() === 0 &&
      await rows.filter({ hasText: "LP-TASK-B-EDITED" }).count() === 1, "wrong task removed");
    const priority = tasks.getByRole("combobox", { name: /priority filter/i }).first();
    requireTrue(await priority.count() === 1, "priority filter not implemented");
    requireTrue((await priority.locator("option").count()) > 1, "priority filter has no options");
    await priority.selectOption("High");
    requireTrue(await priority.inputValue() === "High", "priority filter selection did not persist");
    const filtered = tasks.locator(".rt-list").last();
    requireTrue(await filtered.getByText("LP-TASK-B-EDITED", { exact: true }).count() === 1,
      "selected High-priority task missing from filtered results");
  });
  await check("MY_TODAY_LINKED", async () => {
    const today = await section("My Today");
    await ensureMetricsChange(todayBefore, await metrics(today), "My Today / Smart Tasks link");
  });
  await check("SHOPPING_LIST", async () => {
    const shopping = await section("Shopping List");
    const before = await metrics(shopping);
    await firstText(shopping, "LP-MILK");
    await numberField(shopping, 3);
    await pressIn(shopping, /add item|add to list/i, "Add item");
    const item = shopping.locator(".rt-list-item").filter({ hasText: "LP-MILK" });
    requireTrue(await item.count() === 1, "shopping item not saved into list");
    await ensureMetricsChange(before, await metrics(shopping), "shopping remaining");
    await numberField(shopping, 5);
    await pressIn(item, /update quantity/i, "update selected shopping item quantity");
    requireTrue((await item.locator(".rt-stat-value").allTextContents()).some(value =>
      Number(value.trim()) === 5), "selected item's quantity did not update to 5");
    const previous = await metrics(shopping);
    await pressIn(item, /bought|purchased|check|done/i, "purchased-item toggle");
    await ensureMetricsChange(previous, await metrics(shopping), "shopping purchase");
  });
  await check("MONEY_SNAPSHOT", async () => {
    const money = await section("Money Snapshot");
    const numbers = money.locator('input[type="number"]');
    requireTrue(await numbers.count() >= 2, "budget and expense inputs missing");
    await numbers.nth(0).fill("200");
    const previous = await metrics(money);
    await numbers.nth(1).fill("37");
    await pressIn(money, /add expense|record expense/i, "Add expense");
    const current = await metrics(money);
    await ensureMetricsChange(previous, current, "expense total / budget remaining");
    requireTrue(current.some(value => value === 37 || value === 163),
      "no expense total 37 or remaining budget 163");
  });
  await check("HEALTHY_HABITS", async () => {
    const habits = await section("Healthy Habits");
    const previous = await metrics(habits);
    requireTrue(await habits.getByText(/walk/i).count() > 0, "walking habit not displayed");
    await pressIn(habits, /complete|done|check|mark/i, "complete habit");
    await ensureMetricsChange(previous, await metrics(habits), "habits progress");
  });
  await check("SAME_TAB_RELOAD", async () => {
    requireTrue(results.includes("SMART_TASKS_CRUD"), "task changes not verified before reload");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".s03-app").waitFor({ state: "visible", timeout: 12_000 });
    requireTrue(await page.locator(".s03-app").getByText("LP-TASK-B-EDITED").count() > 0,
      "saved task not restored after reload");
  });
  await page.screenshot({ path: imageFile, fullPage: true });
  console.log("STAGING LIFEPILOT FUNCTIONAL SUMMARY: " + results.filter(x => x !== "MY_TODAY_BASELINE").length +
    "/6 FEATURE_OR_RELOAD_CHECKS PASS; FAIL=" + failures.join(","));
  requireTrue(failures.length === 0, "LifePilot complete E2E incomplete: " + failures.join(","));
  console.log("STAGING LIFEPILOT: ALL FIVE FUNCTIONS + RELOAD REAL BROWSER PASS");
} catch (error) {
  await page.screenshot({ path: imageFile, fullPage: true }).catch(() => {});
  console.log("STAGING LIFEPILOT: FAIL-CLOSED, " + String(error?.message || "unknown").slice(0, 200));
  throw error;
} finally {
  await browser.close();
}
