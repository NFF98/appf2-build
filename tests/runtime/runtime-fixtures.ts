import { expect } from "vitest";

import { hashCanonicalBlueprintBytes } from "../../src/platform/blueprint/content-identity.js";
import type { ExecutionAdmission } from "../../src/platform/blueprint/execution-admission.js";
import { CURRENT_BUNDLED_RELEASE } from "../../src/platform/capabilities/bundled-release.js";
import type {
  CapabilityInvocationResult,
  CapabilityState,
  LocalEffectPort,
  TrustedCapabilityHandler
} from "../../src/platform/runtime/capability-protocol.js";
import type { AdmittedBlueprint, HydrationTrust } from "../../src/platform/runtime/hydration-gate.js";
import { idleTimer, startTimer, type MonotonicClock, type WakeScheduler } from "../../src/platform/runtime/monotonic-timer.js";
import { singletonKey, type NodeInstanceKey } from "../../src/platform/runtime/node-instance-key.js";
import type { RuntimeEvidenceRecord } from "../../src/platform/runtime/runtime-evidence.js";
import { RuntimeInstance, type DispatchReceipt } from "../../src/platform/runtime/runtime-instance.js";
import type { RuntimeRecord, RuntimeValue } from "../../src/platform/runtime/runtime-value.js";
import { node, source, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { admit, RUNTIME_VERSION, SCHEMA_RANGE, storedContent } from "../contract/execution-safety-fixtures.js";

export const { lit, state, event, scope, op } = source;
export { node };
export const PINNED = CURRENT_BUNDLED_RELEASE;
/** ExecutionAdmission fixture issues at 2026-10-04T00:00:00Z with a 30 s TTL. */
export const ADMITTED_AT_MS = Date.parse("2026-10-04T00:00:00.000Z");
export const DEFAULT_SEED = Uint8Array.from({ length: 16 }, (_, index) => index);

export class ManualClock implements MonotonicClock {
  public ms = 0;

  public now(): number {
    return this.ms;
  }
}

interface PendingWake {
  readonly at: number;
  readonly wake: () => void;
  active: boolean;
}

/**
 * Deterministic WakeScheduler. `minimumDelayMs` models background-tab throttling: a wake can never fire earlier
 * than that, so wakes are late and sparse while the monotonic clock keeps moving.
 */
export class ManualScheduler implements WakeScheduler {
  public wakeCount = 0;
  private pending: PendingWake[] = [];

  public constructor(
    private readonly clock: ManualClock,
    public minimumDelayMs = 0
  ) {}

  public get activeWakes(): number {
    return this.pending.filter((entry) => entry.active).length;
  }

  public schedule(delayMs: number, wake: () => void): () => void {
    const entry: PendingWake = { at: this.clock.ms + Math.max(delayMs, this.minimumDelayMs), wake, active: true };
    this.pending.push(entry);
    return () => {
      entry.active = false;
    };
  }

  /** Moves monotonic time forward, firing due wakes in deadline order at their own instants. */
  public advance(ms: number): void {
    const target = this.clock.ms + ms;
    for (let due = this.nextDue(target); due !== undefined; due = this.nextDue(target)) {
      this.clock.ms = Math.max(this.clock.ms, due.at);
      this.fire(due);
    }
    this.clock.ms = target;
  }

  /** Time passes with no wake at all (suspended tab), then every pending wake fires once, late. */
  public suspendThenResume(ms: number): void {
    this.clock.ms += ms;
    for (const entry of this.pending.filter((candidate) => candidate.active)) {
      this.fire(entry);
    }
  }

  /** Spurious early wakes: every pending wake fires now, before its deadline. */
  public fireEarly(): void {
    for (const entry of this.pending.filter((candidate) => candidate.active)) {
      this.fire(entry);
    }
  }

  private nextDue(target: number): PendingWake | undefined {
    return this.pending.filter((entry) => entry.active && entry.at <= target).sort((left, right) => left.at - right.at)[0];
  }

  private fire(entry: PendingWake): void {
    entry.active = false;
    this.pending = this.pending.filter((candidate) => candidate.active);
    this.wakeCount += 1;
    entry.wake();
  }
}

function numberOr(value: RuntimeValue | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

const failure = (error: string): CapabilityInvocationResult => ({ status: "FAILURE", error });

/** Test-only trusted handlers implementing just enough declared F04 surface to drive the Runtime. */
export const viewHandler: TrustedCapabilityHandler = {
  initialize: () => undefined,
  invoke: () => failure("view capability declares no actions")
};

export const scoreHandler: TrustedCapabilityHandler = {
  initialize: (_key, { node: definition }) => ({ value: numberOr(definition.props.initial, 0) }),
  invoke: (_key, action, args, current, { node: definition }) => {
    const value = numberOr(current?.value, 0);
    const next =
      action === "increment" ? value + numberOr(args.delta, 0) : action === "set" ? numberOr(args.value, 0) : numberOr(definition.props.initial, 0);
    return { status: "SUCCESS", capability_state_patch: { value: next }, emitted_events: [{ event_name: "change", payload: { value: next } }] };
  }
};

export const randomHandler: TrustedCapabilityHandler = {
  initialize: () => ({}),
  invoke: (_key, action, args, _current, { rng }): CapabilityInvocationResult => {
    if (action === "sample_number") {
      const min = numberOr(args.min, 0);
      const span = numberOr(args.max, 0) - min + 1;
      return { status: "SUCCESS", capability_state_patch: { last_number: min + (rng.nextUint32() % span) } };
    }
    const items = Array.isArray(args.items) ? args.items : [];
    if (items.length === 0) {
      return failure("choose_item requires a non-empty list");
    }
    const index = rng.nextUint32() % items.length;
    return { status: "SUCCESS", capability_state_patch: { last_index: index, last_item: String(items[index]) } };
  }
};

export const timerHandler: TrustedCapabilityHandler = {
  initialize: (_key, { node: definition }) => {
    const duration = numberOr(definition.props.duration_ms, 0);
    return { status: "IDLE", duration_ms: duration, remaining_ms: duration };
  },
  invoke: (_key, action, _args, _current, { node: definition, clock }): CapabilityInvocationResult => {
    const duration = numberOr(definition.props.duration_ms, 0);
    if (action === "start") {
      const timer = startTimer(idleTimer(duration), clock.now());
      return { status: "SUCCESS", capability_state_patch: { status: "RUNNING" }, staged_effects: [{ kind: "SCHEDULE_TIMER", timer, completion_event: "complete" }] };
    }
    if (action === "reset") {
      return { status: "SUCCESS", capability_state_patch: { status: "IDLE", remaining_ms: duration }, staged_effects: [{ kind: "CANCEL_TIMER" }] };
    }
    return failure("fixture timer supports start / reset only");
  }
};

export function fixtureHandlers(overrides: Readonly<Record<string, TrustedCapabilityHandler>> = {}): Map<string, TrustedCapabilityHandler> {
  const base: Record<string, TrustedCapabilityHandler> = { "logic/score": scoreHandler, "logic/random": randomHandler, "logic/timer": timerHandler };
  const handlers = new Map<string, TrustedCapabilityHandler>();
  for (const versions of Object.values(PINNED.runtime_registry.capabilities)) {
    for (const binding of Object.values(versions)) {
      handlers.set(binding.registration_key, overrides[binding.registration_key] ?? base[binding.registration_key] ?? viewHandler);
    }
  }
  return handlers;
}

/** Real F02 validation + real ExecutionAdmissionService against the pinned bundled Registry release. */
export async function admittedBlueprint(blueprint: JsonRecord): Promise<AdmittedBlueprint> {
  const stored = storedContent(blueprint, PINNED);
  const decision = await admit(blueprint, { pinned: PINNED, stored });
  if (!decision.executable) {
    throw new Error(`fixture admission denied: ${decision.reason}`);
  }
  return { admission: decision.admission, body: stored.canonical_blueprint };
}

export interface HarnessOptions {
  readonly seed?: Uint8Array;
  readonly seedSource?: () => Uint8Array;
  readonly handlers?: Readonly<Record<string, TrustedCapabilityHandler>>;
  readonly trust?: Partial<HydrationTrust>;
  readonly admission?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly effects?: LocalEffectPort;
  readonly evidenceSink?: (record: RuntimeEvidenceRecord) => void;
}

export interface RuntimeHarness {
  readonly runtime: RuntimeInstance;
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly evidence: RuntimeEvidenceRecord[];
  readonly admitted: AdmittedBlueprint;
  readonly notices: string[];
}

export function trustFor(options: HarnessOptions = {}): HydrationTrust {
  return {
    runtime_version: RUNTIME_VERSION,
    supported_blueprint_schema_range: SCHEMA_RANGE,
    registry_snapshot: PINNED,
    handlers: fixtureHandlers(options.handlers),
    hashCanonicalBlueprint: (bytes) => Promise.resolve(hashCanonicalBlueprintBytes(bytes)),
    trustedNow: () => ADMITTED_AT_MS + 1_000,
    ...options.trust
  };
}

export async function runtimeHarness(blueprint: JsonRecord, options: HarnessOptions = {}): Promise<RuntimeHarness> {
  const admitted = await admittedBlueprint(blueprint);
  const clock = new ManualClock();
  const scheduler = new ManualScheduler(clock);
  const evidence: RuntimeEvidenceRecord[] = [];
  const admission = { ...admitted.admission, ...options.admission } as unknown as ExecutionAdmission;
  const runtime = new RuntimeInstance(
    { admission, body: options.body ?? admitted.body },
    {
      trust: trustFor(options),
      services: {
        clock,
        scheduler,
        seedSource: options.seedSource ?? (() => options.seed ?? DEFAULT_SEED),
        evidence: { record: options.evidenceSink ?? ((record) => evidence.push(record)) },
        effects: options.effects
      }
    }
  );
  const notices: string[] = [];
  runtime.subscribe((notice) => notices.push(notice.action_id));
  return { runtime, clock, scheduler, evidence, admitted, notices };
}

export async function hydratedHarness(blueprint: JsonRecord, options: HarnessOptions = {}): Promise<RuntimeHarness> {
  const harness = await runtimeHarness(blueprint, options);
  expect(await harness.runtime.hydrate()).toEqual({ status: "READY" });
  return harness;
}

export function press(harness: RuntimeHarness, nodeId: string, key: NodeInstanceKey = singletonKey(nodeId)): DispatchReceipt {
  return harness.runtime.dispatch({ source_node_instance_key: key, event_name: "press", payload: {}, origin: "USER" });
}

export function change(harness: RuntimeHarness, nodeId: string, value: RuntimeValue): DispatchReceipt {
  return harness.runtime.dispatch({ source_node_instance_key: singletonKey(nodeId), event_name: "change", payload: { value }, origin: "USER" });
}

export function capabilityState(harness: RuntimeHarness, nodeId: string): CapabilityState | undefined {
  return harness.runtime.readCapabilityState(singletonKey(nodeId));
}

/** Every committed Instance value, for exact before/after comparisons. */
export function snapshot(harness: RuntimeHarness, keys: readonly string[], capabilityNodes: readonly string[] = []): RuntimeRecord {
  const values: Record<string, RuntimeValue> = {};
  for (const key of keys) {
    values[`state:${key}`] = harness.runtime.readState(key) ?? "<missing>";
  }
  for (const nodeId of capabilityNodes) {
    values[`capability:${nodeId}`] = capabilityState(harness, nodeId) ?? "<none>";
  }
  values.rng_counter = harness.runtime.rngMetadata()?.counter ?? -1;
  values.action_sequence = harness.runtime.actionSequence;
  return values;
}

export const buttonNode = (id: string, actionId: string): JsonRecord =>
  node(id, "action.button", "1.0.0", { props: { label: lit(id) }, events: { press: actionId } });

/** Root container + the given nodes; `rootChildren` defaults to every given node. */
export function blueprintWith(fields: JsonRecord, rootChildren?: readonly string[]): JsonRecord {
  const nodes = (fields.nodes as JsonRecord[] | undefined) ?? [];
  return {
    schema_version: "1.0.0",
    registry_version: "7.0.0",
    kind: "APP",
    meta: { title: "runtime", description: "" },
    support: { coverage_status: "FULLY_SUPPORTED", degradations: [] },
    state: {},
    rules: [],
    actions: [],
    root_node_id: "node_root",
    result: { outputs: [] },
    ...fields,
    nodes: [
      node("node_root", "layout.container", "1.0.0", {
        props: { direction: lit("COLUMN"), gap: lit("MD"), align: lit("STRETCH") },
        children: [...(rootChildren ?? nodes.map((entry) => entry.id as string))]
      }),
      ...nodes
    ]
  };
}
