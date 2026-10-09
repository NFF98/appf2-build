import { expect, test, type Page } from "@playwright/test";

import { isAnswers, isCreate } from "./support/f01-browser-host.js";
import {
  assumptionRow,
  assumptionsOf,
  expectBuildValidated,
  openDiscover,
  press,
  RECOVERY_TITLE,
  responseData,
  startCreate,
  tamperAssumption,
  twoAssumptionAnalysis,
  workspaceHeading
} from "./support/f00-flow.js";

const PROMPT = "幫我做一個聚餐分帳工具，小費比例你先建議";

async function expectNoUserFactLabel(page: Page): Promise<void> {
  await expect(page.getByText("已提供", { exact: false })).toHaveCount(0);
}

test("TEST-F00-AC-021 the Shell never shows an LLM proposal as a User fact; only F01 promotes an accepted proposal", async ({ page }) => {
  const host = await openDiscover(page);

  // A response that labels an LLM proposal as FACT contradicts F01 provenance: fail closed, show nothing as 已提供.
  host.queueAnalysis(twoAssumptionAnalysis());
  host.tamperNext(isCreate, tamperAssumption("tip_rate", (entry) => (entry.classification = "FACT")));
  await startCreate(page, PROMPT);
  await expect(workspaceHeading(page)).toHaveText(RECOVERY_TITLE);
  expect(assumptionsOf(host.callsTo("/api/v1/intents").at(-1)).find((entry) => entry.assumption_id === "tip_rate")).toMatchObject({ classification: "FACT", source: "LLM_PROPOSED" });
  await expect(page.locator(".source-tag")).toHaveCount(0);
  await expectNoUserFactLabel(page);

  // The honest F01 projection: the proposal stays 建議, the NFF default stays 預設.
  host.queueAnalysis(twoAssumptionAnalysis());
  await press(page.getByRole("button", { name: "重新整理需求" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText("確認幾個設定");
  const projected = new Map(assumptionsOf(host.callsTo("/api/v1/intents").at(-1)).map((entry) => [entry.assumption_id, entry]));
  expect(projected.get("tip_rate")).toMatchObject({ classification: "PROPOSAL", source: "LLM_PROPOSED" });
  expect(projected.get("currency")).toMatchObject({ classification: "DEFAULT", source: "NFF_DEFAULT" });
  await expect(assumptionRow(page, "tip_rate").locator(".source-tag")).toHaveText("來源：建議");
  await expect(assumptionRow(page, "currency").locator(".source-tag")).toHaveText("來源：預設");

  // A local Accept is only a pending choice: while F01 has not answered, nothing is relabelled or summarised as provided.
  await press(assumptionRow(page, "tip_rate").getByRole("button", { name: "接受", exact: true }), "Enter");
  await expect(assumptionRow(page, "tip_rate").getByRole("button", { name: "接受", exact: true })).toHaveAttribute("aria-pressed", "true");
  const release = host.holdNext(isAnswers);
  host.queueValidBlueprint();
  await press(page.getByRole("button", { name: "用這些設定繼續" }), "Enter");
  await expect(workspaceHeading(page)).toHaveText("正在理解你的想法…");
  expect(host.callsTo("/answers")).toEqual([]);
  await expectNoUserFactLabel(page);

  release();
  await expectBuildValidated(page);
  await expectNoUserFactLabel(page);
  const [answers] = host.callsTo("/answers");
  expect(answers?.body.assumption_decisions).toEqual([
    { assumption_id: "currency", decision: "ACCEPT" },
    { assumption_id: "tip_rate", decision: "ACCEPT" }
  ]);
  expect(JSON.stringify(answers?.body)).not.toMatch(/classification|source|FACT/);
  const confirmed = new Map(assumptionsOf(answers).map((entry) => [entry.assumption_id, entry]));
  expect(responseData(answers).status).toBe("READY");
  expect(confirmed.get("tip_rate")).toMatchObject({ classification: "FACT", source: "USER_ACCEPTED_PROPOSAL" });
});
