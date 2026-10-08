import { expect } from "vitest";

import lockedRegistryDocument from "../../build-spec/baselines/BS-P1-023/registries/evidence-event-registry.json" with {
  type: "json"
};
import { createEvidenceRegistry, type EvidenceRegistryDocument } from "../../src/platform/evidence/evidence-registry.js";
import { validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";
import type { CapabilityInvocationResult, LocalEffectPort, TrustedCapabilityHandler } from "../../src/platform/runtime/capability-protocol.js";
import { singletonKey, type NodeInstanceKey } from "../../src/platform/runtime/node-instance-key.js";
import type { RuntimeEvidenceRecord } from "../../src/platform/runtime/runtime-evidence.js";
import { RuntimeInstance, type RuntimeDispatchResult } from "../../src/platform/runtime/runtime-instance.js";
import type { RuntimeNodeRenderer } from "../../src/platform/runtime/node-render.js";
import type { RuntimeOperationProjection } from "../../src/platform/runtime/runtime-operation.js";
import type { RuntimeRecord } from "../../src/platform/runtime/runtime-value.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import {
  admittedBlueprint,
  blueprintWith,
  buttonNode,
  DEFAULT_SEED,
  lit,
  ManualClock,
  ManualScheduler,
  node,
  op,
  scoreHandler,
  state,
  trustFor,
  type RuntimeHarness
} from "./runtime-fixtures.js";

export const LOCKED_REGISTRY = createEvidenceRegistry(lockedRegistryDocument as EvidenceRegistryDocument);
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const EPISODE = "6f1c2a7e-4b8d-4c3a-9e21-5d7f0a9b3c11";

export const scoreNode = (id: string, events: Record<string, string> = {}) =>
  node(id, "logic.score", "1.0.0", { props: { initial: lit(0), min: lit(0), max: lit(1000) }, events });
export const increment = (target: string, delta = 1) => ({
  type: "INVOKE_CAPABILITY",
  target_node_id: target,
  capability_action: "increment",
  args: { delta: lit(delta) }
});
export const addCount = (delta: number) => ({ type: "SET_STATE", target: "count", value: op("ADD", state("count"), lit(delta)) });

/**
 * `node_go` → [count + 1, score.increment, count + 10] (plan: step:1..3, pre_commit, committed);
 * `node_plain` → [count + 100]; a score `change` maps to `action_on_change` → [count + 1000].
 */
export function operationBlueprint(): JsonRecord {
  return blueprintWith({
    state: { count: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
    actions: [
      { id: "action_go", steps: [addCount(1), increment("node_score"), addCount(10)] },
      { id: "action_plain", steps: [addCount(100)] },
      { id: "action_on_change", steps: [addCount(1000)] }
    ],
    nodes: [buttonNode("node_go", "action_go"), buttonNode("node_plain", "action_plain"), scoreNode("node_score", { change: "action_on_change" })]
  });
}

/** Trusted score handler whose `during` hook runs inside the synchronous invoke (burns or corrupts monotonic time). */
export function instrumentedScore(
  during: (clock: ManualClock, call: number) => void,
  extra: Partial<CapabilityInvocationResult> = {}
): TrustedCapabilityHandler {
  let calls = 0;
  return {
    initialize: (key, context) => scoreHandler.initialize(key, context),
    invoke: (key, action, args, current, context) => {
      calls += 1;
      during(context.clock as ManualClock, calls);
      return { ...scoreHandler.invoke(key, action, args, current, context), ...extra };
    }
  };
}

export interface OperationHarnessOptions {
  readonly handlers?: Readonly<Record<string, TrustedCapabilityHandler>>;
  readonly sampled?: boolean;
  readonly evidenceSink?: (record: RuntimeEvidenceRecord) => void;
  readonly effects?: LocalEffectPort;
}

/** Same wiring as `hydratedHarness`, plus the F07 PRODUCT_SAMPLE decision. */
export async function operationHarness(blueprint: JsonRecord, options: OperationHarnessOptions = {}): Promise<RuntimeHarness> {
  const admitted = await admittedBlueprint(blueprint);
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const evidence: RuntimeEvidenceRecord[] = [];
  const runtime = new RuntimeInstance(admitted, {
    trust: trustFor({ handlers: options.handlers }),
    services: {
      clock,
      scheduler,
      seedSource: () => DEFAULT_SEED,
      evidence: { record: options.evidenceSink ?? ((record) => evidence.push(record)) },
      effects: options.effects,
      productEvidenceSampled: options.sampled
    }
  });
  const notices: string[] = [];
  runtime.subscribe((notice) => notices.push(notice.action_id));
  expect(await runtime.hydrate()).toEqual({ status: "READY" });
  return { runtime, clock, scheduler, evidence, admitted, notices };
}

export function pressOp(harness: RuntimeHarness, nodeId: string, extra: { readonly recovery_episode_id?: string; readonly lifecycle_generation?: number } = {}): RuntimeDispatchResult {
  return harness.runtime.dispatchRuntimeEvent({ source_node_instance_key: singletonKey(nodeId), event_name: "press", payload: {}, origin: "USER", ...extra });
}

export function tokenOf(result: RuntimeDispatchResult): string {
  if (!result.accepted) {
    throw new Error(`dispatch rejected: ${result.reason}`);
  }
  return result.operation.operation_token;
}

export function projectionOf(result: RuntimeDispatchResult): RuntimeOperationProjection {
  if (!result.accepted) {
    throw new Error(`dispatch rejected: ${result.reason}`);
  }
  return result.operation.projection();
}

export function recordProjections(harness: RuntimeHarness): RuntimeOperationProjection[] {
  const seen: RuntimeOperationProjection[] = [];
  harness.runtime.subscribeOperations((projection) => seen.push(projection));
  return seen;
}

export function eventTypes(harness: RuntimeHarness): string[] {
  return harness.evidence.map((record) => record.event_type);
}

export function errorCodes(harness: RuntimeHarness): string[] {
  return harness.runtime.runtimeErrors().map((record) => record.code);
}

export function committedSnapshot(harness: RuntimeHarness): string {
  return JSON.stringify({
    count: harness.runtime.readState("count") ?? null,
    score: harness.runtime.readCapabilityState(singletonKey("node_score")) ?? null,
    rng: harness.runtime.rngMetadata() ?? null,
    sequence: harness.runtime.actionSequence
  });
}

/** Locked BS-P1-023 Evidence Registry through the real F07 validator; F07 adds event_id / occurred_at at enqueue. */
export function lockedVerdict(record: unknown, sequence: number) {
  const event = {
    ...(record as Record<string, unknown>),
    event_id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    occurred_at: "2026-10-08T00:00:01.000Z"
  };
  return validateEvidenceEvent(event, JSON.stringify(event), LOCKED_REGISTRY);
}

export function expectLockedRegistryAccepts(records: readonly RuntimeEvidenceRecord[]): void {
  for (const [index, record] of records.entries()) {
    expect(lockedVerdict(record, index + 1), record.event_type).toEqual({ accepted: true, event: expect.anything() });
  }
}

export interface RenderedNode {
  readonly id: string;
  readonly fallback?: string;
  readonly props?: RuntimeRecord;
  readonly children: readonly RenderedNode[];
}

/** Host renderer that throws for the given node ids, to model a failing node view. */
export function treeRenderer(failing: ReadonlySet<string> = new Set(), calls: string[] = []): RuntimeNodeRenderer<RenderedNode> {
  return {
    render: (input) => {
      calls.push(input.node_id);
      if (failing.has(input.node_id)) {
        throw new Error(`view ${input.node_id} crashed`);
      }
      return { id: input.node_id, props: input.props, children: input.children };
    },
    fallback: (isolation) => ({ id: isolation.node_id, fallback: isolation.error_code, children: [] })
  };
}

export const cloneKey = (nodeId: string, repeatNodeId: string, index: number): NodeInstanceKey => ({
  node_id: nodeId,
  repeat_coordinates: [{ repeat_node_id: repeatNodeId, item_index: index }]
});
