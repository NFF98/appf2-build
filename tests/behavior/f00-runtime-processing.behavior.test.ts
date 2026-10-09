import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { RuntimeProcessingLayer } from "../../src/app/runtime/RuntimeProcessingLayer.js";
import { RuntimeProcessingPresenter, type RuntimeProcessingView } from "../../src/app/runtime/runtime-processing.js";
import { SOFT_DEADLINE_MS } from "../../src/platform/runtime/runtime-operation.js";
import { instrumentedScore, operationBlueprint, operationHarness, pressOp, tokenOf } from "../runtime/runtime-operation-fixtures.js";

const BURN_MS = SOFT_DEADLINE_MS + 10;

afterEach(() => {
  vi.useRealTimers();
});

describe("F00 Runtime processing timing", () => {
  test("TEST-F00-031 Runtime processing adds no delay: the Shell never holds an operation open or schedules work to make loading visible", async () => {
    vi.useFakeTimers();

    // Fast path: GLOBAL_PROCESSING exists logically, and the operation is already settled when dispatch returns.
    const fast = await operationHarness(operationBlueprint());
    const presenter = new RuntimeProcessingPresenter(fast.runtime);
    const views: RuntimeProcessingView[] = [];
    presenter.subscribe(() => views.push(presenter.getSnapshot()));
    const startedAt = fast.clock.now();
    const token = tokenOf(pressOp(fast, "node_plain"));
    expect(views.some((view) => view.processing?.operationToken === token)).toBe(true);
    expect(presenter.getSnapshot()).toEqual({ processing: null, settled: { operationToken: token, status: "COMMITTED", percent: 100 } });
    expect(renderToStaticMarkup(createElement(RuntimeProcessingLayer, { presenter }))).toBe("");
    expect(fast.clock.now()).toBe(startedAt);
    expect(fast.scheduler.activeWakes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    // Slow path: a trusted step really takes longer than the soft deadline. The layer shows the last real % and the
    // long-wait copy while F03 is busy, and the operation ends exactly when F03 commits it — no extra time.
    const slow = await operationHarness(operationBlueprint(), {
      handlers: {
        "logic/score": instrumentedScore((clock) => {
          clock.ms += BURN_MS;
        })
      }
    });
    const slowPresenter = new RuntimeProcessingPresenter(slow.runtime);
    const markups: string[] = [];
    slowPresenter.subscribe(() => {
      if (slowPresenter.getSnapshot().processing?.longWait === true) markups.push(renderToStaticMarkup(createElement(RuntimeProcessingLayer, { presenter: slowPresenter })));
    });
    const slowStart = slow.clock.now();
    const slowToken = tokenOf(pressOp(slow, "node_go"));
    expect(markups.length).toBeGreaterThan(0);
    expect(markups[0]).toContain("還在處理這一步，你的內容都還在。");
    expect(markups[0]).toContain('role="progressbar"');
    expect(markups[0]).not.toContain('aria-valuenow="100"');
    expect(slow.notices[0]).toBe("action_go");
    expect(slow.runtime.runtimeErrors()).toEqual([]);
    expect(slowPresenter.getSnapshot().processing).toBeNull();
    expect(slow.clock.now() - slowStart).toBe(BURN_MS);
    expect(slow.scheduler.activeWakes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    const settled: string[] = [];
    slowPresenter.subscribe(() => {
      const view = slowPresenter.getSnapshot().settled;
      if (view !== null) settled.push(`${view.operationToken}:${view.status}:${view.percent}`);
    });
    vi.advanceTimersByTime(60_000);
    expect(settled).toEqual([]);
    expect(slowToken).not.toBe(token);
  });
});
