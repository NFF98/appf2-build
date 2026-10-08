import { canonicalizeJson } from "../blueprint/canonical-json.js";
import { V09_RESOURCE_CEILINGS } from "../blueprint/resource-bounds.js";
import type { CapabilityState } from "./capability-protocol.js";
import type { ExecutionIndex, NodeExecution } from "./execution-index.js";
import type { StagedNodeEffect } from "./instance-store.js";
import { nodeIdOfKeyId, nodeInstanceKeyId } from "./node-instance-key.js";
import { runtimeFail, type F03ErrorCode } from "./runtime-errors.js";

const ENCODER = new TextEncoder();

function capabilityKey(execution: NodeExecution): string {
  return `${execution.node.capability.id}@${execution.node.capability.version}`;
}

interface StaticUsage {
  readonly execution: NodeExecution;
  instances: number;
  timers: number;
}

/**
 * H03 defense-in-depth: re-derives the F02 V09 static instance / timer bounds from the admitted Blueprint and the
 * pinned F04 budgets. A Blueprint that V09 must reject is never rationalized by smaller runtime data.
 */
export function assertStaticResourceCeilings(index: ExecutionIndex): void {
  const usages = new Map<string, StaticUsage>();
  let timers = 0;
  for (const execution of index.nodeById.values()) {
    const nodeTimers = execution.instanceBound * execution.resources.usage.timerSlotsPerInstance;
    const usage = usages.get(capabilityKey(execution)) ?? { execution, instances: 0, timers: 0 };
    usage.instances += execution.instanceBound;
    usage.timers += nodeTimers;
    usages.set(capabilityKey(execution), usage);
    timers += nodeTimers;
  }
  for (const { execution, instances, timers: capabilityTimers } of usages.values()) {
    const { budget } = execution.resources;
    if (instances > budget.maxInstancesPerBlueprint || capabilityTimers > budget.maxConcurrentTimers) {
      runtimeFail("F03-ERR-001", "Admitted Blueprint exceeds a pinned capability resource budget.", execution.node.capability.id);
    }
  }
  if (timers > V09_RESOURCE_CEILINGS.timers) {
    runtimeFail("F03-ERR-001", "Admitted Blueprint exceeds the V09 concurrent timer ceiling.");
  }
}

/** F03 §37 exact measurement: canonical JSON UTF-8 bytes of one NodeInstanceKey's capability-local state. */
export function localStateBytes(state: CapabilityState | undefined): number {
  return state === undefined ? 0 : ENCODER.encode(canonicalizeJson(state)).byteLength;
}

export function assertLocalStateWithinBudget(execution: NodeExecution, state: CapabilityState | undefined, code: F03ErrorCode): void {
  let bytes: number;
  try {
    bytes = localStateBytes(state);
  } catch {
    return runtimeFail(code, "Capability-local state is not canonical JSON.", execution.node.capability.id);
  }
  if (bytes > execution.resources.budget.maxLocalStateBytes) {
    runtimeFail(code, "Capability-local state exceeds its pinned maxLocalStateBytes.", execution.node.capability.id);
  }
}

function timerOwner(index: ExecutionIndex, slot: string): NodeExecution | undefined {
  return index.nodeById.get(nodeIdOfKeyId(slot));
}

/**
 * Pre-commit check of the armed timer set the staged effects would produce: a capability with no timer slot can
 * never arm one, and neither the pinned per-capability nor the V09 instance-wide ceiling may be exceeded.
 */
export function assertTimerCeilings(index: ExecutionIndex, armedSlots: readonly string[], staged: readonly StagedNodeEffect[]): void {
  const next = new Map<string, NodeExecution | undefined>(armedSlots.map((slot) => [slot, timerOwner(index, slot)]));
  for (const { source, effect } of staged) {
    const slot = nodeInstanceKeyId(source);
    if (effect.kind === "CANCEL_TIMER" || (effect.kind === "SCHEDULE_TIMER" && effect.timer.status !== "RUNNING")) {
      next.delete(slot);
      continue;
    }
    if (effect.kind !== "SCHEDULE_TIMER") {
      continue;
    }
    const owner = timerOwner(index, slot);
    if (owner === undefined || owner.resources.usage.timerSlotsPerInstance < 1) {
      runtimeFail("F03-ERR-011", "Capability staged a timer without a pinned timer slot.", owner?.node.capability.id);
    }
    next.set(slot, owner);
  }
  if (next.size > V09_RESOURCE_CEILINGS.timers) {
    runtimeFail("F03-ERR-011", "Staged timers exceed the V09 concurrent timer ceiling.");
  }
  const perCapability = new Map<string, number>();
  for (const owner of next.values()) {
    if (owner === undefined) {
      continue;
    }
    const count = (perCapability.get(capabilityKey(owner)) ?? 0) + 1;
    perCapability.set(capabilityKey(owner), count);
    if (count > owner.resources.budget.maxConcurrentTimers) {
      runtimeFail("F03-ERR-011", "Staged timers exceed the pinned maxConcurrentTimers.", owner.node.capability.id);
    }
  }
}
