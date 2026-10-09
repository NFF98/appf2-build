import { expect, type Locator, type Page } from "@playwright/test";

import type { StructuredIntentEnvelope } from "../../../src/platform/intent/intent-contract.js";
import { clarifyingAnalysis, readyAnalysis } from "../../api/f01-harness.js";
import { SIX_TYPE_ASSUMPTIONS } from "../../contract/intent-edit-shape-fixtures.js";
import { llmProposal, nffDefault } from "../../contract/intent-envelope-fixtures.js";
import { F01BrowserHost, type RecordedCall, type ResponseBody } from "./f01-browser-host.js";

export type QuestionData = { readonly question_id: string; readonly prompt: string; readonly semantic_item_ids: readonly string[] };
export type AssumptionData = {
  readonly assumption_id: string;
  readonly description: string;
  readonly classification: string;
  readonly source: string;
  readonly resolved_value?: unknown;
};

export const composer = (page: Page): Locator => page.getByRole("textbox", { name: "說出你想做的 App" });
export const createButton = (page: Page): Locator => page.getByRole("button", { name: "建立 App", exact: true });
export const workspaceHeading = (page: Page): Locator => page.getByRole("heading", { level: 1 });
export const stageList = (page: Page): Locator => page.getByRole("region", { name: "建立進度" }).getByRole("listitem");
export const assumptionRow = (page: Page, id: string): Locator => page.locator(`li.assumption[data-assumption-id="${id}"]`);
export const RECOVERY_TITLE = "目前沒完成，但你的內容還在。";

export function responseData(call: RecordedCall | undefined): Record<string, unknown> {
  const data = call?.response?.data;
  if (typeof data !== "object" || data === null) throw new Error(`expected F01 data, got ${JSON.stringify(call?.response)}`);
  return data as Record<string, unknown>;
}

export const questionsOf = (call: RecordedCall | undefined): QuestionData[] => responseData(call).questions as QuestionData[];
export const assumptionsOf = (call: RecordedCall | undefined): AssumptionData[] => responseData(call).visible_assumptions as AssumptionData[];

export async function openDiscover(page: Page): Promise<F01BrowserHost> {
  const host = await F01BrowserHost.attach(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "意圖就是 App" })).toBeVisible();
  return host;
}

export async function startCreate(page: Page, prompt: string): Promise<void> {
  await composer(page).fill(prompt);
  await createButton(page).click();
}

/** Validated end of the F01 creation boundary: stages 1–3 confirmed, no completion claim before F03. */
export async function expectBuildValidated(page: Page): Promise<void> {
  await expect(workspaceHeading(page)).toHaveText("已完成互動檢查");
  await expect(stageList(page)).toHaveText([/理解想法.*已完成/, /整理 App.*已完成/, /檢查互動.*已完成/, /準備 App.*尚未開始/]);
  await expect(page.getByText("100%")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /開啟 App/ })).toHaveCount(0);
}

/** Keyboard-only activation: focus the control, then press a key (no pointer involved). */
export async function press(control: Locator, key: string): Promise<void> {
  await control.focus();
  await control.page().keyboard.press(key);
}

/** Keyboard-only text replacement of an input's current value. */
export async function retype(control: Locator, text: string): Promise<void> {
  await control.focus();
  await control.page().keyboard.press("ControlOrMeta+A");
  await control.page().keyboard.type(text);
}

function requiredNumber(id: string): ReturnType<typeof llmProposal> {
  return llmProposal({ id, description: `需要的${id}`, required_for_execution: true, can_default: false, expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 1 });
}

/** Four required unknowns without safe defaults: F01 must split them across rounds of at most three. */
export function fourQuestionAnalysis(): StructuredIntentEnvelope {
  const base = clarifyingAnalysis();
  return { ...base, missing_fields: [...base.missing_fields, requiredNumber("budget"), requiredNumber("days"), requiredNumber("rounds")] };
}

export function twoAssumptionAnalysis(): StructuredIntentEnvelope {
  return {
    ...readyAnalysis(),
    assumptions: [
      nffDefault({ id: "currency", description: "幣別", proposed_default: "TWD" }),
      llmProposal({ id: "tip_rate", description: "小費比例", expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 10 })
    ]
  };
}

export const SIX_TYPE_NAMES: Readonly<Record<string, string>> = {
  a_title: "活動名稱",
  b_headcount: "人數",
  c_tip_included: "含小費",
  d_rounding: "進位方式",
  e_add_ons: "加購項目",
  f_menu: "菜單"
};

/** One pending DEFAULT / PROPOSAL of each projected type (STRING, NUMBER, BOOLEAN, ENUM, LIST, RECORD). */
export function sixTypeAnalysis(): StructuredIntentEnvelope {
  return { ...readyAnalysis(), assumptions: SIX_TYPE_ASSUMPTIONS.map((item) => ({ ...item, description: SIX_TYPE_NAMES[item.id] ?? item.description })) };
}

/** Rewrites one projected visible assumption inside a real F01 decision response. */
export function tamperAssumption(id: string, change: (assumption: Record<string, unknown>) => void): (body: ResponseBody) => ResponseBody {
  return (body) => {
    const data = body.data as { visible_assumptions: Record<string, unknown>[] };
    const target = data.visible_assumptions.find((entry) => entry.assumption_id === id);
    if (target === undefined) throw new Error(`response has no visible assumption ${id}`);
    change(target);
    return body;
  };
}
