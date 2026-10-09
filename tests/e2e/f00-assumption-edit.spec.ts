import { expect, test, type Locator, type Page } from "@playwright/test";

import { ANON } from "../api/f01-harness.js";
import { MENU_EDIT } from "../contract/intent-edit-shape-fixtures.js";
import { isAnswers, isCreate, type F01BrowserHost, type ResponseBody } from "./support/f01-browser-host.js";
import {
  assumptionRow,
  assumptionsOf,
  expectBuildValidated,
  openDiscover,
  press,
  RECOVERY_TITLE,
  responseData,
  retype,
  SIX_TYPE_NAMES,
  sixTypeAnalysis,
  startCreate,
  tamperAssumption,
  workspaceHeading
} from "./support/f00-flow.js";

const PROMPT = "幫我做一個公司聚餐分帳工具，設定先用你的建議";
const SIX_IDS = ["a_title", "b_headcount", "c_tip_included", "d_rounding", "e_add_ons", "f_menu"] as const;
const KINDS = ["STRING", "NUMBER", "BOOLEAN", "NULL", "LIST", "RECORD"] as const;
const MALFORMED_DETAIL = "這次收到的結果不完整，我們沒有顯示或自動接受任何設定。";

/** The native typed EDIT payload F01-API-002 must receive (choices are the trusted native alternatives). */
const EXPECTED_DECISIONS = [
  { assumption_id: "a_title", decision: "EDIT", edited_value: "Year-end dinner" },
  { assumption_id: "b_headcount", decision: "EDIT", edited_value: 12 },
  { assumption_id: "c_tip_included", decision: "EDIT", edited_value: true },
  { assumption_id: "d_rounding", decision: "EDIT", edited_value: "none" },
  { assumption_id: "e_add_ons", decision: "EDIT", edited_value: [{ item: "cake", size: 6 }, 0] },
  { assumption_id: "f_menu", decision: "EDIT", edited_value: MENU_EDIT }
];

/** Projections that break F01-DATA-004A; each must fail closed instead of offering a guessed editor. */
const BROKEN_PROJECTIONS: readonly (readonly [string, (body: ResponseBody) => ResponseBody])[] = [
  ["ENUM without options", tamperAssumption("d_rounding", (entry) => delete entry.options)],
  ["ENUM proposal outside options", tamperAssumption("d_rounding", (entry) => (entry.options = [1, "none"]))],
  ["LIST with duplicate options", tamperAssumption("e_add_ons", (entry) => (entry.options = ["drinks", "drinks", 0]))],
  ["RECORD without OPEN_JSON_RECORD_V1", tamperAssumption("f_menu", (entry) => delete entry.record_edit_schema)],
  ["BOOLEAN paired with FREE_TEXT", tamperAssumption("c_tip_included", (entry) => (entry.question_type = "FREE_TEXT"))],
  ["NUMBER carrying options", tamperAssumption("b_headcount", (entry) => (entry.options = [8, 9]))]
];

const exactly = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}（`);
const textbox = (page: Page, name: string): Locator => page.getByRole("textbox", { name, exact: true });
const editor = (page: Page, id: string): Locator => assumptionRow(page, id).locator(".assumption-editor");

/** Keyboard-only type change on the native select: arrow keys from the current option to the target kind. */
async function chooseKind(page: Page, label: string, kind: (typeof KINDS)[number]): Promise<void> {
  const select = page.getByRole("combobox", { name: label, exact: true });
  const delta = KINDS.indexOf(kind) - KINDS.indexOf((await select.inputValue()) as (typeof KINDS)[number]);
  await select.focus();
  for (let step = 0; step < Math.abs(delta); step += 1) await page.keyboard.press(delta > 0 ? "ArrowDown" : "ArrowUp");
  await expect(select).toHaveValue(kind);
}

async function typeInto(page: Page, name: string, text: string): Promise<void> {
  await textbox(page, name).focus();
  await page.keyboard.type(text);
}

async function expectFailClosed(page: Page, host: F01BrowserHost): Promise<void> {
  for (const [index, [, rewrite]] of BROKEN_PROJECTIONS.entries()) {
    host.queueAnalysis(sixTypeAnalysis());
    host.tamperNext(isCreate, rewrite);
    if (index === 0) await startCreate(page, PROMPT);
    else await press(page.getByRole("button", { name: "重新整理需求" }), "Enter");
    await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
    await expect(page.getByText(MALFORMED_DETAIL)).toBeVisible();
    await expect(page.getByRole("button", { name: /^(接受|修改|拒絕|再試一次)$/ })).toHaveCount(0);
  }
  expect(host.callsTo("/answers")).toEqual([]);
  const keys = host.callsTo("/api/v1/intents").map((call) => call.idempotencyKey);
  expect(new Set(keys).size).toBe(BROKEN_PROJECTIONS.length);
  host.queueAnalysis(sixTypeAnalysis());
  await press(page.getByRole("button", { name: "重新整理需求" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText("確認幾個設定");
}

async function expectSixTypeReview(page: Page, host: F01BrowserHost): Promise<Record<string, unknown>> {
  const create = host.callsTo("/api/v1/intents").at(-1);
  const decision = responseData(create);
  expect(decision.status).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
  await expect(page.locator("li.assumption")).toHaveCount(assumptionsOf(create).length);
  for (const assumption of assumptionsOf(create)) {
    const row = assumptionRow(page, assumption.assumption_id);
    const pending = assumption.classification === "DEFAULT" || assumption.classification === "PROPOSAL";
    await expect(row.locator(".source-tag")).toHaveText(`來源：${{ FACT: "已提供", DEFAULT: "預設", PROPOSAL: "建議", UNKNOWN: "尚未決定" }[assumption.classification]}`);
    await expect(row.getByRole("button", { name: /^(接受|修改|拒絕)$/ })).toHaveCount(pending ? 3 : 0);
  }
  await expect(assumptionRow(page, "c_tip_included").locator(".assumption-value")).toHaveText("目前值：否");
  await expect(assumptionRow(page, "f_menu").locator(".value-record-row dt")).toHaveText(["main", "courses", "spicy", "extras", "budget", "per_person", "currency", "note"]);
  for (const id of SIX_IDS) await press(assumptionRow(page, id).getByRole("button", { name: "修改", exact: true }), "Enter");
  await expect(page.getByRole("radiogroup", { name: "進位方式的新值" }).getByRole("radio")).toHaveCount(3);
  for (const [name, checked] of [["10", true], ["1", false], ["none", false]] as const) await expect(page.getByRole("radio", { name, exact: true })).toBeChecked({ checked });
  const addOns = page.getByRole("group", { name: "加購項目的新值" }).getByRole("checkbox");
  expect(await addOns.evaluateAll((nodes) => nodes.map((node) => node.parentElement?.textContent))).toEqual(["drinks", "item：cake、size：6", "0"]);
  await expect(editor(page, "d_rounding").getByRole("textbox")).toHaveCount(0);
  await expect(editor(page, "e_add_ons").getByRole("textbox")).toHaveCount(0);
  return decision;
}

async function editScalarsAndChoices(page: Page): Promise<void> {
  await retype(textbox(page, "活動名稱的新值"), "Year-end dinner");
  await retype(textbox(page, "人數的新值"), "abc");
  await press(page.getByRole("radiogroup", { name: "含小費的新值" }).getByRole("radio", { name: "是" }), "Space");
  await press(page.getByRole("radio", { name: "none", exact: true }), "Space");
  const addOns = page.getByRole("group", { name: "加購項目的新值" });
  await press(addOns.getByRole("checkbox", { name: "drinks" }), "Space");
  await press(addOns.getByRole("checkbox", { name: "item：cake、size：6" }), "Space");
  await press(addOns.getByRole("checkbox", { name: "0", exact: true }), "Space");
}

/** Rename / retype top-level fields, then a duplicate name and a bad nested number to prove local validation. */
async function editMenuTopLevel(page: Page): Promise<void> {
  await retype(textbox(page, "菜單的新值 › courses"), "4");
  await retype(textbox(page, "菜單的新值的第 1 個欄位名稱"), "courses");
  await press(page.getByRole("radiogroup", { name: "菜單的新值 › spicy" }).getByRole("radio", { name: "否" }), "Space");
  await press(page.getByRole("button", { name: "移除菜單的新值的第 6 個欄位" }), "Enter");
  await press(page.getByRole("button", { name: "在菜單的新值新增欄位" }), "Enter");
  await typeInto(page, "菜單的新值的第 6 個欄位名稱", "備註");
  await typeInto(page, "菜單的新值 › 備註", "no peanuts");
  await press(page.getByRole("button", { name: exactly("菜單的新值 › budget") }), "Enter");
  await expect(page.getByRole("button", { name: exactly("菜單的新值 › budget") })).toHaveAttribute("aria-expanded", "true");
  await retype(textbox(page, "菜單的新值 › budget › per_person"), "七百");
  await press(page.getByRole("button", { name: exactly("菜單的新值 › budget") }), "Space");
  await expect(textbox(page, "菜單的新值 › budget › per_person")).toBeHidden();
}

async function expectLocalValidation(page: Page, host: F01BrowserHost): Promise<void> {
  for (const id of SIX_IDS) await expect(assumptionRow(page, id).locator(".source-tag")).toHaveText(id.startsWith("b") || id.startsWith("d") ? "來源：預設" : "來源：建議");
  await press(page.getByRole("button", { name: "用這些設定繼續" }), "Enter");
  await expect(textbox(page, "人數的新值")).toHaveAccessibleDescription("請輸入有效的數字");
  await expect(textbox(page, "菜單的新值的第 2 個欄位名稱")).toHaveAccessibleDescription("欄位名稱不可重複");
  await expect(textbox(page, "菜單的新值 › budget › per_person")).toBeVisible();
  await expect(textbox(page, "菜單的新值 › budget › per_person")).toHaveAccessibleDescription("請輸入有效的數字");
  await expect(assumptionRow(page, "f_menu").locator(":scope > .field-error")).toHaveText("請修正標示的欄位");
  expect(host.callsTo("/answers")).toEqual([]);

  await retype(textbox(page, "人數的新值"), "12");
  await retype(textbox(page, "菜單的新值的第 1 個欄位名稱"), "main_dish");
  await retype(textbox(page, "菜單的新值 › main_dish"), "sukiyaki");
  await retype(textbox(page, "菜單的新值 › budget › per_person"), "750.5");
  await retype(textbox(page, "菜單的新值 › budget › currency"), "JPY");
}

/** Nested LIST holding a nested RECORD and null; nested RECORD holding a LIST of numbers — all typed, no JSON. */
async function editMenuNested(page: Page): Promise<void> {
  await press(page.getByRole("button", { name: exactly("菜單的新值 › extras") }), "Enter");
  await press(page.getByRole("button", { name: "在菜單的新值 › extras新增項目" }), "Enter");
  await chooseKind(page, "菜單的新值 › extras 第 2 項的型別", "RECORD");
  await press(page.getByRole("button", { name: exactly("菜單的新值 › extras 第 2 項") }), "Enter");
  for (const [position, name, kind, value] of [[1, "side", "STRING", "kimchi"], [2, "qty", "NUMBER", "2"]] as const) {
    await press(page.getByRole("button", { name: "在菜單的新值 › extras 第 2 項新增欄位" }), "Enter");
    await typeInto(page, `菜單的新值 › extras 第 2 項的第 ${position} 個欄位名稱`, name);
    await chooseKind(page, `菜單的新值 › extras 第 2 項的第 ${position} 個欄位型別`, kind);
    await typeInto(page, `菜單的新值 › extras 第 2 項 › ${name}`, value);
  }
  await press(page.getByRole("button", { name: "在菜單的新值 › extras新增項目" }), "Enter");
  await chooseKind(page, "菜單的新值 › extras 第 3 項的型別", "NULL");

  await press(page.getByRole("button", { name: "在菜單的新值 › budget新增欄位" }), "Enter");
  await typeInto(page, "菜單的新值 › budget的第 3 個欄位名稱", "split");
  await chooseKind(page, "菜單的新值 › budget的第 3 個欄位型別", "RECORD");
  await press(page.getByRole("button", { name: exactly("菜單的新值 › budget › split") }), "Enter");
  await press(page.getByRole("button", { name: "在菜單的新值 › budget › split新增欄位" }), "Enter");
  await typeInto(page, "菜單的新值 › budget › split的第 1 個欄位名稱", "mode");
  await typeInto(page, "菜單的新值 › budget › split › mode", "EQUAL");
  await press(page.getByRole("button", { name: "在菜單的新值 › budget › split新增欄位" }), "Enter");
  await typeInto(page, "菜單的新值 › budget › split的第 2 個欄位名稱", "rounding");
  await chooseKind(page, "菜單的新值 › budget › split的第 2 個欄位型別", "LIST");
  await press(page.getByRole("button", { name: exactly("菜單的新值 › budget › split › rounding") }), "Enter");
  for (const [position, value] of [[1, "1"], [2, "10"]] as const) {
    await press(page.getByRole("button", { name: "在菜單的新值 › budget › split › rounding新增項目" }), "Enter");
    await chooseKind(page, `菜單的新值 › budget › split › rounding 第 ${position} 項的型別`, "NUMBER");
    await typeInto(page, `菜單的新值 › budget › split › rounding 第 ${position} 項`, value);
  }
}

/** Another writer moved the Intent on; the stale submit must not be retried but re-analysed with input kept. */
async function expectStaleRecovery(page: Page, host: F01BrowserHost, decision: Record<string, unknown>): Promise<void> {
  const concurrent = await host.harness.answers(
    String(decision.intent_id),
    { answers: [], assumption_decisions: [{ assumption_id: "a_title", decision: "ACCEPT" }], intent_version: decision.intent_version },
    "concurrent-writer"
  );
  expect(concurrent.status).toBe(200);
  await press(page.getByRole("button", { name: "用這些設定繼續" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
  const [stale] = host.callsTo("/answers");
  expect(stale?.status).toBe(409);
  expect(stale?.response?.error).toMatchObject({ code: "F01-ERR-004" });
  expect(stale?.body).toEqual({ answers: [], assumption_decisions: EXPECTED_DECISIONS, intent_version: decision.intent_version });
  await expect(page.getByText("這個需求剛在其他地方更新過，請重新整理後再確認。")).toBeVisible();
  await expect(page.getByRole("button", { name: /^(再試一次|回去修改)$/ })).toHaveCount(0);
  const unsent = page.getByRole("region", { name: "你剛才填寫的內容" });
  await expect(unsent.locator(".provided-item > dt")).toHaveText(SIX_IDS.map((id) => SIX_TYPE_NAMES[id] ?? id));
  await expect(unsent).toContainText("Year-end dinner");
  await expect(unsent).toContainText("no peanuts");

  host.queueAnalysis(sixTypeAnalysis());
  await press(page.getByRole("button", { name: "重新整理需求" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText("確認幾個設定");
  await expect(page.locator(".decision-status")).toHaveText(Array(SIX_IDS.length).fill("修改中"));
  await expect(textbox(page, "活動名稱的新值")).toHaveValue("Year-end dinner");
  await expect(page.getByRole("radio", { name: "none", exact: true })).toBeChecked();
  await expect(textbox(page, "菜單的新值的第 1 個欄位名稱")).toHaveValue("main_dish");
}

async function expectRetryAndProvenance(page: Page, host: F01BrowserHost): Promise<void> {
  const fresh = responseData(host.callsTo("/api/v1/intents").at(-1));
  host.dropNext(isAnswers);
  await press(page.getByRole("button", { name: "用這些設定繼續" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
  await expect(page.getByRole("button", { name: "回去修改" })).toBeVisible();
  host.queueValidBlueprint();
  await press(page.getByRole("button", { name: "再試一次" }), "Enter");
  await expectBuildValidated(page);

  const [, dropped, delivered] = host.callsTo("/answers");
  expect(dropped?.status).toBeNull();
  expect(delivered?.status).toBe(200);
  expect(delivered?.idempotencyKey).toBe(dropped?.idempotencyKey);
  expect(delivered?.body).toEqual({ answers: [], assumption_decisions: EXPECTED_DECISIONS, intent_version: fresh.intent_version });
  expect(delivered?.body).not.toHaveProperty("anonymous_id");
  for (const create of host.callsTo("/api/v1/intents")) expect(create.body.anonymous_id).toBe(ANON);
  expect(responseData(delivered).status).toBe("READY");
  const confirmed = new Map(assumptionsOf(delivered).map((entry) => [entry.assumption_id, entry]));
  for (const expected of EXPECTED_DECISIONS) {
    expect(confirmed.get(expected.assumption_id)).toMatchObject({ classification: "FACT", source: "USER_EXPLICIT", resolved_value: expected.edited_value });
  }
}

test("TEST-F00-005 material proposals of all six projected types are visible and Accept / Edit / Reject operable with native typed edits", async ({ page }) => {
  test.slow();
  const host = await openDiscover(page);
  await expectFailClosed(page, host);
  const decision = await expectSixTypeReview(page, host);
  await editScalarsAndChoices(page);
  await editMenuTopLevel(page);
  await expectLocalValidation(page, host);
  await editMenuNested(page);
  await expectStaleRecovery(page, host, decision);
  await expectRetryAndProvenance(page, host);
});
