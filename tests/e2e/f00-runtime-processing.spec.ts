import { expect, test, type Page } from "@playwright/test";

import type { RuntimeProcessingView } from "../../src/app/runtime/runtime-processing.js";
import type { RuntimeOperationProjection } from "../../src/platform/runtime/runtime-operation.js";
import { SOFT_DEADLINE_MS } from "../../src/platform/runtime/runtime-operation.js";
import type { RuntimeHarness } from "../runtime/runtime-fixtures.js";
import { startRuntimeProcessingHarness, type RuntimeProcessingHarness } from "./support/runtime-processing-host.js";

let harnessPage: RuntimeProcessingHarness;

test.beforeAll(async () => {
  harnessPage = await startRuntimeProcessingHarness();
});

test.afterAll(async () => {
  await harnessPage.close();
});

/** Real F03 dispatch on the Node-side Runtime Instance; returns every projection F03 emitted, in order. */
function dispatchAndRecord(runtime: RuntimeHarness, nodeId: string): { readonly token: string; readonly projections: RuntimeOperationProjection[] } {
  const { pressOp, tokenOf } = harnessPage.runtime;
  const projections: RuntimeOperationProjection[] = [];
  const stop = runtime.runtime.subscribeOperations((projection) => projections.push(projection));
  try {
    return { token: tokenOf(pressOp(runtime, nodeId)), projections };
  } finally {
    stop();
  }
}

const presentationLog = (page: Page): Promise<RuntimeProcessingView[]> => page.evaluate(() => window.appf2RuntimeHarness?.log ?? []);
const deliver = (page: Page, projections: readonly RuntimeOperationProjection[]): Promise<void> =>
  page.evaluate((batch) => window.appf2RuntimeHarness?.deliver(batch), projections);

function percentsShownFor(log: readonly RuntimeProcessingView[], token: string): (number | null)[] {
  return log.flatMap((view) => (view.processing?.operationToken === token ? [view.processing.percent] : []));
}

test("TEST-F00-029 every F03-admitted Runtime interaction enters logical global processing in a real browser, without forcing a paint for fast operations", async ({ page }) => {
  // Fast interaction from a real click: F03 admits and commits it within one task; the presentation state exists
  // logically for each admitted operation, but no loading frame is inserted into the page.
  const { instrumentedScore, operationBlueprint, operationHarness } = harnessPage.runtime;
  const runtime = await operationHarness(operationBlueprint());
  const admitted: string[] = [];
  await page.exposeFunction("appf2RuntimePress", (nodeId: string) => {
    const { token, projections } = dispatchAndRecord(runtime, nodeId);
    admitted.push(token);
    return projections;
  });
  await page.goto(harnessPage.url);
  await page.getByRole("button", { name: "加一分" }).click();
  await expect.poll(async () => (await presentationLog(page)).at(-1)?.settled?.status).toBe("COMMITTED");
  const fastLog = await presentationLog(page);
  const [clicked] = admitted;
  expect(clicked).toBeDefined();
  expect(percentsShownFor(fastLog, clicked ?? "")).toEqual([0, 0, 20, 40, 60, 80]);
  expect(fastLog.some((view) => view.settled?.operationToken === clicked && view.settled.status === "COMMITTED" && view.settled.percent === 100)).toBe(true);
  const presentedTokens = new Set(fastLog.flatMap((view) => (view.processing === null ? [] : [view.processing.operationToken])));
  expect(presentedTokens.size).toBe(2);
  expect(runtime.notices).toEqual(["action_go", "action_on_change"]);
  expect(runtime.runtime.readState("count")).toBe(1011);
  expect(await page.evaluate(() => window.appf2RuntimeHarness?.layerInsertions())).toBe(0);
  await expect(page.locator(".runtime-processing")).toHaveCount(0);

  // A slow interaction (a trusted step outlasts the soft deadline): the same real projections, delivered in F03
  // order while F03 is still processing, keep the App visible under the in-place layer with the last real %.
  const slowRuntime = await operationHarness(operationBlueprint(), {
    handlers: {
      "logic/score": instrumentedScore((clock) => {
        clock.ms += SOFT_DEADLINE_MS + 10;
      })
    }
  });
  const slow = dispatchAndRecord(slowRuntime, "node_go");
  const longWaitAt = slow.projections.findIndex((projection) => projection.operation_token === slow.token && projection.soft_timeout_observed);
  expect(longWaitAt).toBeGreaterThan(0);
  await deliver(page, slow.projections.slice(0, longWaitAt + 1));
  const layer = page.locator(".runtime-processing");
  await expect(layer).toBeVisible();
  await expect(layer).toContainText("正在確認互動可以執行…");
  await expect(layer).toContainText("還在處理這一步，你的內容都還在。");
  const shownPercent = (await presentationLog(page)).at(-1)?.processing?.percent;
  const longWait = slow.projections[longWaitAt];
  expect(shownPercent).toBe(Math.floor(((longWait?.completed_checkpoints ?? -1) * 100) / (longWait?.planned_checkpoints ?? 0)));
  await expect(layer.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(shownPercent));
  await expect(page.getByRole("heading", { name: "聚餐計分板" })).toBeVisible();
  await expect(page.getByRole("button", { name: "加一分" })).toBeVisible();

  await deliver(page, slow.projections.slice(longWaitAt + 1));
  await expect(layer).toHaveCount(0);
  const slowLog = await presentationLog(page);
  expect(slowLog.some((view) => view.settled?.operationToken === slow.token && view.settled.status === "COMMITTED" && view.settled.percent === 100)).toBe(true);
  expect(percentsShownFor(slowLog, slow.token).every((percent) => percent !== 100)).toBe(true);
  expect(slowLog.at(-1)?.processing).toBeNull();
});
