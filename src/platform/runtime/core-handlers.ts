import type { CapabilityInvocationResult, CapabilityInvokeContext, CapabilityState, TrustedCapabilityHandler } from "./capability-protocol.js";
import { idleTimer, pauseTimer, resumeTimer, startTimer, type MonotonicTimerState } from "./monotonic-timer.js";
import type { RngService } from "./prng.js";
import type { RuntimeValue } from "./runtime-value.js";

const failure = (error: string): CapabilityInvocationResult => ({ status: "FAILURE", error });

function numberOr(value: RuntimeValue | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

/** Presentation / input capabilities declare no F04 actions; their events are dispatched by the renderer. */
const presentationHandler: TrustedCapabilityHandler = {
  initialize: () => undefined,
  invoke: (_key, action) => failure(`Capability declares no action ${action}.`)
};

/** logic.score@1.0.0: SCORE_BOUNDS on the exact result is enforced by the Runtime before commit (F03 §20 rule 3). */
const scoreHandler: TrustedCapabilityHandler = {
  initialize: (_key, { node }) => ({ value: numberOr(node.props.initial, 0) }),
  invoke: (_key, action, args, current, { node }) => {
    const value = numberOr(current?.value, 0);
    let next: number;
    switch (action) {
      case "increment":
        next = value + numberOr(args.delta, Number.NaN);
        break;
      case "set":
        next = numberOr(args.value, Number.NaN);
        break;
      case "reset":
        next = numberOr(node.props.initial, 0);
        break;
      default:
        return failure(`logic.score declares no action ${action}.`);
    }
    if (!Number.isFinite(next)) {
      return failure("logic.score result is not a finite NUMBER.");
    }
    return { status: "SUCCESS", capability_state_patch: { value: next }, emitted_events: [{ event_name: "change", payload: { value: next } }] };
  }
};

/** Unbiased uniform index in [0, size) by rejection sampling over the Runtime-owned seeded RNG. */
function uniformIndex(rng: RngService, size: number): number {
  const range = 2 ** 32;
  const limit = range - (range % size);
  let draw = rng.nextUint32();
  while (draw >= limit) {
    draw = rng.nextUint32();
  }
  return draw % size;
}

/**
 * logic.random@1.0.0. `choose_item` picks uniformly among the declared items. `sample_number` fails closed: F04 does
 * not fix whether the sample is integral or continuous, and the handler must not invent that distribution.
 */
const randomHandler: TrustedCapabilityHandler = {
  initialize: () => ({}),
  invoke: (_key, action, args, _current, { rng }) => {
    if (action === "sample_number") {
      return failure("logic.random sample_number distribution is not defined by the locked F04 contract.");
    }
    if (action !== "choose_item") {
      return failure(`logic.random declares no action ${action}.`);
    }
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) {
      return failure("logic.random choose_item requires a non-empty list.");
    }
    const index = uniformIndex(rng, items.length);
    const item = items[index];
    return typeof item === "string"
      ? { status: "SUCCESS", capability_state_patch: { last_index: index, last_item: item } }
      : failure("logic.random choose_item items must be STRING.");
  }
};

type TimerStatus = MonotonicTimerState["status"];

/** A RUNNING state whose Runtime slot is no longer armed has reached its completion. */
function effectiveTimerStatus(current: CapabilityState | undefined, context: CapabilityInvokeContext): TimerStatus | undefined {
  const status = current?.status;
  if (status === "RUNNING") {
    return context.timer === undefined ? "COMPLETE" : "RUNNING";
  }
  return status === "IDLE" || status === "PAUSED" || status === "COMPLETE" ? status : undefined;
}

/** logic.timer@1.0.0: the Runtime owns the monotonic anchor; transitions apply only from their source status. */
const timerHandler: TrustedCapabilityHandler = {
  initialize: (_key, { node }) => {
    const duration = numberOr(node.props.duration_ms, 0);
    return { status: "IDLE", duration_ms: duration, remaining_ms: duration };
  },
  invoke: (_key, action, _args, current, context) => {
    const status = effectiveTimerStatus(current, context);
    const duration = numberOr(current?.duration_ms, Number.NaN);
    if (status === undefined || !Number.isFinite(duration)) {
      return failure("logic.timer capability state is not initialized.");
    }
    const now = context.clock.now();
    switch (action) {
      case "start": {
        if (status !== "IDLE") {
          return { status: "SUCCESS" };
        }
        const timer = startTimer(idleTimer(duration), now);
        return {
          status: "SUCCESS",
          capability_state_patch: { status: "RUNNING", remaining_ms: duration },
          staged_effects: [{ kind: "SCHEDULE_TIMER", timer, completion_event: "complete" }]
        };
      }
      case "pause": {
        if (status !== "RUNNING" || context.timer === undefined) {
          return { status: "SUCCESS" };
        }
        const paused = pauseTimer(context.timer.timer, now);
        return {
          status: "SUCCESS",
          capability_state_patch: { status: "PAUSED", remaining_ms: paused.duration_ms - paused.elapsed_offset_ms },
          staged_effects: [{ kind: "CANCEL_TIMER" }]
        };
      }
      case "resume": {
        if (status !== "PAUSED") {
          return { status: "SUCCESS" };
        }
        const remaining = numberOr(current?.remaining_ms, duration);
        const paused: MonotonicTimerState = { status: "PAUSED", duration_ms: duration, elapsed_offset_ms: duration - remaining };
        return {
          status: "SUCCESS",
          capability_state_patch: { status: "RUNNING" },
          staged_effects: [{ kind: "SCHEDULE_TIMER", timer: resumeTimer(paused, now), completion_event: "complete" }]
        };
      }
      case "reset":
        return {
          status: "SUCCESS",
          capability_state_patch: { status: "IDLE", remaining_ms: duration },
          staged_effects: [{ kind: "CANCEL_TIMER" }]
        };
      default:
        return failure(`logic.timer declares no action ${action}.`);
    }
  }
};

/**
 * F03-RQ-008 production trusted handler catalog, keyed by the pinned Runtime Registry `registration_key`. This is the
 * only handler set bundled into the product; test doubles live under tests/ and are never imported here.
 */
export const CORE_CAPABILITY_HANDLERS: ReadonlyMap<string, TrustedCapabilityHandler> = new Map([
  ["layout/container", presentationHandler],
  ["content/text", presentationHandler],
  ["content/card", presentationHandler],
  ["content/list", presentationHandler],
  ["action/button", presentationHandler],
  ["input/number", presentationHandler],
  ["input/text", presentationHandler],
  ["input/select", presentationHandler],
  ["input/toggle", presentationHandler],
  ["data/stat", presentationHandler],
  ["data/table_basic", presentationHandler],
  ["system/notice", presentationHandler],
  ["logic/score", scoreHandler],
  ["logic/random", randomHandler],
  ["logic/timer", timerHandler]
]);
