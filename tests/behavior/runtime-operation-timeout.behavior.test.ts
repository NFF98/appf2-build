import { expect, test } from "vitest";

import type { LocalEffectPort } from "../../src/platform/runtime/capability-protocol.js";
import { singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { invariantBroken } from "../../src/platform/runtime/runtime-errors.js";
import type { RuntimeInstance } from "../../src/platform/runtime/runtime-instance.js";
import { assessCommittedIntegrity } from "../../src/platform/runtime/runtime-integrity.js";
import {
  actionCheckpointPlan,
  commitIneligibility,
  HARD_DEADLINE_MS,
  HardDeadlineExceeded,
  OperationGuard,
  RuntimeOperation,
  SOFT_DEADLINE_MS,
  type OperationGuardHost
} from "../../src/platform/runtime/runtime-operation.js";
import { blueprintWith, buttonNode, lit, node, press } from "../runtime/runtime-fixtures.js";
import {
  committedSnapshot,
  errorCodes,
  eventTypes,
  instrumentedScore,
  operationBlueprint,
  operationHarness,
  pressOp,
  projectionOf,
  tokenOf,
  treeRenderer
} from "../runtime/runtime-operation-fixtures.js";

const burn = (ms: number, onCall = 1) => instrumentedScore((clock, call) => {
  if (call === onCall) {
    clock.ms += ms;
  }
});

function operationAt(admittedMs: number, token = "op-1"): RuntimeOperation {
  return new RuntimeOperation({ token, instanceEpoch: 1, admittedMs, checkpointPlan: actionCheckpointPlan(1) });
}

function guardHost(operation: RuntimeOperation, nowMs: () => number, soft: string[] = []): OperationGuardHost {
  return {
    context: () => ({ current: operation, instanceEpoch: 1 }),
    now: nowMs,
    softTimeoutObserved: (observed) => soft.push(observed.token),
    checkpointCompleted: () => undefined
  };
}

test("TEST-F03-015 a failing node is isolated while the app keeps its last known good state", async () => {
  const blueprint = blueprintWith(
    {
      state: { count: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
      actions: [{ id: "action_go", steps: [{ type: "SET_STATE", target: "count", value: lit(7) }] }],
      nodes: [
        buttonNode("node_go", "action_go"),
        node("node_panel", "layout.container", "1.0.0", {
          props: { direction: lit("COLUMN"), gap: lit("MD"), align: lit("STRETCH") },
          children: ["node_inner"]
        }),
        buttonNode("node_inner", "action_go")
      ]
    },
    ["node_go", "node_panel"]
  );
  const harness = await operationHarness(blueprint);
  const first = harness.runtime.renderTree(treeRenderer(new Set(["node_panel"])));
  expect(first?.children.map((child) => child.id)).toEqual(["node_go", "node_panel"]);
  expect(first?.children[1]).toEqual({ id: "node_panel", fallback: "F03-ERR-013", children: [] });
  expect(harness.runtime.status).toBe("READY");

  const secondCalls: string[] = [];
  const second = harness.runtime.renderTree(treeRenderer(new Set(), secondCalls));
  expect(second?.children[1]).toEqual({ id: "node_panel", fallback: "F03-ERR-013", children: [] });
  expect(secondCalls).not.toContain("node_inner");
  expect(secondCalls).not.toContain("node_panel");
  expect(harness.runtime.nodeIsolation(singletonKey("node_panel"))).toMatchObject({ error_code: "F03-ERR-013", cause: "RENDER" });

  expect(press(harness, "node_inner")).toMatchObject({ accepted: false, reason: "NODE_ISOLATED" });
  expect(press(harness, "node_go")).toMatchObject({ accepted: true });
  expect(harness.runtime.readState("count")).toBe(7);
  expect(harness.runtime.status).toBe("READY");
});

test("TEST-F03-032 a hard-timed-out operation leaves no partial state, effect or emitted event", async () => {
  const executed: string[] = [];
  const effects: LocalEffectPort = { execute: (key, effect) => executed.push(`${key.node_id}:${effect.kind}`) };
  const slow = instrumentedScore(
    (clock, call) => {
      if (call === 1) {
        clock.ms += HARD_DEADLINE_MS + 50;
      }
    },
    { staged_effects: [{ kind: "VISUAL_EFFECT", request: { effect: "PULSE" } }] }
  );
  const harness = await operationHarness(operationBlueprint(), { handlers: { "logic/score": slow }, effects });
  const before = committedSnapshot(harness);

  const timedOut = pressOp(harness, "node_go");
  expect(projectionOf(timedOut)).toMatchObject({ status: "TIMED_OUT" });
  expect(committedSnapshot(harness)).toBe(before);
  expect(executed).toEqual([]);
  expect(harness.notices).toEqual([]);
  expect(harness.runtime.readState("count")).toBe(0);
  expect(harness.runtime.runtimeErrors().at(-1)).toMatchObject({
    code: "F03-ERR-021",
    action_id: "action_go",
    operation_token: tokenOf(timedOut),
    integrity_status: "PROVEN"
  });
  expect(harness.runtime.status).toBe("READY");

  const next = pressOp(harness, "node_plain");
  expect(projectionOf(next)).toMatchObject({ status: "COMMITTED" });
  expect(harness.runtime.readState("count")).toBe(100);
});

test("TEST-F03-033 stale or late completions never commit and terminal tokens are never reopened", async () => {
  const holder: { runtime?: RuntimeInstance } = {};
  const reentrant = instrumentedScore(() => holder.runtime?.dispose());
  const disposing = await operationHarness(operationBlueprint(), { handlers: { "logic/score": reentrant } });
  holder.runtime = disposing.runtime;
  const disposed = pressOp(disposing, "node_go");
  expect(projectionOf(disposed)).toMatchObject({ status: "CANCELLED" });
  expect(disposing.evidence.at(-1)).toMatchObject({ event_type: "F03-EVT-015", properties: { operation_token: tokenOf(disposed), discard_reason: "TOKEN_CLOSED" } });
  expect(disposing.runtime.actionSequence).toBe(0);
  expect(disposing.notices).toEqual([]);
  expect(errorCodes(disposing)).not.toContain("F03-ERR-021");

  const late = await operationHarness(operationBlueprint(), { handlers: { "logic/score": burn(HARD_DEADLINE_MS) } });
  const renderedBefore = late.runtime.renderTree(treeRenderer());
  const before = committedSnapshot(late);
  const lateToken = tokenOf(pressOp(late, "node_go"));
  const discarded = late.evidence.filter((record) => record.event_type === "F03-EVT-015");
  expect(discarded).toEqual([expect.objectContaining({ properties: expect.objectContaining({ operation_token: lateToken, discard_reason: "HARD_DEADLINE_ELAPSED" }) })]);
  expect(errorCodes(late).filter((code) => code === "F03-ERR-021")).toHaveLength(1);
  expect(committedSnapshot(late)).toBe(before);
  expect(late.runtime.renderTree(treeRenderer())).toEqual(renderedBefore);

  const retry = pressOp(late, "node_go");
  expect(tokenOf(retry)).not.toBe(lateToken);
  expect(projectionOf(retry)).toMatchObject({ status: "COMMITTED" });

  const closed = operationAt(0);
  closed.begin();
  closed.close("FAILED");
  expect(commitIneligibility(closed, { current: closed, instanceEpoch: 1, nowMs: 1 })).toBe("TOKEN_CLOSED");
  expect(closed.begin()).toBe(false);
  const superseded = operationAt(0, "op-2");
  expect(commitIneligibility(superseded, { current: operationAt(0, "op-3"), instanceEpoch: 1, nowMs: 1 })).toBe("TOKEN_NOT_CURRENT");
  expect(commitIneligibility(superseded, { current: superseded, instanceEpoch: 2, nowMs: 1 })).toBe("INSTANCE_EPOCH_MISMATCH");
  expect(commitIneligibility(superseded, { current: superseded, instanceEpoch: 1, nowMs: HARD_DEADLINE_MS })).toBe("HARD_DEADLINE_ELAPSED");
  expect(commitIneligibility(superseded, { current: superseded, instanceEpoch: 1, nowMs: HARD_DEADLINE_MS - 1 })).toBeUndefined();
});

test("TEST-F03-035 the mandatory pre-commit guard rejects work that crossed the hard deadline", async () => {
  const lateHandler = await operationHarness(operationBlueprint(), { handlers: { "logic/score": burn(HARD_DEADLINE_MS) } });
  pressOp(lateHandler, "node_go");
  expect(lateHandler.runtime.runtimeErrors().at(-1)?.message).toContain("HANDLER_RETURN");

  const crossing = await operationHarness(operationBlueprint());
  crossing.runtime.subscribeOperations((projection) => {
    if (projection.last_completed_checkpoint_id === "step:3") {
      crossing.clock.ms += HARD_DEADLINE_MS;
    }
  });
  const before = committedSnapshot(crossing);
  const crossed = pressOp(crossing, "node_go");
  expect(projectionOf(crossed)).toMatchObject({ status: "TIMED_OUT", last_completed_checkpoint_id: "step:3" });
  expect(crossing.runtime.runtimeErrors().at(-1)).toMatchObject({ code: "F03-ERR-021", operation_token: tokenOf(crossed) });
  expect(crossing.runtime.runtimeErrors().at(-1)?.message).toContain("PRE_COMMIT");
  expect(crossing.evidence.filter((record) => record.event_type === "F03-EVT-015")).toEqual([
    expect.objectContaining({ properties: expect.objectContaining({ operation_token: tokenOf(crossed), discard_reason: "HARD_DEADLINE_ELAPSED" }) })
  ]);
  expect(committedSnapshot(crossing)).toBe(before);

  let now = 0;
  const soft: string[] = [];
  const operation = operationAt(0);
  operation.begin();
  const guard = new OperationGuard(operation, guardHost(operation, () => now, soft));
  now = SOFT_DEADLINE_MS;
  guard.check("STEP_BEFORE");
  guard.check("STEP_AFTER");
  expect(soft).toEqual(["op-1"]);
  now = HARD_DEADLINE_MS;
  const stepFailure = captureDeadline(() => guard.check("STEP_BEFORE"));
  expect(stepFailure).toMatchObject({ code: "F03-ERR-021", boundary: "STEP_BEFORE", lateCompletion: false });
  const preCommitFailure = captureDeadline(() => guard.check("PRE_COMMIT"));
  expect(preCommitFailure).toMatchObject({ code: "F03-ERR-021", boundary: "PRE_COMMIT", lateCompletion: true });
});

test("TEST-F03-036 integrity that cannot be proven fails closed to F03-ERR-018", async () => {
  const cases = [
    {
      integrity: "ASSURANCE_DEGRADED",
      handler: instrumentedScore((clock) => {
        clock.ms -= 1;
      })
    },
    {
      integrity: "UNKNOWN",
      handler: instrumentedScore((clock) => {
        clock.ms = Number.NaN;
      })
    },
    {
      integrity: "CORRUPTED",
      handler: instrumentedScore((clock) => {
        clock.ms += HARD_DEADLINE_MS;
        invariantBroken("handler state invariant broken");
      })
    }
  ] as const;
  for (const { integrity, handler } of cases) {
    const harness = await operationHarness(operationBlueprint(), { handlers: { "logic/score": handler } });
    harness.clock.ms = 10;
    const before = committedSnapshot(harness);
    const result = pressOp(harness, "node_go");
    expect(projectionOf(result).status, integrity).toBe("FAILED");
    expect(harness.runtime.status, integrity).toBe("FATAL_ERROR");
    expect(errorCodes(harness), integrity).toContain("F03-ERR-018");
    expect(errorCodes(harness), integrity).not.toContain("F03-ERR-021");
    expect(eventTypes(harness), integrity).not.toContain("F03-EVT-014");
    expect(harness.evidence.at(-1), integrity).toMatchObject({ event_type: "F03-EVT-010", error_code: "F03-ERR-018", properties: { integrity_status: integrity } });
    expect(committedSnapshot(harness), integrity).toBe(before);
    expect(press(harness, "node_plain"), integrity).toMatchObject({ accepted: false, reason: "INSTANCE_NOT_READY" });
  }

  expect(assessCommittedIntegrity(3, 3, true)).toBe("PROVEN");
  expect(assessCommittedIntegrity(3, 4, true)).toBe("CORRUPTED");
  expect(assessCommittedIntegrity(undefined, 3, true)).toBe("UNKNOWN");
  expect(assessCommittedIntegrity(3, undefined, true)).toBe("UNKNOWN");
  expect(assessCommittedIntegrity(3, 3, false)).toBe("UNKNOWN");
});

function captureDeadline(run: () => void): HardDeadlineExceeded {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof HardDeadlineExceeded) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the hard deadline guard to reject");
}
