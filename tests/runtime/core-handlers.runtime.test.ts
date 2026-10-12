import { describe, expect, test } from "vitest";

import type { CapabilityInvokeContext, TrustedCapabilityHandler } from "../../src/platform/runtime/capability-protocol.js";
import { CORE_CAPABILITY_HANDLERS } from "../../src/platform/runtime/core-handlers.js";
import { observeTimer, startTimer, idleTimer } from "../../src/platform/runtime/monotonic-timer.js";
import type { NodeInstanceKey } from "../../src/platform/runtime/node-instance-key.js";
import type { RuntimeRecord } from "../../src/platform/runtime/runtime-value.js";

const KEY = "node_x" as unknown as NodeInstanceKey;

function handler(key: string): TrustedCapabilityHandler {
  const found = CORE_CAPABILITY_HANDLERS.get(key);
  if (found === undefined) throw new Error(`missing handler ${key}`);
  return found;
}

function context(props: RuntimeRecord, overrides: Partial<CapabilityInvokeContext> = {}): CapabilityInvokeContext {
  return {
    node: { node_id: "node_x", capability: { id: "x", version: "1.0.0" } as never, props },
    rng: { nextUint32: () => 0 },
    clock: { now: () => 1_000 },
    ...overrides
  };
}

describe("core trusted capability handlers", () => {
  test("logic.score increments, sets and resets to its initial value and rejects non-finite results", () => {
    const score = handler("logic/score");
    const ctx = context({ initial: 5 });
    const state = score.initialize(KEY, { node: ctx.node });
    expect(state).toEqual({ value: 5 });
    expect(score.invoke(KEY, "increment", { delta: 3 }, state, ctx)).toEqual({
      status: "SUCCESS",
      capability_state_patch: { value: 8 },
      emitted_events: [{ event_name: "change", payload: { value: 8 } }]
    });
    expect(score.invoke(KEY, "set", { value: -2 }, state, ctx).capability_state_patch).toEqual({ value: -2 });
    expect(score.invoke(KEY, "reset", {}, { value: 99 }, ctx).capability_state_patch).toEqual({ value: 5 });
    expect(score.invoke(KEY, "increment", { delta: "3" }, state, ctx).status).toBe("FAILURE");
    expect(score.invoke(KEY, "set", { value: Number.POSITIVE_INFINITY }, state, ctx).status).toBe("FAILURE");
    expect(score.invoke(KEY, "explode", {}, state, ctx).status).toBe("FAILURE");
  });

  test("logic.random choose_item draws uniformly via rejection sampling and sample_number fails closed", () => {
    const random = handler("logic/random");
    const draws = [0xffff_ffff, 7];
    const rng = { nextUint32: () => draws.shift() ?? 0 };
    const chosen = random.invoke(KEY, "choose_item", { items: ["甲", "乙", "丙"] }, {}, context({}, { rng }));
    // 0xffffffff lies in the biased tail for size 3 and is redrawn; 7 % 3 = 1.
    expect(chosen).toEqual({ status: "SUCCESS", capability_state_patch: { last_index: 1, last_item: "乙" } });
    expect(draws).toEqual([]);
    expect(random.invoke(KEY, "choose_item", { items: [] }, {}, context({})).status).toBe("FAILURE");
    expect(random.invoke(KEY, "choose_item", { items: [1] }, {}, context({})).status).toBe("FAILURE");
    expect(random.invoke(KEY, "sample_number", { min: 0, max: 10 }, {}, context({}))).toMatchObject({ status: "FAILURE" });
  });

  test("logic.timer transitions only from its source status and leaves the monotonic anchor to the Runtime", () => {
    const timer = handler("logic/timer");
    const ctx = context({ duration_ms: 5_000 });
    const idle = timer.initialize(KEY, { node: ctx.node });
    expect(idle).toEqual({ status: "IDLE", duration_ms: 5_000, remaining_ms: 5_000 });

    const started = timer.invoke(KEY, "start", {}, idle, ctx);
    expect(started.capability_state_patch).toEqual({ status: "RUNNING", remaining_ms: 5_000 });
    expect(started.staged_effects).toEqual([{ kind: "SCHEDULE_TIMER", timer: startTimer(idleTimer(5_000), 1_000), completion_event: "complete" }]);

    const running = { ...idle, status: "RUNNING" };
    const armed = observeTimer(startTimer(idleTimer(5_000), 1_000), 3_000);
    const paused = timer.invoke(KEY, "pause", {}, running, context({}, { clock: { now: () => 3_000 }, timer: armed }));
    expect(paused).toEqual({ status: "SUCCESS", capability_state_patch: { status: "PAUSED", remaining_ms: 3_000 }, staged_effects: [{ kind: "CANCEL_TIMER" }] });

    const resumed = timer.invoke(KEY, "resume", {}, { ...running, status: "PAUSED", remaining_ms: 3_000 }, context({}, { clock: { now: () => 10_000 } }));
    expect(resumed.capability_state_patch).toEqual({ status: "RUNNING" });
    expect(resumed.staged_effects).toEqual([
      { kind: "SCHEDULE_TIMER", timer: { status: "RUNNING", duration_ms: 5_000, elapsed_offset_ms: 2_000, anchor_ms: 10_000 }, completion_event: "complete" }
    ]);

    // RUNNING without an armed slot has completed: start / pause / resume are no-ops, reset still returns to IDLE.
    for (const action of ["start", "pause", "resume"]) expect(timer.invoke(KEY, action, {}, running, ctx)).toEqual({ status: "SUCCESS" });
    expect(timer.invoke(KEY, "reset", {}, running, ctx)).toEqual({
      status: "SUCCESS",
      capability_state_patch: { status: "IDLE", remaining_ms: 5_000 },
      staged_effects: [{ kind: "CANCEL_TIMER" }]
    });
    expect(timer.invoke(KEY, "start", {}, undefined, ctx).status).toBe("FAILURE");
  });

  test("presentation and input capabilities declare no actions", () => {
    for (const key of ["input/number", "data/stat", "layout/container"]) {
      expect(handler(key).invoke(KEY, "anything", {}, undefined, context({})).status).toBe("FAILURE");
    }
  });
});
