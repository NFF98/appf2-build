import type { CapabilityRef } from "../blueprint/validation-types.js";
import type { MonotonicClock, MonotonicTimerState } from "./monotonic-timer.js";
import type { NodeInstanceKey } from "./node-instance-key.js";
import type { RngService } from "./prng.js";
import type { RuntimeRecord, RuntimeValue } from "./runtime-value.js";

/** Capability-local state value: shape owned by the F04 `capability_state` descriptor (F03 §22). */
export type CapabilityState = RuntimeRecord;

export interface CapabilityNodeDefinition {
  readonly node_id: string;
  readonly capability: CapabilityRef;
  /** Props resolved against committed state + the node instance lexical scope. */
  readonly props: RuntimeRecord;
}

export interface CapabilityInitializeContext {
  readonly node: CapabilityNodeDefinition;
}

/** Explicit RuntimeContext services; handlers get no global mutation path (F03 §22 rule 7, §35). */
export interface CapabilityInvokeContext {
  readonly node: CapabilityNodeDefinition;
  readonly rng: RngService;
  readonly clock: MonotonicClock;
}

export interface CapabilityEmittedEvent {
  readonly event_name: string;
  readonly payload: RuntimeValue;
}

/** Runtime-owned timer effects; the Runtime keeps the monotonic anchor, never the handler. */
export type StagedEffect =
  | { readonly kind: "SCHEDULE_TIMER"; readonly timer: MonotonicTimerState; readonly completion_event: string }
  | { readonly kind: "CANCEL_TIMER" }
  | { readonly kind: "VISUAL_EFFECT" | "AUDIO_PLAYBACK_REQUEST" | "FOCUS_REQUEST"; readonly request: RuntimeRecord };

/** F03 §20 declarative invocation result. */
export interface CapabilityInvocationResult {
  readonly status: "SUCCESS" | "FAILURE";
  readonly capability_state_patch?: RuntimeRecord;
  readonly emitted_events?: readonly CapabilityEmittedEvent[];
  readonly staged_effects?: readonly StagedEffect[];
  readonly error?: string;
}

/** F03-RQ-008 build-time bundled trusted handler; Blueprint can never provide one. */
export interface TrustedCapabilityHandler {
  initialize(key: NodeInstanceKey, context: CapabilityInitializeContext): CapabilityState | undefined;
  invoke(
    key: NodeInstanceKey,
    actionName: string,
    args: RuntimeRecord,
    state: CapabilityState | undefined,
    context: CapabilityInvokeContext
  ): CapabilityInvocationResult;
  /** Optional teardown for a removed clone incarnation or a disposed Instance; its state is released afterwards. */
  dispose?(key: NodeInstanceKey, state: CapabilityState | undefined): void;
}

/** Host broker for non-timer local effects; executed only after commit (F03 §21). */
export interface LocalEffectPort {
  execute(key: NodeInstanceKey, effect: Exclude<StagedEffect, { readonly kind: "SCHEDULE_TIMER" | "CANCEL_TIMER" }>): void;
}
