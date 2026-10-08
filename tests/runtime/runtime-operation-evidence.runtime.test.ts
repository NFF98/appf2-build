import { describe, expect, test } from "vitest";

import lockedRegistryDocument from "../../build-spec/baselines/BS-P1-023/registries/evidence-event-registry.json" with {
  type: "json"
};
import type { RuntimeEvidenceRecord } from "../../src/platform/runtime/runtime-evidence.js";
import { invariantBroken } from "../../src/platform/runtime/runtime-errors.js";
import { HARD_DEADLINE_MS } from "../../src/platform/runtime/runtime-operation.js";
import { blueprintWith, buttonNode, lit, press, type RuntimeHarness } from "./runtime-fixtures.js";
import {
  EPISODE,
  errorCodes,
  eventTypes,
  expectLockedRegistryAccepts,
  instrumentedScore,
  lockedVerdict,
  operationBlueprint,
  operationHarness,
  pressOp,
  projectionOf,
  tokenOf
} from "./runtime-operation-fixtures.js";

const RUNTIME_STATUSES = ["UNINITIALIZED", "HYDRATING", "READY", "RECOVERABLE_ERROR", "FATAL_ERROR", "DISPOSED"];
const OPERATION_STATUSES = ["STARTED", "PROCESSING", "COMMITTED", "TIMED_OUT", "FAILED", "CANCELLED"];
const DISCARD_REASONS = ["TOKEN_CLOSED", "TOKEN_NOT_CURRENT", "INSTANCE_EPOCH_MISMATCH", "HARD_DEADLINE_ELAPSED"];
const OPERATION_EVENTS = new Set(["F03-EVT-011", "F03-EVT-012", "F03-EVT-013", "F03-EVT-014", "F03-EVT-015", "F03-EVT-016"]);

/** First score invoke burns past the hard deadline; later invokes are on time. */
const firstCallLate = () => instrumentedScore((clock, call) => {
  if (call === 1) {
    clock.ms += HARD_DEADLINE_MS;
  }
});

/** Sampled run covering commit, soft timeout, hard timeout + safe-state recovery, and retry. */
async function sampledOperationRun(): Promise<RuntimeHarness> {
  const harness = await operationHarness(operationBlueprint(), { sampled: true, handlers: { "logic/score": firstCallLate() } });
  pressOp(harness, "node_go", { recovery_episode_id: EPISODE });
  pressOp(harness, "node_go", { recovery_episode_id: EPISODE });
  harness.runtime.subscribeOperations((projection) => {
    if (projection.last_completed_checkpoint_id === "step:1") {
      harness.clock.ms += 60;
    }
  });
  pressOp(harness, "node_plain");
  return harness;
}

function withProperties(record: RuntimeEvidenceRecord, properties: Record<string, unknown>, omit: readonly string[] = []): unknown {
  const next: Record<string, unknown> = { ...record.properties, ...properties };
  for (const key of omit) {
    delete next[key];
  }
  return { ...record, properties: next };
}

function recordOf(harness: RuntimeHarness, eventType: string): RuntimeEvidenceRecord {
  return harness.evidence.find((record) => record.event_type === eventType) ?? invariantBroken(`missing ${eventType}`);
}

describe("F03 Runtime operation Evidence", () => {
  test("TEST-F03-AC-028 a failing telemetry sink or operation listener never blocks the Runtime", async () => {
    let sinkCalls = 0;
    const harness = await operationHarness(operationBlueprint(), {
      sampled: true,
      handlers: { "logic/score": firstCallLate() },
      evidenceSink: () => {
        sinkCalls += 1;
        throw new Error("telemetry backend down");
      }
    });
    harness.runtime.subscribeOperations(() => {
      throw new Error("progress view crashed");
    });

    const timedOut = pressOp(harness, "node_go");
    expect(projectionOf(timedOut).status).toBe("TIMED_OUT");
    expect(errorCodes(harness)).toEqual(["F03-ERR-021"]);
    const retried = pressOp(harness, "node_go");
    expect(projectionOf(retried).status).toBe("COMMITTED");
    expect(press(harness, "node_plain")).toMatchObject({ accepted: true });

    expect(sinkCalls).toBeGreaterThan(0);
    expect(harness.runtime.status).toBe("READY");
    expect(harness.runtime.readState("count")).toBe(1111);
    expect(harness.notices).toEqual(["action_go", "action_on_change", "action_plain"]);
  });

  test("TEST-F03-AC-029 Runtime evidence carries no raw Runtime state or payload", async () => {
    const secret = "RAW-STATE-SENTINEL";
    const blueprint = blueprintWith({
      state: { note: { mode: "MUTABLE", type: "STRING", initial: secret, constraints: { max_length: 64 } } },
      actions: [{ id: "action_note", steps: [{ type: "SET_STATE", target: "note", value: lit(`${secret}-NEXT`) }] }],
      nodes: [buttonNode("node_note", "action_note")]
    });
    const harness = await operationHarness(blueprint, { sampled: true });
    pressOp(harness, "node_note");
    expect(harness.runtime.readState("note")).toBe(`${secret}-NEXT`);
    expect(JSON.stringify(harness.evidence)).not.toContain(secret);

    const run = await sampledOperationRun();
    expectLockedRegistryAccepts(run.evidence);
    for (const record of [...harness.evidence, ...run.evidence]) {
      for (const rawField of ["count", "note", "state", "payload", "value", "capability_state"]) {
        expect(record.properties, `${record.event_type} ${rawField}`).not.toHaveProperty(rawField);
      }
    }

    const f03Entries = lockedRegistryDocument.entries.filter((entry) => entry.function_id === "F03");
    expect(f03Entries.length).toBeGreaterThan(0);
    for (const entry of f03Entries) {
      expect(entry.allowed_properties, entry.event_type).not.toEqual(expect.arrayContaining([expect.stringMatching(/state_snapshot|payload|^state$/)]));
    }
  });

  test("TEST-F03-037 Runtime evidence keeps runtime_status and operation_status separate", async () => {
    const run = await sampledOperationRun();
    const types = new Set(eventTypes(run));
    for (const type of ["F03-EVT-011", "F03-EVT-012", "F03-EVT-013", "F03-EVT-014", "F03-EVT-016"]) {
      expect(types.has(type), type).toBe(true);
    }
    expectLockedRegistryAccepts(run.evidence);
    for (const record of run.evidence) {
      const properties: Readonly<Record<string, unknown>> = { ...record.properties };
      expect(properties, record.event_type).not.toHaveProperty("runtime_stage");
      expect(RUNTIME_STATUSES, record.event_type).toContain(properties.runtime_status);
      if (OPERATION_EVENTS.has(record.event_type)) {
        expect(OPERATION_STATUSES, record.event_type).toContain(properties.operation_status);
      } else {
        expect(properties, record.event_type).not.toHaveProperty("operation_status");
      }
    }
    expect(recordOf(run, "F03-EVT-011").properties).toMatchObject({ runtime_status: "READY", operation_status: "STARTED" });
    expect(recordOf(run, "F03-EVT-012").properties).toMatchObject({ runtime_status: "READY", operation_status: "PROCESSING" });

    const checkpoint = recordOf(run, "F03-EVT-012");
    expect(lockedVerdict(withProperties(checkpoint, { runtime_stage: "PROCESSING" }), 1)).toMatchObject({ accepted: false });
    expect(lockedVerdict(withProperties(checkpoint, { runtime_status: "PROCESSING" }), 2)).toMatchObject({ accepted: false });
    expect(lockedVerdict(withProperties(checkpoint, { operation_status: "READY" }), 3)).toMatchObject({ accepted: false });
    expect(lockedVerdict(withProperties(recordOf(run, "F03-EVT-011"), { operation_status: "PROCESSING" }), 4)).toMatchObject({ accepted: false });
    expect(lockedVerdict(withProperties(checkpoint, { runtime_stage: "READY" }, ["runtime_status", "operation_status"]), 5)).toMatchObject({ accepted: false });
  });

  test("TEST-F03-038 only PROVEN integrity enters timeout recovery and discard_reason never encodes integrity", async () => {
    const run = await sampledOperationRun();
    const timedOutToken = run.evidence.find((record) => record.event_type === "F03-EVT-014")?.properties.operation_token;
    expect(recordOf(run, "F03-EVT-014")).toMatchObject({ error_code: "F03-ERR-021", properties: { integrity_status: "PROVEN", operation_status: "TIMED_OUT" } });
    expect(recordOf(run, "F03-EVT-016").properties).toMatchObject({ operation_token: timedOutToken, safe_surface: "APP_CURRENT", recovery_episode_id: EPISODE });
    expect(recordOf(run, "F03-EVT-015").properties).toMatchObject({ operation_token: timedOutToken, discard_reason: "HARD_DEADLINE_ELAPSED" });
    expect(run.runtime.status).toBe("READY");

    const degraded = await operationHarness(operationBlueprint(), {
      sampled: true,
      handlers: {
        "logic/score": instrumentedScore((clock) => {
          clock.ms -= 1;
        })
      }
    });
    degraded.clock.ms = 10;
    const token = tokenOf(pressOp(degraded, "node_go"));
    expect(degraded.runtime.status).toBe("FATAL_ERROR");
    for (const recoveryEvent of ["F03-EVT-014", "F03-EVT-015", "F03-EVT-016"]) {
      expect(eventTypes(degraded)).not.toContain(recoveryEvent);
    }
    expect(recordOf(degraded, "F03-EVT-010")).toMatchObject({ error_code: "F03-ERR-018", properties: { integrity_status: "ASSURANCE_DEGRADED" } });
    expect(degraded.runtime.runtimeErrors().at(-1)).toMatchObject({ code: "F03-ERR-018", operation_token: token, integrity_status: "ASSURANCE_DEGRADED" });
    expectLockedRegistryAccepts(degraded.evidence);

    for (const record of [...run.evidence, ...degraded.evidence].filter((entry) => entry.event_type === "F03-EVT-015")) {
      expect(DISCARD_REASONS).toContain(record.properties.discard_reason);
    }
    const timeout = recordOf(run, "F03-EVT-014");
    for (const [sequence, integrity] of ["UNKNOWN", "ASSURANCE_DEGRADED", "CORRUPTED"].entries()) {
      expect(lockedVerdict(withProperties(timeout, { integrity_status: integrity }), sequence + 1), integrity).toMatchObject({ accepted: false });
    }
    const discard = recordOf(run, "F03-EVT-015");
    for (const [sequence, reason] of ["INTEGRITY_UNKNOWN", "CORRUPTED", "ASSURANCE_DEGRADED"].entries()) {
      expect(lockedVerdict(withProperties(discard, { discard_reason: reason }), sequence + 10), reason).toMatchObject({ accepted: false });
    }
    expect(lockedVerdict(withProperties(recordOf(degraded, "F03-EVT-010"), { integrity_status: "PROVEN" }), 20)).toMatchObject({ accepted: false });
  });
});
