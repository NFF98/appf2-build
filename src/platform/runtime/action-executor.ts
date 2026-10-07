import type { ActionStep, BlueprintAction, ValueSource } from "../blueprint/validation-types.js";
import type { CapabilityInvocationResult, CapabilityInvokeContext, CapabilityState } from "./capability-protocol.js";
import {
  applyStatePatch,
  checkStateInvariants,
  resolveProps,
  validateEmittedEvents,
  validateInvocationArgs,
  validateStagedEffects,
  type LexicalScope
} from "./capability-runtime.js";
import type { ExecutionIndex, NodeExecution } from "./execution-index.js";
import { evaluateTyped, type EvaluationEnv } from "./expression-vm.js";
import type { MonotonicClock } from "./monotonic-timer.js";
import { nodeInstanceKeyId, singletonKey, type NodeInstanceKey } from "./node-instance-key.js";
import type { StoreTransaction } from "./instance-store.js";
import { invariantBroken, RuntimeFailure, runtimeFail } from "./runtime-errors.js";
import { deepFreeze, type RuntimeRecord, type RuntimeValue } from "./runtime-value.js";

/** Immutable admitted dispatch-site envelope that EVENT and SCOPE resolve from (F03 §14 BF-036). */
export interface DispatchEnvelope {
  readonly payload: RuntimeValue;
  readonly scope: LexicalScope;
}

interface StepContext {
  readonly index: ExecutionIndex;
  readonly tx: StoreTransaction;
  readonly env: EvaluationEnv;
  readonly clock: MonotonicClock;
}

const NO_SCOPE: LexicalScope = new Map();

function whenAllows(when: ValueSource | undefined, env: EvaluationEnv): boolean {
  if (when === undefined) {
    return true;
  }
  const value = evaluateTyped(when, env);
  return typeof value === "boolean" ? value : runtimeFail("F03-ERR-005", "Action step `when` did not evaluate to BOOLEAN.");
}

function callHandler(
  target: NodeExecution,
  key: NodeInstanceKey,
  call: { readonly action: string; readonly args: RuntimeRecord; readonly state: CapabilityState | undefined },
  context: CapabilityInvokeContext
): CapabilityInvocationResult {
  let result: CapabilityInvocationResult;
  try {
    result = target.handler.invoke(key, call.action, call.args, call.state, context);
  } catch (error: unknown) {
    if (error instanceof RuntimeFailure) {
      return runtimeFail(error.code, error.message, error.capabilityId ?? target.node.capability.id);
    }
    return runtimeFail("F03-ERR-011", "Trusted capability handler threw during invoke.", target.node.capability.id);
  }
  if (result.status !== "SUCCESS") {
    runtimeFail("F03-ERR-011", result.error ?? "Capability invocation returned FAILURE.", target.node.capability.id);
  }
  return result;
}

/** F03-RQ-008: singleton target → exact trusted handler → BF-035 revalidation → staged, not committed, outcome. */
function invokeCapability(step: Extract<ActionStep, { type: "INVOKE_CAPABILITY" }>, context: StepContext): void {
  const { index, tx, env } = context;
  const target = index.nodeById.get(step.target_node_id) ?? invariantBroken(`Invoke target ${step.target_node_id} does not exist.`);
  if (target.repeatAncestors.length > 0) {
    invariantBroken(`Invoke target ${step.target_node_id} resolves to multiple node instances.`);
  }
  const args: Record<string, RuntimeValue> = Object.create(null) as Record<string, RuntimeValue>;
  for (const [key, source] of Object.entries(step.args)) {
    args[key] = evaluateTyped(source, env);
  }
  validateInvocationArgs(target, step.capability_action, args);
  const key = singletonKey(target.node.id);
  const keyId = nodeInstanceKeyId(key);
  const slot = tx.readCapability(keyId) ?? invariantBroken(`Capability-local state slot ${keyId} was never initialized.`);
  const props = resolveProps(target, tx.env, NO_SCOPE);
  const node = { node_id: target.node.id, capability: target.node.capability, props };
  const result = callHandler(target, key, { action: step.capability_action, args, state: slot.state }, { node, rng: tx.rng, clock: context.clock });
  const next = applyStatePatch(target, slot.state, result.capability_state_patch);
  checkStateInvariants(target, next, props);
  const events = result.emitted_events ?? [];
  const effects = result.staged_effects ?? [];
  validateEmittedEvents(target, events, props, index);
  validateStagedEffects(target, effects);
  tx.stageCapability(keyId, { key, state: deepFreeze(next) });
  tx.events.push(...events.map((event) => ({ ...event, source: key })));
  tx.effects.push(...effects.map((effect) => ({ source: key, effect })));
}

function executeStep(step: ActionStep, context: StepContext): void {
  switch (step.type) {
    case "SET_STATE":
      if (whenAllows(step.when, context.env)) {
        context.tx.writeMutable(step.target, evaluateTyped(step.value, context.env));
      }
      return;
    case "RESET_STATE":
      context.tx.resetMutable(step.target);
      return;
    case "INVOKE_CAPABILITY":
      if (whenAllows(step.when, context.env)) {
        invokeCapability(step, context);
      }
  }
}

/** Declared steps run sequentially on the working transaction; any failure aborts the whole Action. */
export function executeAction(
  index: ExecutionIndex,
  tx: StoreTransaction,
  action: BlueprintAction,
  envelope: DispatchEnvelope,
  clock: MonotonicClock
): void {
  const context: StepContext = { index, tx, clock, env: { ...tx.env, event: envelope.payload, scope: envelope.scope } };
  for (const step of action.steps) {
    try {
      executeStep(step, context);
    } catch (error: unknown) {
      if (error instanceof RuntimeFailure) {
        throw error;
      }
      throw new RuntimeFailure("F03-ERR-007", `Action ${action.id} step failed unexpectedly.`);
    }
  }
}
