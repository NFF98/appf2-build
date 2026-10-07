import { valueConforms } from "../blueprint/type-descriptor.js";
import { BlueprintValidationFailure, type Blueprint, type ValueSource } from "../blueprint/validation-types.js";
import { executeAction } from "./action-executor.js";
import type { CapabilityState, LocalEffectPort, StagedEffect } from "./capability-protocol.js";
import {
  eventPayloadDescriptor,
  expandNodeInstances,
  lexicalScopeOf,
  resolveProps,
  validateInitialState,
  type ConcreteNodeInstance,
  type LexicalScope
} from "./capability-runtime.js";
import {
  BoundedEventQueue,
  MAX_COMMITS_PER_CYCLE,
  MAX_EVENTS_PER_CYCLE,
  type EventOrigin,
  type RuntimeEventEnvelope
} from "./event-queue.js";
import { buildExecutionIndex, type ExecutionIndex } from "./execution-index.js";
import { evaluateTyped } from "./expression-vm.js";
import { pinnedNodeBinder, verifyAdmittedBlueprint, type AdmittedBlueprint, type HydrationTrust } from "./hydration-gate.js";
import { emptyStore, StoreTransaction, type CommittedStore, type RuleEntry, type StagedEvent, type StagedNodeEffect } from "./instance-store.js";
import { TimerWakeService, type MonotonicClock, type TimerObservation, type WakeScheduler } from "./monotonic-timer.js";
import { nodeInstanceKeyId, type NodeInstanceKey } from "./node-instance-key.js";
import { rngMetadata, seedPcg32, type RngMetadata } from "./prng.js";
import { invariantBroken, RuntimeFailure, runtimeFail, type F03ErrorCode } from "./runtime-errors.js";
import { RuntimeEvidenceEmitter, type RuntimeEvidenceSink, type RuntimeStatus } from "./runtime-evidence.js";
import { deepFreeze, type RuntimeValue } from "./runtime-value.js";

export interface RuntimeServices {
  readonly clock: MonotonicClock;
  readonly scheduler: WakeScheduler;
  /** Cryptographically strong 16-byte seed source (F03 §23). */
  readonly seedSource: () => Uint8Array;
  readonly evidence?: RuntimeEvidenceSink;
  readonly effects?: LocalEffectPort;
}

export interface RuntimeHostContext {
  readonly trust: HydrationTrust;
  readonly services: RuntimeServices;
}

/** Public dispatch input; TIMER / CAPABILITY origins are Runtime-internal only. */
export interface RuntimeEventInput {
  readonly source_node_instance_key: NodeInstanceKey;
  readonly event_name: string;
  readonly payload: RuntimeValue;
  readonly origin: "USER" | "SYSTEM";
}

export type DispatchRejection =
  | "INSTANCE_NOT_READY"
  | "INVALID_NODE_INSTANCE_KEY"
  | "UNDECLARED_EVENT"
  | "PAYLOAD_SCHEMA_MISMATCH"
  | "EVENT_QUEUE_LIMIT";

export type DispatchReceipt =
  | { readonly accepted: true; readonly sequence: number }
  | { readonly accepted: false; readonly reason: DispatchRejection; readonly error_code?: F03ErrorCode };

export interface RuntimeErrorRecord {
  readonly code: F03ErrorCode;
  readonly message: string;
  readonly capability_id?: string;
  readonly action_id?: string;
}

export type HydrationResult =
  | { readonly status: "READY" }
  | { readonly status: Exclude<RuntimeStatus, "READY">; readonly error?: RuntimeErrorRecord };

export interface CommitNotice {
  readonly action_id: string;
  readonly action_sequence: number;
}

interface AdmittedEvent {
  readonly sourceNodeId: string;
  readonly scope: LexicalScope;
  readonly payload: RuntimeValue;
}

const MAX_RECORDED_ERRORS = 128;

function asFailure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailure) {
    return error;
  }
  if (error instanceof BlueprintValidationFailure) {
    return new RuntimeFailure("F03-ERR-001", "Admitted Blueprint failed Runtime re-analysis.");
  }
  return new RuntimeFailure("F03-ERR-018", "Unexpected Runtime exception.");
}

function reject(reason: DispatchRejection, errorCode?: F03ErrorCode): DispatchReceipt {
  return errorCode === undefined ? { accepted: false, reason } : { accepted: false, reason, error_code: errorCode };
}

function ownedPayload(payload: RuntimeValue): RuntimeValue | undefined {
  try {
    return deepFreeze(structuredClone(payload));
  } catch {
    return undefined;
  }
}

/**
 * One isolated Runtime Instance (F03 §7). Only this class mutates its committed store, and only through a
 * committed StoreTransaction inside the single-writer drain loop.
 */
export class RuntimeInstance {
  private currentStatus: RuntimeStatus = "UNINITIALIZED";
  private index: ExecutionIndex | undefined;
  private store: CommittedStore | undefined;
  private hydrationError: RuntimeErrorRecord | undefined;
  private sequence = 0;
  private committedActions = 0;
  private draining = false;
  private readonly queue = new BoundedEventQueue();
  private readonly errors: RuntimeErrorRecord[] = [];
  private readonly listeners = new Set<(notice: CommitNotice) => void>();
  private readonly timers: TimerWakeService;
  private readonly evidence: RuntimeEvidenceEmitter;

  public constructor(
    private readonly admitted: AdmittedBlueprint,
    private readonly host: RuntimeHostContext
  ) {
    this.timers = new TimerWakeService(host.services.clock, host.services.scheduler);
    this.evidence = new RuntimeEvidenceEmitter(host.services.evidence, {
      runtime_version: host.trust.runtime_version,
      registry_version: host.trust.registry_snapshot.identity.registry_version
    });
  }

  public get status(): RuntimeStatus {
    return this.currentStatus;
  }

  /** The exact immutable admitted Blueprint; never written back to (F03-AC-021). */
  public get blueprint(): Blueprint | undefined {
    return this.index?.blueprint;
  }

  public get actionSequence(): number {
    return this.committedActions;
  }

  /** H01–H10: any failure leaves the Instance FATAL_ERROR and no partial store is ever published. */
  public async hydrate(): Promise<HydrationResult> {
    if (this.currentStatus !== "UNINITIALIZED") {
      return this.currentStatus === "READY" ? { status: "READY" } : { status: this.currentStatus, error: this.hydrationError };
    }
    this.currentStatus = "HYDRATING";
    this.evidence.emit("F03-EVT-001", { runtimeStatus: "HYDRATING" });
    try {
      const verified = await verifyAdmittedBlueprint(this.admitted, this.host.trust);
      this.evidence.bindBlueprintHash(verified.contentHash);
      const index = buildExecutionIndex(verified.blueprint, pinnedNodeBinder(this.host.trust));
      const store = emptyStore(seedPcg32(this.instanceSeed()));
      const tx = new StoreTransaction(index, store);
      tx.initialize();
      this.initializeCapabilities(index, tx);
      tx.commit();
      this.index = index;
      this.store = store;
      this.currentStatus = "READY";
      this.evidence.emit("F03-EVT-002", { runtimeStatus: "READY" });
      return { status: "READY" };
    } catch (error: unknown) {
      const failure = asFailure(error);
      this.currentStatus = "FATAL_ERROR";
      this.hydrationError = this.recordError(failure);
      this.evidence.emit("F03-EVT-003", { runtimeStatus: "FATAL_ERROR", errorCode: failure.code, capabilityId: failure.capabilityId });
      return { status: "FATAL_ERROR", error: this.hydrationError };
    }
  }

  /** Validates + enqueues, then drains synchronously unless a drain is already running (single writer, §15). */
  public dispatch(input: RuntimeEventInput): DispatchReceipt {
    const receipt = this.enqueue(input.source_node_instance_key, input.event_name, input.payload, input.origin);
    this.drain();
    return receipt;
  }

  public subscribe(listener: (notice: CommitNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public readState(key: string): RuntimeValue | undefined {
    return this.store?.mutable.get(key) ?? this.store?.derived.get(key);
  }

  public readRule(ruleId: string): RuleEntry | undefined {
    return this.store?.rules.get(ruleId);
  }

  public readCapabilityState(key: NodeInstanceKey): CapabilityState | undefined {
    return this.store?.capability.get(nodeInstanceKeyId(key))?.state;
  }

  /** Concrete node instances of the committed state in structural pre-order (§25). */
  public nodeInstances(): readonly ConcreteNodeInstance[] {
    const view = this.readView();
    return view === undefined ? [] : expandNodeInstances(view.index, view.tx.env);
  }

  /** Pure read of a ValueSource against committed state and, when given, a node instance's lexical scope. */
  public evaluateValue(source: ValueSource, key?: NodeInstanceKey): RuntimeValue {
    const view = this.readView() ?? invariantBroken("Runtime Instance is not hydrated.");
    const scope = key === undefined ? new Map<string, RuntimeValue>() : lexicalScopeOf(view.index, key, view.tx.env);
    return evaluateTyped(source, { ...view.tx.env, scope: scope ?? invariantBroken("Node instance key does not exist.") });
  }

  public timerObservation(key: NodeInstanceKey): TimerObservation | undefined {
    return this.timers.observe(nodeInstanceKeyId(key));
  }

  public rngMetadata(): RngMetadata | undefined {
    return this.store === undefined ? undefined : rngMetadata(this.store.rng);
  }

  public runtimeErrors(): readonly RuntimeErrorRecord[] {
    return [...this.errors];
  }

  private instanceSeed(): Uint8Array {
    try {
      return this.host.services.seedSource();
    } catch {
      return runtimeFail("F03-ERR-017", "Instance seed source failed.");
    }
  }

  private readView(): { readonly index: ExecutionIndex; readonly tx: StoreTransaction } | undefined {
    return this.index === undefined || this.store === undefined ? undefined : { index: this.index, tx: new StoreTransaction(this.index, this.store) };
  }

  /** H08: every concrete node instance gets its own capability-local slot keyed by NodeInstanceKey (BF-036). */
  private initializeCapabilities(index: ExecutionIndex, tx: StoreTransaction): void {
    for (const instance of expandNodeInstances(index, tx.env)) {
      const execution = index.nodeById.get(instance.key.node_id) ?? invariantBroken(`Node ${instance.key.node_id} is not indexed.`);
      const props = resolveProps(execution, tx.env, instance.scope);
      let state: CapabilityState | undefined;
      try {
        state = execution.handler.initialize(instance.key, { node: { node_id: execution.node.id, capability: execution.node.capability, props } });
      } catch (error: unknown) {
        if (error instanceof RuntimeFailure) {
          throw error;
        }
        throw new RuntimeFailure("F03-ERR-004", "Trusted capability initializer threw.", execution.node.capability.id);
      }
      tx.stageCapability(nodeInstanceKeyId(instance.key), { key: instance.key, state: deepFreeze(validateInitialState(execution, state)) });
    }
  }

  private admitEvent(key: NodeInstanceKey, eventName: string, payload: RuntimeValue): AdmittedEvent | DispatchRejection {
    const view = this.readView();
    if (view === undefined || this.currentStatus !== "READY") {
      return "INSTANCE_NOT_READY";
    }
    const execution = view.index.nodeById.get(key.node_id);
    const scope = execution === undefined ? undefined : lexicalScopeOf(view.index, key, view.tx.env);
    if (execution === undefined || scope === undefined) {
      return "INVALID_NODE_INSTANCE_KEY";
    }
    const descriptor = eventPayloadDescriptor(execution, eventName, resolveProps(execution, view.tx.env, scope), view.index);
    if (descriptor === undefined) {
      return "UNDECLARED_EVENT";
    }
    const owned = ownedPayload(payload);
    return owned !== undefined && valueConforms(owned, descriptor) ? { sourceNodeId: execution.node.id, scope, payload: owned } : "PAYLOAD_SCHEMA_MISMATCH";
  }

  private enqueue(key: NodeInstanceKey, eventName: string, payload: RuntimeValue, origin: EventOrigin): DispatchReceipt {
    let admitted: AdmittedEvent | DispatchRejection;
    try {
      admitted = this.admitEvent(key, eventName, payload);
    } catch (error: unknown) {
      const failure = asFailure(error);
      this.recordError(failure);
      if (failure.code === "F03-ERR-018") {
        this.fatal(failure);
      }
      return reject("INVALID_NODE_INSTANCE_KEY", failure.code);
    }
    if (typeof admitted === "string") {
      return reject(admitted);
    }
    const sequence = this.sequence + 1;
    const envelope: RuntimeEventEnvelope = {
      event_id_local: `evt-${sequence}`,
      sequence,
      source_node_id: admitted.sourceNodeId,
      source_node_instance_key: deepFreeze(structuredClone(key)),
      event_name: eventName,
      payload: admitted.payload,
      lexical_scope_bindings: admitted.scope,
      occurred_monotonic_ms: this.host.services.clock.now(),
      origin
    };
    if (!this.queue.offer(envelope)) {
      this.recordError(new RuntimeFailure("F03-ERR-014", "Event queue limit reached; event rejected."));
      return reject("EVENT_QUEUE_LIMIT", "F03-ERR-014");
    }
    this.sequence = sequence;
    return { accepted: true, sequence };
  }

  private drain(): void {
    if (this.draining) {
      return;
    }
    this.draining = true;
    try {
      this.runCycle();
    } finally {
      this.draining = false;
    }
  }

  private runCycle(): void {
    let processed = 0;
    let commits = 0;
    while (this.currentStatus === "READY" && this.queue.size > 0) {
      if (processed >= MAX_EVENTS_PER_CYCLE || commits >= MAX_COMMITS_PER_CYCLE) {
        this.triggerLoopGuard();
        return;
      }
      const event = this.queue.poll() ?? invariantBroken("Event queue size and contents disagree.");
      processed += 1;
      if (this.processEvent(event)) {
        commits += 1;
      }
    }
  }

  private processEvent(event: RuntimeEventEnvelope): boolean {
    try {
      return this.runEventAction(event);
    } catch (error: unknown) {
      if (!(error instanceof RuntimeFailure)) {
        throw error;
      }
      this.recordError(error);
      this.fatal(error);
      return false;
    }
  }

  /** F03 §31: commit → recompute (in transaction) → store notification → staged effects → emitted events. */
  private runEventAction(event: RuntimeEventEnvelope): boolean {
    const index = this.index ?? invariantBroken("Dispatch without hydrated index.");
    const store = this.store ?? invariantBroken("Dispatch without committed store.");
    const execution = index.nodeById.get(event.source_node_id) ?? invariantBroken(`Event source ${event.source_node_id} is not indexed.`);
    const actionId = Object.hasOwn(execution.node.events, event.event_name) ? execution.node.events[event.event_name] : undefined;
    if (actionId === undefined) {
      return false;
    }
    const action = index.actionById.get(actionId) ?? invariantBroken(`Mapped action ${actionId} does not exist.`);
    const tx = new StoreTransaction(index, store);
    try {
      executeAction(index, tx, action, { payload: event.payload, scope: event.lexical_scope_bindings }, this.host.services.clock);
    } catch (error: unknown) {
      this.rollBack(asFailure(error), action.id);
      return false;
    }
    tx.commit();
    this.committedActions += 1;
    this.evidence.emit("F03-EVT-004", { runtimeStatus: "READY" });
    const notice: CommitNotice = { action_id: action.id, action_sequence: this.committedActions };
    try {
      for (const listener of [...this.listeners]) {
        listener(notice);
      }
    } finally {
      this.runStagedEffects(tx.effects);
      for (const emitted of tx.events) {
        this.enqueueEmitted(emitted);
      }
    }
    return true;
  }

  /** The working transaction is simply dropped; committed store, RNG cursor and effects stay untouched (§16). */
  private rollBack(failure: RuntimeFailure, actionId: string): void {
    this.recordError(failure, actionId);
    this.evidence.emit("F03-EVT-005", { runtimeStatus: "READY", errorCode: failure.code, capabilityId: failure.capabilityId });
    if (failure.code === "F03-ERR-018") {
      this.fatal(failure);
    }
  }

  private fatal(failure: RuntimeFailure): void {
    if (this.currentStatus === "FATAL_ERROR") {
      return;
    }
    this.currentStatus = "FATAL_ERROR";
    this.queue.clear();
    this.timers.disarmAll();
    this.evidence.emit("F03-EVT-010", {
      runtimeStatus: "FATAL_ERROR",
      errorCode: failure.code,
      capabilityId: failure.capabilityId,
      integrityStatus: failure.code === "F03-ERR-018" ? "CORRUPTED" : undefined
    });
  }

  /** §15: stop the cycle, drop the pending chain, keep the last committed state (KEEP_CURRENT_APP). */
  private triggerLoopGuard(): void {
    this.queue.clear();
    this.recordError(new RuntimeFailure("F03-ERR-015", "Runtime loop guard stopped the dispatch cycle."));
    this.evidence.emit("F03-EVT-008", { runtimeStatus: this.currentStatus, errorCode: "F03-ERR-015" });
  }

  private runStagedEffects(effects: readonly StagedNodeEffect[]): void {
    for (const { source, effect } of effects) {
      const slot = nodeInstanceKeyId(source);
      switch (effect.kind) {
        case "SCHEDULE_TIMER":
          this.timers.arm(slot, effect.timer, () => {
            this.onTimerComplete(source, effect.completion_event);
          });
          break;
        case "CANCEL_TIMER":
          this.timers.disarm(slot);
          break;
        default:
          this.executeLocalEffect(source, effect);
      }
    }
  }

  /** Local effect failure is recorded but never rolls back the already-committed state (§21). */
  private executeLocalEffect(source: NodeInstanceKey, effect: Exclude<StagedEffect, { readonly kind: "SCHEDULE_TIMER" | "CANCEL_TIMER" }>): void {
    const capabilityId = this.index?.nodeById.get(source.node_id)?.node.capability.id;
    const port = this.host.services.effects;
    try {
      if (port === undefined) {
        throw new Error("No local effect broker is configured.");
      }
      port.execute(source, effect);
    } catch {
      this.recordError(new RuntimeFailure("F03-ERR-012", `Local effect ${effect.kind} failed.`, capabilityId));
    }
  }

  private onTimerComplete(source: NodeInstanceKey, eventName: string): void {
    const receipt = this.enqueue(source, eventName, {}, "TIMER");
    if (!receipt.accepted && receipt.reason !== "INSTANCE_NOT_READY" && receipt.reason !== "EVENT_QUEUE_LIMIT") {
      const capabilityId = this.index?.nodeById.get(source.node_id)?.node.capability.id;
      this.recordError(new RuntimeFailure("F03-ERR-016", `Timer completion event ${eventName} was rejected.`, capabilityId));
    }
    this.drain();
  }

  private enqueueEmitted(event: StagedEvent): void {
    this.enqueue(event.source, event.event_name, event.payload, "CAPABILITY");
  }

  private recordError(failure: RuntimeFailure, actionId?: string): RuntimeErrorRecord {
    const record: RuntimeErrorRecord = {
      code: failure.code,
      message: failure.message,
      ...(failure.capabilityId === undefined ? {} : { capability_id: failure.capabilityId }),
      ...(actionId === undefined ? {} : { action_id: actionId })
    };
    if (this.errors.length >= MAX_RECORDED_ERRORS) {
      this.errors.shift();
    }
    this.errors.push(record);
    return record;
  }
}
