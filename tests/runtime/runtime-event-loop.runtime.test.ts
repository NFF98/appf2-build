import { describe, expect, test } from "vitest";

import lockedRegistryDocument from "../../build-spec/baselines/BS-P1-022/registries/evidence-event-registry.json" with {
  type: "json"
};
import { createEvidenceRegistry, type EvidenceRegistryDocument } from "../../src/platform/evidence/evidence-registry.js";
import { validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";
import type { TrustedCapabilityHandler } from "../../src/platform/runtime/capability-protocol.js";
import { MAX_EVENTS_PER_CYCLE, MAX_QUEUED_EVENTS } from "../../src/platform/runtime/event-queue.js";
import { invariantBroken } from "../../src/platform/runtime/runtime-errors.js";
import type { RuntimeEvidenceRecord } from "../../src/platform/runtime/runtime-evidence.js";
import type { DispatchReceipt } from "../../src/platform/runtime/runtime-instance.js";
import {
  blueprintWith,
  buttonNode,
  capabilityState,
  hydratedHarness,
  lit,
  node,
  op,
  press,
  runtimeHarness,
  state,
  type RuntimeHarness
} from "./runtime-fixtures.js";

const LOCKED_REGISTRY = createEvidenceRegistry(lockedRegistryDocument as EvidenceRegistryDocument);

const appendDigitStep = (digit: number) => ({
  type: "SET_STATE",
  target: "trail",
  value: op("ADD", op("MUL", state("trail"), lit(10)), lit(digit))
});
const appendDigit = (id: string, digit: number) => ({ id, steps: [appendDigitStep(digit)] });
const increment = (target: string, delta = 1) => ({
  type: "INVOKE_CAPABILITY",
  target_node_id: target,
  capability_action: "increment",
  args: { delta: lit(delta) }
});
const scoreNode = (id: string, events: Record<string, string> = {}) =>
  node(id, "logic.score", "1.0.0", { props: { initial: lit(0), min: lit(0), max: lit(1000) }, events });
const TRAIL = { trail: { mode: "MUTABLE", type: "NUMBER", initial: 0 } };

function eventTypes(harness: RuntimeHarness): string[] {
  return harness.evidence.map((record) => record.event_type);
}

function errorCodes(harness: RuntimeHarness): string[] {
  return harness.runtime.runtimeErrors().map((record) => record.code);
}

/** Locked BS-P1-022 Evidence Registry via the real F07 validator; F07 adds event_id / occurred_at at enqueue. */
function registryVerdict(record: RuntimeEvidenceRecord, sequence: number) {
  const event = {
    ...record,
    event_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    occurred_at: "2026-10-04T00:00:01.000Z"
  };
  return validateEvidenceEvent(event, JSON.stringify(event), LOCKED_REGISTRY);
}

describe("F03 FIFO single-writer event loop", () => {
  test("TEST-F03-005 events are processed one at a time in FIFO order with no parallel state writer", async () => {
    const harness = await hydratedHarness(
      blueprintWith({
        state: TRAIL,
        actions: [appendDigit("action_a", 1), appendDigit("action_b", 2), appendDigit("action_c", 3), appendDigit("action_d", 4)],
        nodes: [buttonNode("node_a", "action_a"), buttonNode("node_b", "action_b"), buttonNode("node_c", "action_c"), buttonNode("node_d", "action_d")]
      })
    );
    const nested: { readonly receipt: DispatchReceipt; readonly trailAtReturn: unknown }[] = [];
    const unsubscribe = harness.runtime.subscribe((notice) => {
      if (notice.action_id !== "action_a") {
        return;
      }
      for (const nodeId of ["node_b", "node_c"]) {
        nested.push({ receipt: press(harness, nodeId), trailAtReturn: harness.runtime.readState("trail") });
      }
    });

    expect(press(harness, "node_a")).toEqual({ accepted: true, sequence: 1 });
    unsubscribe();

    expect(nested).toEqual([
      { receipt: { accepted: true, sequence: 2 }, trailAtReturn: 1 },
      { receipt: { accepted: true, sequence: 3 }, trailAtReturn: 1 }
    ]);
    expect(harness.runtime.readState("trail")).toBe(123);
    expect(harness.notices).toEqual(["action_a", "action_b", "action_c"]);

    expect(press(harness, "node_d")).toEqual({ accepted: true, sequence: 4 });
    expect(harness.runtime.readState("trail")).toBe(1234);
    expect(harness.notices).toEqual(["action_a", "action_b", "action_c", "action_d"]);
    expect(harness.runtime.actionSequence).toBe(4);
    expect(eventTypes(harness)).toEqual(["F03-EVT-001", "F03-EVT-002", "F03-EVT-004", "F03-EVT-004", "F03-EVT-004", "F03-EVT-004"]);
  });

  test("TEST-F03-007 a capability-emitted event is only queued and never re-enters the current Action", async () => {
    const harness = await hydratedHarness(
      blueprintWith({
        state: { ...TRAIL, zero: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
        actions: [
          { id: "action_bump", steps: [increment("node_score"), appendDigitStep(1)] },
          {
            id: "action_bump_fail",
            steps: [increment("node_score"), { type: "SET_STATE", target: "trail", value: op("DIV", lit(1), state("zero")) }]
          },
          appendDigit("action_on_score", 2)
        ],
        nodes: [buttonNode("node_bump", "action_bump"), buttonNode("node_bump_fail", "action_bump_fail"), scoreNode("node_score", { change: "action_on_score" })]
      })
    );
    const observedOnCommit: unknown[] = [];
    harness.runtime.subscribe((notice) => observedOnCommit.push([notice.action_id, harness.runtime.readState("trail"), capabilityState(harness, "node_score")]));

    press(harness, "node_bump");

    expect(harness.runtime.readState("trail")).toBe(12);
    expect(observedOnCommit).toEqual([
      ["action_bump", 1, { value: 1 }],
      ["action_on_score", 12, { value: 1 }]
    ]);

    press(harness, "node_bump_fail");

    expect(harness.runtime.readState("trail")).toBe(12);
    expect(capabilityState(harness, "node_score")).toEqual({ value: 1 });
    expect(harness.notices).toEqual(["action_bump", "action_on_score"]);
    expect(harness.runtime.runtimeErrors()).toEqual([expect.objectContaining({ code: "F03-ERR-008", action_id: "action_bump_fail" })]);
    expect(eventTypes(harness).slice(2)).toEqual(["F03-EVT-004", "F03-EVT-004", "F03-EVT-005"]);
    expect(harness.runtime.status).toBe("READY");
  });

  test("a throwing commit subscriber cannot drop the committed Action's emitted events", async () => {
    const harness = await hydratedHarness(
      blueprintWith({
        state: TRAIL,
        actions: [
          { id: "action_bump", steps: [increment("node_score"), appendDigitStep(1)] },
          appendDigit("action_on_score", 2),
          appendDigit("action_next", 3)
        ],
        nodes: [buttonNode("node_bump", "action_bump"), buttonNode("node_next", "action_next"), scoreNode("node_score", { change: "action_on_score" })]
      })
    );
    const unsubscribe = harness.runtime.subscribe(() => {
      throw new Error("consumer bug");
    });

    expect(() => press(harness, "node_bump")).toThrow("consumer bug");
    unsubscribe();
    expect(harness.runtime.readState("trail")).toBe(1);
    expect(harness.runtime.status).toBe("READY");

    press(harness, "node_next");
    expect(harness.runtime.readState("trail")).toBe(123);
    expect(harness.notices).toEqual(["action_bump", "action_on_score", "action_next"]);
  });
});

describe("F03 bounded event loop and queue", () => {
  test("TEST-F03-017 the dispatch cycle and the event queue are bounded and stop with F03-ERR-015 / F03-ERR-014", async () => {
    const loop = await hydratedHarness(
      blueprintWith({
        state: TRAIL,
        actions: [{ id: "action_kick", steps: [increment("node_score")] }, appendDigit("action_after", 7)],
        nodes: [buttonNode("node_kick", "action_kick"), buttonNode("node_after", "action_after"), scoreNode("node_score", { change: "action_kick" })]
      })
    );
    expect(press(loop, "node_kick")).toEqual({ accepted: true, sequence: 1 });
    expect(capabilityState(loop, "node_score")).toEqual({ value: MAX_EVENTS_PER_CYCLE });
    expect(loop.runtime.actionSequence).toBe(MAX_EVENTS_PER_CYCLE);
    expect(errorCodes(loop)).toEqual(["F03-ERR-015"]);
    expect(loop.evidence.filter((record) => record.event_type === "F03-EVT-008")).toEqual([
      expect.objectContaining({ error_code: "F03-ERR-015", properties: expect.objectContaining({ runtime_status: "READY" }) })
    ]);
    expect(loop.runtime.status).toBe("READY");
    press(loop, "node_after");
    expect(loop.runtime.readState("trail")).toBe(7);
    expect(capabilityState(loop, "node_score")).toEqual({ value: MAX_EVENTS_PER_CYCLE });

    const flood = await hydratedHarness(
      blueprintWith({
        state: { count: { mode: "MUTABLE", type: "NUMBER", initial: 0 }, flooded: { mode: "MUTABLE", type: "BOOLEAN", initial: false } },
        actions: [
          { id: "action_flood", steps: [{ type: "SET_STATE", target: "flooded", value: lit(true) }] },
          { id: "action_count", steps: [{ type: "SET_STATE", target: "count", value: op("ADD", state("count"), lit(1)) }] }
        ],
        nodes: [buttonNode("node_flood", "action_flood"), buttonNode("node_count", "action_count")]
      })
    );
    const receipts: DispatchReceipt[] = [];
    flood.runtime.subscribe((notice) => {
      if (notice.action_id === "action_flood") {
        for (let index = 0; index < MAX_QUEUED_EVENTS + 44; index += 1) {
          receipts.push(press(flood, "node_count"));
        }
      }
    });
    press(flood, "node_flood");
    expect(receipts.filter((receipt) => receipt.accepted)).toHaveLength(MAX_QUEUED_EVENTS);
    expect(receipts.slice(MAX_QUEUED_EVENTS)).toEqual(Array.from({ length: 44 }, () => ({ accepted: false, reason: "EVENT_QUEUE_LIMIT", error_code: "F03-ERR-014" })));
    expect(flood.runtime.readState("count")).toBe(MAX_EVENTS_PER_CYCLE - 1);
    expect(errorCodes(flood)).toEqual([...Array.from({ length: 44 }, () => "F03-ERR-014"), "F03-ERR-015"]);
    expect(press(flood, "node_count")).toMatchObject({ accepted: true });
    expect(flood.runtime.readState("count")).toBe(MAX_EVENTS_PER_CYCLE);
  });
});

describe("F03 commit / rollback / fatal trace evidence", () => {
  test("TEST-F03-AC-026 action commit, rollback and fatal failure are traceable with locked registry-valid evidence", async () => {
    const corruptionProbe: TrustedCapabilityHandler = {
      initialize: () => ({}),
      invoke: () => invariantBroken("Trusted service detected an Instance Store inconsistency.")
    };
    const harness = await hydratedHarness(
      blueprintWith({
        state: { count: { mode: "MUTABLE", type: "NUMBER", initial: 0 }, zero: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
        actions: [
          { id: "action_ok", steps: [{ type: "SET_STATE", target: "count", value: lit(1) }] },
          { id: "action_fail", steps: [{ type: "SET_STATE", target: "count", value: op("DIV", lit(1), state("zero")) }] },
          { id: "action_fatal", steps: [{ type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "sample_number", args: { min: lit(1), max: lit(6) } }] }
        ],
        nodes: [buttonNode("node_ok", "action_ok"), buttonNode("node_fail", "action_fail"), buttonNode("node_fatal", "action_fatal"), node("node_random", "logic.random", "1.0.0")]
      }),
      { handlers: { "logic/random": corruptionProbe } }
    );
    const hash = harness.admitted.admission.content_hash;

    press(harness, "node_ok");
    press(harness, "node_fail");
    press(harness, "node_fatal");

    expect(harness.evidence.map((record) => [record.event_type, record.error_code ?? null, record.capability_id ?? null, record.properties.runtime_status])).toEqual([
      ["F03-EVT-001", null, null, "HYDRATING"],
      ["F03-EVT-002", null, null, "READY"],
      ["F03-EVT-004", null, null, "READY"],
      ["F03-EVT-005", "F03-ERR-008", null, "READY"],
      ["F03-EVT-005", "F03-ERR-018", "logic.random", "READY"],
      ["F03-EVT-010", "F03-ERR-018", "logic.random", "FATAL_ERROR"]
    ]);
    expect(harness.evidence.slice(1).every((record) => record.blueprint_hash === hash)).toBe(true);
    expect(harness.evidence.at(-1)?.properties.integrity_status).toBe("CORRUPTED");
    expect(harness.evidence.every((record) => !("operation_status" in record.properties))).toBe(true);
    expect(harness.runtime.runtimeErrors().map((record) => [record.code, record.action_id ?? null])).toEqual([
      ["F03-ERR-008", "action_fail"],
      ["F03-ERR-018", "action_fatal"]
    ]);
    expect(harness.runtime.status).toBe("FATAL_ERROR");
    expect(harness.runtime.readState("count")).toBe(1);
    expect(press(harness, "node_ok")).toEqual({ accepted: false, reason: "INSTANCE_NOT_READY" });

    const failedHydration = await runtimeHarness(blueprintWith({}), { admission: { trust_status: "REVOKED" } });
    await failedHydration.runtime.hydrate();
    const trace = [...harness.evidence, ...failedHydration.evidence];
    expect(failedHydration.evidence.map((record) => [record.event_type, record.error_code])).toEqual([
      ["F03-EVT-001", undefined],
      ["F03-EVT-003", "F03-ERR-001"]
    ]);
    for (const [index, record] of trace.entries()) {
      expect(registryVerdict(record, index), record.event_type).toEqual({ accepted: true, event: expect.anything() });
    }
    const unregistered = { ...harness.evidence[2], properties: { ...harness.evidence[2]?.properties, raw_state: "1" } } as RuntimeEvidenceRecord;
    expect(registryVerdict(unregistered, 99)).toMatchObject({ accepted: false });
  });
});
