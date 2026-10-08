import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, vi } from "vitest";

import type { BlueprintNode } from "../../src/platform/blueprint/validation-types.js";
import { CloneLifecycleRegistry, type CloneIncarnation, type CloneLifecycleHost } from "../../src/platform/runtime/clone-lifecycle.js";
import { buildExecutionIndex, type ExecutionIndex, type NodeExecution } from "../../src/platform/runtime/execution-index.js";
import { idleTimer, startTimer, TimerWakeService } from "../../src/platform/runtime/monotonic-timer.js";
import { singletonKey, type NodeInstanceKey } from "../../src/platform/runtime/node-instance-key.js";
import { assertLocalStateWithinBudget, assertStaticResourceCeilings, assertTimerCeilings, localStateBytes } from "../../src/platform/runtime/resource-guard.js";
import { invariantBroken, RuntimeFailure } from "../../src/platform/runtime/runtime-errors.js";
import { IntegrityFailure } from "../../src/platform/runtime/runtime-integrity.js";
import { RuntimeOperation, staleReason } from "../../src/platform/runtime/runtime-operation.js";
import { admit } from "./execution-safety-fixtures.js";
import {
  admittedBlueprint,
  blueprintWith,
  buttonNode,
  capabilityState,
  hydratedHarness,
  lit,
  node,
  PINNED,
  press,
  runtimeHarness,
  scoreHandler,
  snapshot,
  state,
  timerHandler,
  viewHandler
} from "../runtime/runtime-fixtures.js";
import {
  addCount,
  cloneKey,
  committedSnapshot,
  EPISODE,
  errorCodes,
  eventTypes,
  instrumentedScore,
  operationBlueprint,
  operationHarness,
  pressOp,
  projectionOf,
  tokenOf,
  TOKEN_PATTERN,
  treeRenderer
} from "../runtime/runtime-operation-fixtures.js";


/** Repeat list whose score clones initialize from their row item; buttons rewrite `rows`. */
function rowsBlueprint(initial: readonly number[], maxItems = 3, maxLength = 5) {
  return blueprintWith(
    {
      state: {
        count: { mode: "MUTABLE", type: "NUMBER", initial: 0 },
        rows: { mode: "MUTABLE", type: "LIST", initial: [...initial], constraints: { item: { type: "NUMBER" }, max_length: maxLength } }
      },
      actions: [
        { id: "action_shrink", steps: [{ type: "SET_STATE", target: "rows", value: lit([1]) }] },
        { id: "action_grow", steps: [{ type: "SET_STATE", target: "rows", value: lit([1, 7, 9]) }] },
        { id: "action_row", steps: [addCount(1)] },
        { id: "action_kick", steps: [addCount(0)] }
      ],
      nodes: [
        buttonNode("node_shrink", "action_shrink"),
        buttonNode("node_grow", "action_grow"),
        buttonNode("node_kick", "action_kick"),
        node("node_rows", "content.list", "1.0.0", { repeat: { items: state("rows"), item_alias: "row", max_items: maxItems }, children: ["node_row_score"] }),
        node("node_row_score", "logic.score", "1.0.0", { props: { initial: lit(5), min: lit(0), max: lit(1000) }, events: { change: "action_row" } })
      ]
    },
    ["node_shrink", "node_grow", "node_kick", "node_rows"]
  );
}

const rowClone = (index: number) => cloneKey("node_row_score", "node_rows", index);

type Budget = NodeExecution["resources"]["budget"];

/** Pinned F04 entries, optionally with one capability's budget tightened. */
function pinnedBinder(override?: { readonly capabilityId: string; readonly budget: Partial<Budget> }) {
  return (blueprintNode: BlueprintNode) => {
    const { id, version } = blueprintNode.capability;
    const entry = PINNED.validator_registry.capabilities[id]?.[version] ?? invariantBroken(`No pinned validator for ${id}@${version}.`);
    const budget = override?.capabilityId === id ? { ...entry.resource_budget, ...override.budget } : entry.resource_budget;
    return { validator: entry.validator, handler: viewHandler, resources: { budget, usage: entry.resource_usage } };
  };
}

async function admittedIndex(override?: { readonly capabilityId: string; readonly budget: Partial<Budget> }): Promise<ExecutionIndex> {
  const harness = await hydratedHarness(rowsBlueprint([1, 2, 3]));
  const blueprint = harness.runtime.blueprint ?? invariantBroken("hydrated Blueprint missing");
  return buildExecutionIndex(blueprint, pinnedBinder(override));
}

function executionOf(index: ExecutionIndex, nodeId: string): NodeExecution {
  return index.nodeById.get(nodeId) ?? invariantBroken(`missing ${nodeId}`);
}

test("TEST-F03-AC-014 a Blueprint can never inject a runtime handler or executable JS", async () => {
  const injected = "(() => { globalThis.__appf2Injected = true; return 'pwned'; })()";
  const scriptBlueprint = blueprintWith({
    actions: [{ id: "action_go", steps: [{ type: "SET_STATE", target: "label", value: lit(injected) }] }],
    state: { label: { mode: "MUTABLE", type: "STRING", initial: injected, constraints: { max_length: 200 } } },
    nodes: [node("node_go", "action.button", "1.0.0", { props: { label: lit(injected) }, events: { press: "action_go" } })]
  });
  const harness = await hydratedHarness(scriptBlueprint);
  press(harness, "node_go");
  const tree = harness.runtime.renderTree(treeRenderer());
  expect(tree?.children[0]?.props).toEqual({ label: injected });
  expect(harness.runtime.readState("label")).toBe(injected);
  expect(Reflect.get(globalThis, "__appf2Injected")).toBeUndefined();

  const withHandlerField = operationBlueprint();
  const nodes = withHandlerField.nodes as Record<string, unknown>[];
  nodes[1] = { ...nodes[1], handler: "function () { return globalThis; }" };
  await expect(admittedBlueprint(withHandlerField)).rejects.toThrow(/F02-ERR-002/);

  const admitted = await admittedBlueprint(operationBlueprint());
  const tampered = (typeof admitted.body === "string" ? JSON.parse(admitted.body) : structuredClone(admitted.body)) as Record<string, unknown>;
  (tampered.nodes as Record<string, unknown>[])[1] = { ...(tampered.nodes as Record<string, unknown>[])[1], handler: "eval('1')" };
  const forged = await runtimeHarness(operationBlueprint(), { body: JSON.stringify(tampered) });
  expect(await forged.runtime.hydrate()).toMatchObject({ status: "FATAL_ERROR", error: { code: "F03-ERR-001" } });

  const noBundledHandlers = await runtimeHarness(operationBlueprint(), { trust: { handlers: new Map() } });
  expect(await noBundledHandlers.runtime.hydrate()).toMatchObject({ status: "FATAL_ERROR", error: { code: "F03-ERR-003" } });
});

test("TEST-F03-018 a revoked or incompatible Blueprint never reaches READY", async () => {
  const blueprint = operationBlueprint();
  for (const trustStatus of ["REVOKED", "INCOMPATIBLE"]) {
    const decision = await admit(blueprint, { pinned: PINNED, content: { trust_status: trustStatus } });
    expect(decision.executable, trustStatus).toBe(false);
  }
  const cases = [
    { label: "revoked admission", admission: { trust_status: "REVOKED" }, code: "F03-ERR-001" },
    { label: "incompatible admission", admission: { trust_status: "INCOMPATIBLE" }, code: "F03-ERR-001" },
    { label: "incompatible runtime", admission: { runtime_version: "9.0.0" }, code: "F03-ERR-002" },
    { label: "incompatible registry", admission: { registry_digest: `sha256:${"0".repeat(64)}` }, code: "F03-ERR-003" }
  ];
  for (const { label, admission, code } of cases) {
    const harness = await runtimeHarness(blueprint, { admission });
    expect(await harness.runtime.hydrate(), label).toMatchObject({ status: "FATAL_ERROR", error: { code } });
    expect(harness.runtime.status, label).toBe("FATAL_ERROR");
    expect(eventTypes(harness), label).toEqual(["F03-EVT-001", "F03-EVT-003"]);
    expect(press(harness, "node_go"), label).toEqual({ accepted: false, reason: "INSTANCE_NOT_READY" });
  }
});

test("TEST-F03-019 dispose and clone de-materialization revoke resources and late callbacks; regrow is a fresh lifecycle", async () => {
  const initialized: string[] = [];
  const disposed: string[] = [];
  const rowScore = {
    initialize: (key: NodeInstanceKey, context: Parameters<typeof scoreHandler.initialize>[1]) => {
      initialized.push(JSON.stringify(key.repeat_coordinates));
      return scoreHandler.initialize(key, context);
    },
    invoke: scoreHandler.invoke,
    dispose: (key: NodeInstanceKey) => {
      disposed.push(JSON.stringify(key.repeat_coordinates));
    }
  };
  const harness = await operationHarness(rowsBlueprint([1, 2, 3]), { handlers: { "logic/score": rowScore } });
  expect([0, 1, 2].map((index) => harness.runtime.lifecycleGeneration(rowClone(index)))).toEqual([1, 1, 1]);
  expect(harness.runtime.readCapabilityState(rowClone(1))).toEqual({ value: 5 });

  let pendingCloneEvent: ReturnType<typeof harness.runtime.dispatchRuntimeEvent> | undefined;
  const unsubscribe = harness.runtime.subscribe((notice) => {
    if (notice.action_id === "action_kick") {
      pressOp(harness, "node_shrink");
      pendingCloneEvent = harness.runtime.dispatchRuntimeEvent({ source_node_instance_key: rowClone(2), event_name: "change", payload: { value: 1 }, origin: "USER" });
    }
  });
  press(harness, "node_kick");
  unsubscribe();
  expect(pendingCloneEvent && projectionOf(pendingCloneEvent).status).toBe("CANCELLED");
  expect(harness.runtime.readState("count")).toBe(0);
  expect(harness.runtime.lifecycleGeneration(rowClone(1))).toBeUndefined();
  expect(harness.runtime.readCapabilityState(rowClone(1))).toBeUndefined();
  expect(disposed).toEqual([JSON.stringify(rowClone(1).repeat_coordinates), JSON.stringify(rowClone(2).repeat_coordinates)]);
  expect(harness.runtime.dispatch({ source_node_instance_key: rowClone(2), event_name: "change", payload: { value: 1 }, origin: "USER" })).toEqual({
    accepted: false,
    reason: "INVALID_NODE_INSTANCE_KEY"
  });

  press(harness, "node_grow");
  expect(harness.runtime.lifecycleGeneration(rowClone(1))).toBe(2);
  expect(harness.runtime.lifecycleGeneration(rowClone(0))).toBe(1);
  expect(harness.runtime.readCapabilityState(rowClone(1))).toEqual({ value: 5 });
  expect(initialized.filter((coordinates) => coordinates === JSON.stringify(rowClone(1).repeat_coordinates))).toHaveLength(2);
  const stale = { source_node_instance_key: rowClone(1), event_name: "change", payload: { value: 1 }, origin: "USER" as const, lifecycle_generation: 1 };
  expect(harness.runtime.dispatch(stale)).toEqual({ accepted: false, reason: "STALE_LIFECYCLE_GENERATION" });
  expect(harness.runtime.dispatch({ ...stale, lifecycle_generation: 2 })).toEqual({ accepted: true, sequence: expect.any(Number) });
  expect(harness.runtime.readState("count")).toBe(1);

  const order: string[] = [];
  const registry = new CloneLifecycleRegistry();
  const held = new Set<string>();
  const host = (failRevoke: boolean, leak: boolean): CloneLifecycleHost<{ readonly key: NodeInstanceKey }> => ({
    cancelPending: (removed) => order.push(`cancel:${[...removed].join(",")}`),
    revokeHostResources: (incarnation: CloneIncarnation) => {
      order.push(`revoke:${incarnation.keyId}`);
      if (failRevoke) {
        throw new Error("scheduler cancel failed");
      }
    },
    disposeHandler: (incarnation) => order.push(`dispose:${incarnation.keyId}`),
    releaseLocalState: (incarnation) => {
      order.push(`release:${incarnation.keyId}`);
      if (!leak) {
        held.delete(incarnation.keyId);
      }
    },
    retainsResources: (incarnation) => held.has(incarnation.keyId),
    teardownStepFailed: (incarnation, step) => order.push(`failed:${step}:${incarnation.keyId}`),
    initialize: (incarnation) => {
      held.add(incarnation.keyId);
      order.push(`init:${incarnation.keyId}#${incarnation.generation}`);
    }
  });
  const a = { key: singletonKey("node_a") };
  registry.reconcile([a], host(false, false));
  registry.reconcile([], host(true, false));
  registry.reconcile([a], host(false, false));
  expect(order).toEqual(["init:node_a#1", "cancel:node_a", "revoke:node_a", "failed:REVOKE_HOST_RESOURCES:node_a", "dispose:node_a", "release:node_a", "init:node_a#2"]);
  expect(() => registry.reconcile([], host(false, true))).toThrow(IntegrityFailure);

  const instance = await operationHarness(
    blueprintWith({
      actions: [{ id: "action_start", steps: [{ type: "INVOKE_CAPABILITY", target_node_id: "node_timer", capability_action: "start", args: {} }] }, { id: "action_done", steps: [addCount(1)] }],
      state: { count: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
      nodes: [buttonNode("node_start", "action_start"), node("node_timer", "logic.timer", "1.0.0", { props: { duration_ms: lit(1000) }, events: { complete: "action_done" } })]
    }),
    { handlers: { "logic/timer": { ...timerHandler, dispose: (key) => disposed.push(`timer:${key.node_id}`) } } }
  );
  const schedule = instance.scheduler.schedule.bind(instance.scheduler);
  vi.spyOn(instance.scheduler, "schedule").mockImplementation((delay, wake) => {
    schedule(delay, wake);
    return () => {
      throw new Error("late callbacks cannot be cancelled");
    };
  });
  const operations: string[] = [];
  instance.runtime.subscribeOperations((projection) => operations.push(projection.status));
  press(instance, "node_start");
  expect(instance.runtime.timerObservation(singletonKey("node_timer"))).toBeDefined();
  instance.runtime.dispose();
  const after = [...operations];
  instance.scheduler.advance(5_000);
  expect(instance.runtime.status).toBe("DISPOSED");
  expect(instance.runtime.instanceEpoch).toBe(1);
  expect(instance.runtime.readState("count")).toBe(0);
  expect(instance.runtime.timerObservation(singletonKey("node_timer"))).toBeUndefined();
  expect(instance.runtime.readCapabilityState(singletonKey("node_timer"))).toBeUndefined();
  expect(disposed).toContain("timer:node_timer");
  expect(operations).toEqual(after);
  expect(instance.notices).toEqual(["action_start"]);
  expect(press(instance, "node_start")).toEqual({ accepted: false, reason: "INSTANCE_DISPOSED", error_code: "F03-ERR-020" });

  const wakes = new TimerWakeService(instance.clock, {
    schedule: (delay, wake) => {
      instance.scheduler.schedule(delay, wake);
      return () => {
        throw new Error("cancel failed");
      };
    }
  });
  const fired: string[] = [];
  wakes.arm("slot", startTimer(idleTimer(10), instance.clock.now()), () => fired.push("slot"));
  expect(() => wakes.disarm("slot")).toThrow("cancel failed");
  expect(wakes.isArmed("slot")).toBe(false);
  instance.scheduler.advance(100);
  expect(fired).toEqual([]);
});

test("TEST-F03-AC-020 the Runtime never relaxes F02 / F04 resource ceilings", async () => {
  const capped = await hydratedHarness(rowsBlueprint([1, 2, 3, 4, 5]));
  expect(capped.runtime.nodeInstances().filter((instance) => instance.key.node_id === "node_row_score")).toHaveLength(3);
  expect(capped.runtime.dispatch({ source_node_instance_key: rowClone(3), event_name: "change", payload: { value: 1 }, origin: "USER" })).toEqual({
    accepted: false,
    reason: "INVALID_NODE_INSTANCE_KEY"
  });

  const timerless = await operationHarness(operationBlueprint(), {
    handlers: { "logic/score": instrumentedScore(() => undefined, { staged_effects: [{ kind: "SCHEDULE_TIMER", timer: startTimer(idleTimer(50), 0), completion_event: "change" }] }) }
  });
  const before = committedSnapshot(timerless);
  pressOp(timerless, "node_go");
  expect(committedSnapshot(timerless)).toBe(before);
  expect(timerless.runtime.runtimeErrors().at(-1)).toMatchObject({ code: "F03-ERR-011", capability_id: "logic.score", action_id: "action_go" });
  expect(timerless.runtime.timerObservation(singletonKey("node_score"))).toBeUndefined();

  const index = await admittedIndex();
  const score = executionOf(index, "node_row_score");
  const tight = { ...score, resources: { ...score.resources, budget: { ...score.resources.budget, maxLocalStateBytes: localStateBytes({ value: 1234 }) } } };
  expect(() => assertLocalStateWithinBudget(tight, { value: 1234 }, "F03-ERR-011")).not.toThrow();
  expect(() => assertLocalStateWithinBudget(tight, { value: 12345 }, "F03-ERR-011")).toThrow(RuntimeFailure);
  expect(localStateBytes({ b: 1, a: "é" })).toBe(new TextEncoder().encode('{"a":"é","b":1}').byteLength);

  expect(() => assertStaticResourceCeilings(index)).not.toThrow();
  const overInstances = await admittedIndex({ capabilityId: "logic.score", budget: { maxInstancesPerBlueprint: 2 } });
  expect(() => assertStaticResourceCeilings(overInstances)).toThrow(expect.objectContaining({ code: "F03-ERR-001", capabilityId: "logic.score" }));

  const timerIndex = buildExecutionIndex(
    (await hydratedHarness(blueprintWith({ nodes: [node("node_timer", "logic.timer", "1.0.0", { props: { duration_ms: lit(10) } })] }))).runtime.blueprint ?? invariantBroken("blueprint"),
    pinnedBinder()
  );
  const timerSlot = (id: number) => ({ source: { node_id: "node_timer", repeat_coordinates: [{ repeat_node_id: "node_rows", item_index: id }] }, effect: { kind: "SCHEDULE_TIMER" as const, timer: startTimer(idleTimer(10), 0), completion_event: "complete" } });
  expect(() => assertTimerCeilings(timerIndex, [], [timerSlot(0)])).not.toThrow();
  expect(() => assertTimerCeilings(timerIndex, [], Array.from({ length: 11 }, (_, slot) => timerSlot(slot)))).toThrow(expect.objectContaining({ code: "F03-ERR-011" }));
  expect(() => assertTimerCeilings(index, [], [{ source: singletonKey("node_shrink"), effect: timerSlot(0).effect }])).toThrow(expect.objectContaining({ code: "F03-ERR-011" }));
});

test("TEST-F03-022 the Runtime never writes PostgreSQL or any server per interaction", async () => {
  const runtimeDir = join(process.cwd(), "src", "platform", "runtime");
  const forbidden = [/from\s+["'](pg|postgres)["']/, /postgres-/, /from\s+["']node:(net|http|https|tls|dgram)["']/, /\bfetch\s*\(/, /XMLHttpRequest|WebSocket|sendBeacon/];
  for (const file of readdirSync(runtimeDir).filter((name) => name.endsWith(".ts"))) {
    const source = readFileSync(join(runtimeDir, file), "utf8");
    for (const pattern of forbidden) {
      expect(pattern.test(source), `${file} ${pattern}`).toBe(false);
    }
  }
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is not part of the Runtime path"));
  try {
    const harness = await operationHarness(operationBlueprint(), { sampled: true });
    for (let click = 0; click < 50; click += 1) {
      pressOp(harness, click % 2 === 0 ? "node_go" : "node_plain");
    }
    expect(harness.runtime.actionSequence).toBe(75);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});

test("TEST-F03-AC-025 every Runtime failure keeps the last complete committed state", async () => {
  let mode: "ok" | "fail" | "slow" | "corrupt" = "ok";
  const handler = instrumentedScore((clock) => {
    if (mode === "slow") {
      clock.ms += 400;
    }
    if (mode === "corrupt") {
      invariantBroken("handler observed a broken invariant");
    }
  });
  const flaky = { ...handler, invoke: (...args: Parameters<typeof handler.invoke>) => (mode === "fail" ? { status: "FAILURE" as const, error: "no" } : handler.invoke(...args)) };
  const harness = await operationHarness(operationBlueprint(), { handlers: { "logic/score": flaky } });
  pressOp(harness, "node_go");
  const committed = snapshot(harness, ["count"], ["node_score"]);
  expect(committed).toMatchObject({ "state:count": 1011, "capability:node_score": { value: 1 }, action_sequence: 2 });

  for (const failing of ["fail", "slow", "corrupt"] as const) {
    mode = failing;
    pressOp(harness, "node_go");
    expect(snapshot(harness, ["count"], ["node_score"]), failing).toEqual(committed);
  }
  expect(errorCodes(harness)).toEqual(["F03-ERR-011", "F03-ERR-021", "F03-ERR-018"]);
  expect(harness.runtime.status).toBe("FATAL_ERROR");
});

test("TEST-F03-AC-027 node isolation carries capability, node and error context", async () => {
  const harness = await operationHarness(operationBlueprint());
  harness.runtime.renderTree(treeRenderer(new Set(["node_score"])));
  const key = singletonKey("node_score");
  expect(harness.runtime.nodeIsolation(key)).toEqual({
    node_instance_key: key,
    node_id: "node_score",
    capability_id: "logic.score",
    error_code: "F03-ERR-013",
    message: "Node renderer threw.",
    cause: "RENDER",
    lifecycle_generation: 1
  });
  expect(harness.runtime.runtimeErrors().at(-1)).toEqual({ code: "F03-ERR-013", message: "Node renderer threw.", capability_id: "logic.score", node_instance_key: key });
  expect(harness.evidence.at(-1)).toMatchObject({ event_type: "F03-EVT-007", capability_id: "logic.score", error_code: "F03-ERR-013" });

  const failingInit = {
    ...scoreHandler,
    initialize: (initKey: NodeInstanceKey, context: Parameters<typeof scoreHandler.initialize>[1]) => {
      if (initKey.repeat_coordinates[0]?.item_index === 2) {
        throw new Error("clone init failed");
      }
      return scoreHandler.initialize(initKey, context);
    }
  };
  const rows = await operationHarness(rowsBlueprint([1]), { handlers: { "logic/score": failingInit } });
  press(rows, "node_grow");
  expect(rows.runtime.status).toBe("READY");
  expect(rows.runtime.nodeIsolation(rowClone(2))).toMatchObject({
    node_instance_key: rowClone(2),
    node_id: "node_row_score",
    capability_id: "logic.score",
    error_code: "F03-ERR-004",
    cause: "INITIALIZE",
    lifecycle_generation: 1
  });
  expect(rows.runtime.readCapabilityState(rowClone(1))).toEqual({ value: 5 });
  expect(rows.runtime.dispatch({ source_node_instance_key: rowClone(2), event_name: "change", payload: { value: 1 }, origin: "USER" })).toEqual({
    accepted: false,
    reason: "NODE_ISOLATED"
  });
});

test("TEST-F03-030 each admitted interaction gets a unique operation token and terminal tokens never reopen", async () => {
  const harness = await operationHarness(operationBlueprint());
  const other = await operationHarness(operationBlueprint());
  const tokens = Array.from({ length: 6 }, (_, click) => tokenOf(pressOp(harness, click % 2 === 0 ? "node_plain" : "node_go")));
  tokens.push(tokenOf(pressOp(other, "node_plain")));
  expect(new Set(tokens).size).toBe(tokens.length);
  for (const token of tokens) {
    expect(token).toMatch(TOKEN_PATTERN);
  }
  expect(harness.runtime.dispatchRuntimeEvent({ source_node_instance_key: singletonKey("node_go"), event_name: "undeclared", payload: {}, origin: "USER" })).toEqual({
    accepted: false,
    reason: "UNDECLARED_EVENT"
  });
  expect(projectionOf(pressOp(harness, "node_plain")).status).toBe("COMMITTED");

  const operation = new RuntimeOperation({ token: "tok-1", instanceEpoch: 0, admittedMs: 0, checkpointPlan: ["step:1", "pre_commit", "committed"] });
  expect(operation.begin()).toBe(true);
  expect(operation.close("FAILED")).toBe(true);
  expect([operation.close("CANCELLED"), operation.close("TIMED_OUT"), operation.begin(), operation.markCommitted(), operation.completeCheckpoint("step:1")]).toEqual([false, false, false, false, false]);
  expect(operation.status).toBe("FAILED");
  expect(staleReason(operation, { current: operation, instanceEpoch: 0 })).toBe("TOKEN_CLOSED");
  const listener = vi.fn();
  operation.handle.subscribe(listener)();
  expect(listener).not.toHaveBeenCalled();
});

test("TEST-F03-031 checkpoint progress is monotonic, truthful and operation-scoped; no plan means no percentage", async () => {
  const harness = await operationHarness(operationBlueprint());
  const seen: { token: string; status: string; completed: number; percent?: number; last?: string }[] = [];
  harness.runtime.subscribeOperations((projection) =>
    seen.push({ token: projection.operation_token, status: projection.status, completed: projection.completed_checkpoints, percent: projection.progress_percent, last: projection.last_completed_checkpoint_id })
  );
  const token = tokenOf(pressOp(harness, "node_go"));
  const own = seen.filter((entry) => entry.token === token);
  expect(own.map((entry) => [entry.status, entry.completed, entry.percent, entry.last])).toEqual([
    ["STARTED", 0, 0, undefined],
    ["PROCESSING", 0, 0, undefined],
    ["PROCESSING", 1, 20, "step:1"],
    ["PROCESSING", 2, 40, "step:2"],
    ["PROCESSING", 3, 60, "step:3"],
    ["PROCESSING", 4, 80, "pre_commit"],
    ["COMMITTED", 5, 100, "committed"]
  ]);
  const changeOp = seen.filter((entry) => entry.token !== token);
  expect(changeOp.length).toBeGreaterThan(0);

  expect(projectionOf(pressOp(harness, "node_plain"))).toMatchObject({ planned_checkpoints: 3, progress_percent: 100 });
  const noPlan = new RuntimeOperation({ token: "tok-np", instanceEpoch: 0, admittedMs: 0 });
  noPlan.begin();
  expect(noPlan.completeCheckpoint("step:1")).toBe(false);
  expect(noPlan.projection()).toEqual({ operation_token: "tok-np", status: "PROCESSING", soft_timeout_observed: false, completed_checkpoints: 0 });

  const planned = new RuntimeOperation({ token: "tok-p", instanceEpoch: 0, admittedMs: 0, checkpointPlan: ["step:1", "step:2", "pre_commit", "committed"] });
  expect(planned.completeCheckpoint("step:1")).toBe(false);
  planned.begin();
  expect([planned.completeCheckpoint("step:2"), planned.completeCheckpoint("step:1"), planned.completeCheckpoint("step:1")]).toEqual([false, true, false]);
  expect([planned.completeCheckpoint("step:2"), planned.completeCheckpoint("pre_commit"), planned.completeCheckpoint("committed")]).toEqual([true, true, false]);
  expect(planned.projection().progress_percent).toBe(75);
  planned.close("FAILED");
  expect(planned.projection()).toMatchObject({ status: "FAILED", completed_checkpoints: 3, progress_percent: 75 });

  const failing = await operationHarness(operationBlueprint(), { handlers: { "logic/score": { ...scoreHandler, invoke: () => ({ status: "FAILURE", error: "no" }) } } });
  expect(projectionOf(pressOp(failing, "node_go"))).toMatchObject({ status: "FAILED", completed_checkpoints: 1, progress_percent: 20, last_completed_checkpoint_id: "step:1" });
});

test("TEST-F03-034 every Retry in the same recovery episode gets a fresh operation token", async () => {
  const harness = await operationHarness(operationBlueprint(), {
    handlers: {
      "logic/score": instrumentedScore((clock, call) => {
        if (call === 1) {
          clock.ms += 300;
        }
      })
    }
  });
  const first = pressOp(harness, "node_go", { recovery_episode_id: EPISODE });
  expect(projectionOf(first).status).toBe("TIMED_OUT");
  const retries = [pressOp(harness, "node_go", { recovery_episode_id: EPISODE }), pressOp(harness, "node_go", { recovery_episode_id: EPISODE })];
  const tokens = [first, ...retries].map(tokenOf);
  expect(new Set(tokens).size).toBe(3);
  expect(projectionOf(first).status).toBe("TIMED_OUT");
  expect(retries.map((retry) => projectionOf(retry).status)).toEqual(["COMMITTED", "COMMITTED"]);
  expect(harness.evidence.find((record) => record.event_type === "F03-EVT-016")?.properties).toMatchObject({
    operation_token: tokens[0],
    recovery_episode_id: EPISODE,
    safe_surface: "APP_CURRENT"
  });
  expect(harness.runtime.runtimeErrors().filter((record) => record.code === "F03-ERR-021").map((record) => record.operation_token)).toEqual([tokens[0]]);
  expect(capabilityState(harness, "node_score")).toEqual({ value: 2 });
});
