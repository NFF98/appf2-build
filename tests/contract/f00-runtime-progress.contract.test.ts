import { describe, expect, test } from "vitest";

import { operationPercent, RuntimeProcessingPresenter, type RuntimeProcessingView } from "../../src/app/runtime/runtime-processing.js";
import type { RuntimeOperationProjection } from "../../src/platform/runtime/runtime-operation.js";
import { operationBlueprint, operationHarness, pressOp, recordProjections, tokenOf } from "../runtime/runtime-operation-fixtures.js";

const projection = (fields: Partial<RuntimeOperationProjection>): RuntimeOperationProjection => ({
  operation_token: "op-contract",
  status: "PROCESSING",
  soft_timeout_observed: false,
  completed_checkpoints: 0,
  ...fields
});

describe("F00 checkpoint-derived Runtime progress", () => {
  test("TEST-F00-030 Runtime % reflects only completed planned checkpoints, floors, and reaches 100 only once F03 commits", async () => {
    const harness = await operationHarness(operationBlueprint());
    const projections = recordProjections(harness);
    const presenter = new RuntimeProcessingPresenter(harness.runtime);
    const views: RuntimeProcessingView[] = [];
    presenter.subscribe(() => views.push(presenter.getSnapshot()));

    // node_go plan = step:1..3, pre_commit, committed (5 checkpoints).
    const go = tokenOf(pressOp(harness, "node_go"));
    const goProjections = projections.filter((entry) => entry.operation_token === go);
    expect(goProjections.map((entry) => [entry.status, entry.last_completed_checkpoint_id ?? null, operationPercent(entry)])).toEqual([
      ["STARTED", null, 0],
      ["PROCESSING", null, 0],
      ["PROCESSING", "step:1", 20],
      ["PROCESSING", "step:2", 40],
      ["PROCESSING", "step:3", 60],
      ["PROCESSING", "pre_commit", 80],
      ["COMMITTED", "committed", 100]
    ]);
    const shown = views.flatMap((view) => (view.processing?.operationToken === go ? [view.processing.percent] : []));
    expect(shown).toEqual([0, 0, 20, 40, 60, 80]);
    expect(shown.every((percent, index) => index === 0 || (percent ?? 0) >= (shown[index - 1] ?? 0))).toBe(true);
    const settledGo = views.findIndex((view) => view.settled?.operationToken === go);
    expect(views[settledGo]?.settled).toEqual({ operationToken: go, status: "COMMITTED", percent: 100 });
    // The score change it caused is its own admitted operation, presented only after the first one committed.
    const chained = views.slice(settledGo).flatMap((view) => (view.processing === null ? [] : [view.processing.operationToken]));
    expect(chained.length).toBeGreaterThan(0);
    expect(chained.every((token) => token !== go)).toBe(true);
    expect(presenter.getSnapshot().processing).toBeNull();

    // node_plain plan = step:1, pre_commit, committed: 33.3… and 66.6… are floored, never rounded up.
    views.length = 0;
    const plain = tokenOf(pressOp(harness, "node_plain"));
    expect(views.flatMap((view) => (view.processing?.operationToken === plain ? [view.processing.percent] : []))).toEqual([0, 0, 33, 66]);
    expect(presenter.getSnapshot()).toEqual({ processing: null, settled: { operationToken: plain, status: "COMMITTED", percent: 100 } });

    // Commit-ready is not 100; no reliable plan means no percentage; inconsistent counts are not repaired.
    expect(operationPercent(projection({ completed_checkpoints: 4, planned_checkpoints: 5, last_completed_checkpoint_id: "pre_commit" }))).toBe(80);
    expect(operationPercent(projection({ completed_checkpoints: 5, planned_checkpoints: 5 }))).toBeNull();
    expect(operationPercent(projection({ status: "COMMITTED", completed_checkpoints: 0 }))).toBeNull();
    expect(operationPercent(projection({ completed_checkpoints: 6, planned_checkpoints: 5 }))).toBeNull();
    expect(operationPercent(projection({ completed_checkpoints: 1.5, planned_checkpoints: 5 }))).toBeNull();
    expect(operationPercent(projection({ completed_checkpoints: 1, planned_checkpoints: 0 }))).toBeNull();
    for (const status of ["FAILED", "TIMED_OUT", "CANCELLED"] as const) {
      expect(operationPercent(projection({ status, completed_checkpoints: 3, planned_checkpoints: 5 }))).toBe(60);
      expect(operationPercent(projection({ status, completed_checkpoints: 5, planned_checkpoints: 5 }))).toBeNull();
    }

    // A failure settles without 100%: the last real value stays and recovery belongs to F12.
    const failing = new RuntimeProcessingPresenter({
      subscribeOperations: (listener) => {
        listener(projection({ operation_token: "op-fail", status: "STARTED", planned_checkpoints: 5 }));
        listener(projection({ operation_token: "op-fail", completed_checkpoints: 2, planned_checkpoints: 5 }));
        listener(projection({ operation_token: "op-fail", status: "FAILED", completed_checkpoints: 2, planned_checkpoints: 5 }));
        return () => undefined;
      }
    });
    expect(failing.getSnapshot()).toEqual({ processing: null, settled: { operationToken: "op-fail", status: "FAILED", percent: 40 } });
  });
});
