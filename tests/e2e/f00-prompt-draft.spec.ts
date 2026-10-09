import { expect, test, type Page } from "@playwright/test";

import { PROMPT_DRAFT_STORAGE_KEY, PROMPT_DRAFT_TTL_MS } from "../../src/app/discover/prompt-draft-store.js";
import { composer, openDiscover, startCreate, twoAssumptionAnalysis, workspaceHeading } from "./support/f00-flow.js";

const PROMPT = "幫我做一個聚餐分帳工具";

const storedDraft = (page: Page): Promise<string | null> => page.evaluate((key) => window.localStorage.getItem(key), PROMPT_DRAFT_STORAGE_KEY);

test("browser prompt draft survives a reload, expires after its TTL and is cleared once F01 accepts the submission", async ({ page }) => {
  const host = await openDiscover(page);
  await composer(page).fill(PROMPT);
  const saved = JSON.parse((await storedDraft(page)) ?? "null") as Record<string, unknown>;
  expect(Object.keys(saved).sort()).toEqual(["capsule_id", "saved_at", "schema", "text", "version"]);
  expect(saved).toMatchObject({ schema: "appf2.f00.prompt_draft", version: 1, text: PROMPT, capsule_id: null });

  await page.reload();
  await expect(composer(page)).toHaveValue(PROMPT);

  await page.evaluate(
    ([key, ttl]) => {
      const record = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
      window.localStorage.setItem(key, JSON.stringify({ ...record, saved_at: Date.now() - ttl }));
    },
    [PROMPT_DRAFT_STORAGE_KEY, PROMPT_DRAFT_TTL_MS] as const
  );
  await page.reload();
  await expect(composer(page)).toHaveValue("");
  expect(await storedDraft(page)).toBeNull();

  host.queueAnalysis(twoAssumptionAnalysis());
  await startCreate(page, PROMPT);
  await expect(workspaceHeading(page)).toHaveText("確認幾個設定");
  await expect.poll(() => storedDraft(page)).toBeNull();
});
