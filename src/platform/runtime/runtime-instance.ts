import { valueConforms } from "../blueprint/type-descriptor.js";
import { BlueprintValidationFailure, type Blueprint, type ValueSource } from "../blueprint/validation-types.js";
import { executeAction } from "./action-executor.js";
import type { CapabilityState, LocalEffectPort, StagedEffect } from "./capability-protocol.js";
import {
  eventPayloadDescriptor,
  expandNodeInstances,
  lexicalScopeOf,
  parentInstanceKey,
  resolveProps,
  validateInitialState,
  type ConcreteNodeInstance,
  type LexicalScope
} from "./capability-runtime.js";
import { CloneLifecycleRegistry, type CloneIncarnation, type CloneLifecycleHost } from "./clone-lifecycle.js";
import {
  BoundedEventQueue,
  MAX_COMMITS_PER_CYCLE,
  MAX_EVENTS_PER_CYCLE,
  type EventOrigin,
  type RuntimeEventEnvelope
} from "./event-queue.js";
import { buildExecutionIndex, type ExecutionIndex, type NodeExecution } from "./execution-index.js";
import { evaluateTyped, type EvaluationEnv } from "./expression-vm.js";
import { pinnedNodeBinder, verifyAdmittedBlueprint, type AdmittedBlueprint, type HydrationTrust } from "./hydration-gate.js";
import {
  emptyStore,
  installCapabilitySlot,
  releaseCapabilitySlot,
  StoreTransaction,
  type CommittedStore,
  type RuleEntry,
  type StagedEvent,
  type StagedNodeEffect
} from "./instance-store.js";
import { TimerWakeService, type MonotonicClock, type TimerObservation, type WakeScheduler } from "./monotonic-timer.js";
import { nodeInstanceKeyId, type NodeInstanceKey } from "./node-instance-key.js";
import { renderNodeTree, type IsolationCause, type NodeIsolationRecord, type RuntimeNodeRenderer } from "./node-render.js";
import { rngMetadata, seedPcg32, type RngMetadata } from "./prng.js";
import { assertLocalStateWithinBudget, assertStaticResourceCeilings, assertTimerCeilings } from "./resource-guard.js";
import { invariantBroken, RuntimeFailure, runtimeFail, type F03ErrorCode } from "./runtime-errors.js";
import { RuntimeEvidenceEmitter, type OperationEvidence, type RuntimeEvidenceSink, type RuntimeStatus } from "./runtime-evidence.js";
import { assessCommittedIntegrity, IntegrityFailure, integrityOf, MonotonicReader, type IntegrityStatus } from "./runtime-integrity.js";
import {
  actionCheckpointPlan,
  HardDeadlineExceeded,
  OperationGuard,
  PRE_COMMIT_CHECKPOINT,
  RuntimeOperation,
  StaleOperation,
  type DiscardReason,
  type OperationGuardHost,
  type OperationListener,
  type RuntimeOperationHandle
} from "./runtime-operation.js";
import { deepFreeze, type RuntimeValue } from "./runtime-value.js";

export interface RuntimeServices {
  readonly clock: MonotonicClock;
  readonly scheduler: WakeScheduler;
  /** Cryptographically strong 16-byte seed source (F03 §23). */
  readonly seedSource: () => Uint8Array;
  readonly evidence?: RuntimeEvidenceSink;
  readonly effects?: LocalEffectPort;
  /** F07 PRODUCT_SAMPLE decision for this Instance session (F03-EVT-011 / -012); unsampled when omitted. */
  readonly productEvidenceSampled?: boolean;
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
  /** Lifecycle generation the dispatch site was rendered with; a mismatch means a removed incarnation. */
  readonly lifecycle_generation?: number;
  /** F12 recovery episode of a Retry; the Retry still receives a fresh operation token. */
  readonly recovery_episode_id?: string;
}

export type DispatchRejection =
  | "INSTANCE_NOT_READY"
  | "INSTANCE_DISPOSED"
  | "INVALID_NODE_INSTANCE_KEY"
  | "STALE_LIFECYCLE_GENERATION"
  | "NODE_ISOLATED"
  | "UNDECLARED_EVENT"
  | "PAYLOAD_SCHEMA_MISMATCH"
  | "EVENT_QUEUE_LIMIT";

export type DispatchReceipt =
  | { readonly accepted: true; readonly sequence: number }
  | { readonly accepted: false; readonly reason: DispatchRejection; readonly error_code?: F03ErrorCode };

type DispatchDenied = Extract<DispatchReceipt, { readonly accepted: false }>;

export type RuntimeDispatchResult = { readonly accepted: true; readonly sequence: number; readonly operation: RuntimeOperationHandle } | DispatchDenied;

export interface RuntimeErrorRecord {
  readonly code: F03ErrorCode;
  readonly message: string;
  readonly capability_id?: string;
  readonly action_id?: string;
  readonly node_instance_key?: NodeInstanceKey;
  readonly operation_token?: string;
  /** F12 handoff precondition: PROVEN for F03-ERR-021, never PROVEN for F03-ERR-018. */
  readonly integrity_status?: IntegrityStatus;
}

export type HydrationResult =
  | { readonly status: "READY" }
  | { readonly status: Exclude<RuntimeStatus, "READY">; readonly error?: RuntimeErrorRecord };

export interface CommitNotice {
  readonly action_id: string;
  readonly action_sequence: number;
}

export type { NodeIsolationRecord, NodeRenderInput, RuntimeNodeRenderer } from "./node-render.js";

interface AdmittedEvent {
  readonly sourceNodeId: string;
  readonly scope: LexicalScope;
  readonly payload: RuntimeValue;
  readonly generation: number;
  readonly plan: readonly string[] | undefined;
}

interface EnqueueRequest {
  readonly key: NodeInstanceKey;
  readonly eventName: string;
  readonly payload: RuntimeValue;
  readonly origin: EventOrigin;
  readonly generation?: number;
  readonly recoveryEpisodeId?: string;
}

interface ErrorContext {
  readonly capabilityId?: string;
  readonly actionId?: string;
  readonly node?: NodeInstanceKey;
  readonly operation?: RuntimeOperation;
  readonly integrity?: IntegrityStatus;
}

interface ReadView {
  readonly index: ExecutionIndex;
  readonly tx: StoreTransaction;
}

const MAX_RECORDED_ERRORS = 128;
const RECORDED_TIMER_REJECTIONS: ReadonlySet<DispatchRejection> = new Set(["INVALID_NODE_INSTANCE_KEY", "UNDECLARED_EVENT", "PAYLOAD_SCHEMA_MISMATCH"]);

function asFailure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailure) {
    return error;
  }
  if (error instanceof BlueprintValidationFailure) {
    return new RuntimeFailure("F03-ERR-001", "Admitted Blueprint failed Runtime re-analysis.");
  }
  return new RuntimeFailure("F03-ERR-018", "Unexpected Runtime exception.");
}

function reject(reason: DispatchRejection, errorCode?: F03ErrorCode): DispatchDenied {
  return errorCode === undefined ? { accepted: false, reason } : { accepted: false, reason, error_code: errorCode };
}

function ownedPayload(payload: RuntimeValue): RuntimeValue | undefined {
  try {
    return deepFreeze(structuredClone(payload));
  } catch {
    return undefined;
  }
}

function executionOf(index: ExecutionIndex, nodeId: string): NodeExecution {
  return index.nodeById.get(nodeId) ?? invariantBroken(`Node ${nodeId} is not indexed.`);
}

function checkpointPlanFor(index: ExecutionIndex, execution: NodeExecution, eventName: string): readonly string[] | undefined {
  const actionId = Object.hasOwn(execution.node.events, eventName) ? execution.node.events[eventName] : undefined;
  const action = actionId === undefined ? undefined : index.actionById.get(actionId);
  return action === undefined ? undefined : actionCheckpointPlan(action.steps.length);
}

/**
 * One isolated Runtime Instance (F03 §7). Only this class mutates its committed store, and only through a
 * committed StoreTransaction inside the single-writer drain loop, under a current RuntimeOperation token.
 */
export class RuntimeInstance {
  private currentStatus: RuntimeStatus = "UNINITIALIZED";
  private index: ExecutionIndex | undefined;
  private store: CommittedStore | undefined;
  private hydrationError: RuntimeErrorRecord | undefined;
  private sequence = 0;
  private committedActions = 0;
  private operations = 0;
  private epoch = 0;
  private draining = false;
  private dynamicClones = false;
  private active: RuntimeOperation | undefined;
  private readonly sessionId: string = globalThis.crypto.randomUUID();
  private readonly queue = new BoundedEventQueue();
  private readonly errors: RuntimeErrorRecord[] = [];
  private readonly listeners = new Set<(notice: CommitNotice) => void>();
  private readonly operationListeners = new Set<OperationListener>();
  private readonly lifecycle = new CloneLifecycleRegistry();
  private readonly nodeErrors = new Map<string, NodeIsolationRecord>();
  private readonly timers: TimerWakeService;
  private readonly evidence: RuntimeEvidenceEmitter;
  private readonly reader: MonotonicReader;
  private readonly guardHost: OperationGuardHost;
  private readonly forwardOperation: OperationListener;

  public constructor(
    private readonly admitted: AdmittedBlueprint,
    private readonly host: RuntimeHostContext
  ) {
    this.timers = new TimerWakeService(host.services.clock, host.services.scheduler);
    this.reader = new MonotonicReader(host.services.clock);
    this.evidence = new RuntimeEvidenceEmitter(
      host.services.evidence,
      { runtime_version: host.trust.runtime_version, registry_version: host.trust.registry_snapshot.identity.registry_version },
      { productSampled: host.services.productEvidenceSampled }
    );
    this.guardHost = {
      context: () => ({ current: this.active, instanceEpoch: this.epoch }),
      now: () => this.reader.read(),
      softTimeoutObserved: (operation) => this.emitOperation({ type: "F03-EVT-013" }, operation),
      checkpointCompleted: (operation, checkpointId) => this.emitOperation({ type: "F03-EVT-012", checkpointId }, operation)
    };
    this.forwardOperation = (projection) => {
      for (const listener of [...this.operationListeners]) {
        try {
          listener(projection);
        } catch {
          // Presentation listeners never decide commit, rollback or recovery.
        }
      }
    };
  }

  public get status(): RuntimeStatus {
    return this.currentStatus;
  }

  /** Local opaque Instance session id; not the Blueprint hash and not a durable identity (F03 §5). */
  public get instanceSessionId(): string {
    return this.sessionId;
  }

  public get instanceEpoch(): number {
    return this.epoch;
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
      return this.hydrationOutcome();
    }
    this.currentStatus = "HYDRATING";
    this.evidence.emit("F03-EVT-001", { runtimeStatus: "HYDRATING" });
    try {
      const verified = await verifyAdmittedBlueprint(this.admitted, this.host.trust);
      if (this.currentStatus !== "HYDRATING") {
        return this.hydrationOutcome();
      }
      this.evidence.bindBlueprintHash(verified.contentHash);
      const index = buildExecutionIndex(verified.blueprint, pinnedNodeBinder(this.host.trust));
      assertStaticResourceCeilings(index);
      const store = emptyStore(seedPcg32(this.instanceSeed()));
      const tx = new StoreTransaction(index, store);
      tx.initialize();
      this.lifecycle.reconcile(
        expandNodeInstances(index, tx.env),
        this.lifecycleHost((incarnation, instance) => tx.stageCapability(incarnation.keyId, { key: instance.key, state: this.initialState(index, instance, tx.env) }))
      );
      tx.commit();
      this.index = index;
      this.store = store;
      this.dynamicClones = [...index.nodeById.values()].some((execution) => execution.node.repeat !== undefined);
      this.currentStatus = "READY";
      this.evidence.emit("F03-EVT-002", { runtimeStatus: "READY" });
      return { status: "READY" };
    } catch (error: unknown) {
      return this.currentStatus === "HYDRATING" ? this.failHydration(asFailure(error)) : this.hydrationOutcome();
    }
  }

  /** Validates + enqueues, then drains synchronously unless a drain is already running (single writer, §15). */
  public dispatch(input: RuntimeEventInput): DispatchReceipt {
    const result = this.dispatchRuntimeEvent(input);
    return result.accepted ? { accepted: true, sequence: result.sequence } : result;
  }

  /** Same as `dispatch`, plus the admitted interaction's RuntimeOperation handle (F03-RQ-012). */
  public dispatchRuntimeEvent(input: RuntimeEventInput): RuntimeDispatchResult {
    const result = this.enqueue({
      key: input.source_node_instance_key,
      eventName: input.event_name,
      payload: input.payload,
      origin: input.origin,
      generation: input.lifecycle_generation,
      recoveryEpisodeId: input.recovery_episode_id
    });
    this.drain();
    return result;
  }

  public subscribe(listener: (notice: CommitNotice) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Every RuntimeOperation projection change, from admission (STARTED) to its terminal status. */
  public subscribeOperations(listener: OperationListener): () => void {
    this.operationListeners.add(listener);
    return () => {
      this.operationListeners.delete(listener);
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

  public lifecycleGeneration(key: NodeInstanceKey): number | undefined {
    return this.lifecycle.incarnation(nodeInstanceKeyId(key))?.generation;
  }

  public nodeIsolation(key: NodeInstanceKey): NodeIsolationRecord | undefined {
    return this.nodeErrors.get(nodeInstanceKeyId(key));
  }

  /** Pure read of a ValueSource against committed state and, when given, a node instance's lexical scope. */
  public evaluateValue(source: ValueSource, key?: NodeInstanceKey): RuntimeValue {
    const view = this.readView() ?? invariantBroken("Runtime Instance is not hydrated.");
    const scope = key === undefined ? new Map<string, RuntimeValue>() : lexicalScopeOf(view.index, key, view.tx.env);
    return evaluateTyped(source, { ...view.tx.env, scope: scope ?? invariantBroken("Node instance key does not exist.") });
  }

  /**
   * One render pass over committed state (F03-RQ-009). A failing node is isolated to its node-local error slot and
   * replaced by the renderer's fallback; the rest of the App keeps rendering its last-known-good state.
   */
  public renderTree<T>(renderer: RuntimeNodeRenderer<T>): T | undefined {
    const view = this.readView();
    if (view === undefined || this.currentStatus !== "READY") {
      return undefined;
    }
    try {
      return renderNodeTree(
        {
          index: view.index,
          env: view.tx.env,
          instances: expandNodeInstances(view.index, view.tx.env),
          isolation: (keyId) => this.nodeErrors.get(keyId),
          generation: (keyId) => this.lifecycle.incarnation(keyId)?.generation ?? 0,
          isolate: (instance, failure) => this.isolateNode(instance.key, executionOf(view.index, instance.key.node_id), failure, "RENDER")
        },
        renderer
      );
    } catch (error: unknown) {
      if (!(error instanceof RuntimeFailure) || error.code !== "F03-ERR-018") {
        throw error;
      }
      this.recordError(error);
      this.fatal(error);
      return undefined;
    }
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

  /**
   * DISPOSED is terminal: the epoch advances so every in-flight completion is stale, open tokens close as CANCELLED,
   * timers are revoked, every clone incarnation is torn down and host listeners are released.
   */
  public dispose(): void {
    if (this.currentStatus === "DISPOSED") {
      return;
    }
    this.currentStatus = "DISPOSED";
    this.epoch += 1;
    this.active?.close("CANCELLED");
    this.cancelOperations(this.queue.clear());
    this.timers.disarmAll();
    try {
      this.lifecycle.teardownAll(this.lifecycleHost(() => undefined));
    } catch (error: unknown) {
      this.recordError(asFailure(error));
    }
    this.listeners.clear();
    this.operationListeners.clear();
  }

  private hydrationOutcome(): HydrationResult {
    return this.currentStatus === "READY" ? { status: "READY" } : { status: this.currentStatus, error: this.hydrationError };
  }

  private failHydration(failure: RuntimeFailure): HydrationResult {
    this.currentStatus = "FATAL_ERROR";
    this.hydrationError = this.recordError(failure);
    this.evidence.emit("F03-EVT-003", { runtimeStatus: "FATAL_ERROR", errorCode: failure.code, capabilityId: failure.capabilityId });
    return { status: "FATAL_ERROR", error: this.hydrationError };
  }

  private instanceSeed(): Uint8Array {
    try {
      return this.host.services.seedSource();
    } catch {
      return runtimeFail("F03-ERR-017", "Instance seed source failed.");
    }
  }

  private readView(): ReadView | undefined {
    return this.index === undefined || this.store === undefined ? undefined : { index: this.index, tx: new StoreTransaction(this.index, this.store) };
  }

  /** H08 / added clone: one capability-local slot per NodeInstanceKey (BF-036), within the pinned local-state budget. */
  private initialState(index: ExecutionIndex, instance: ConcreteNodeInstance, env: EvaluationEnv): CapabilityState | undefined {
    const execution = executionOf(index, instance.key.node_id);
    const props = resolveProps(execution, env, instance.scope);
    let state: CapabilityState | undefined;
    try {
      state = execution.handler.initialize(instance.key, { node: { node_id: execution.node.id, capability: execution.node.capability, props } });
    } catch (error: unknown) {
      if (error instanceof RuntimeFailure) {
        throw error;
      }
      throw new RuntimeFailure("F03-ERR-004", "Trusted capability initializer threw.", execution.node.capability.id);
    }
    const validated = validateInitialState(execution, state);
    assertLocalStateWithinBudget(execution, validated, "F03-ERR-004");
    return deepFreeze(validated);
  }

  private lifecycleHost(
    initialize: (incarnation: CloneIncarnation, instance: ConcreteNodeInstance) => void
  ): CloneLifecycleHost<ConcreteNodeInstance> {
    return {
      cancelPending: (removed) =>
        this.cancelOperations(this.queue.removeWhere((event) => removed.has(nodeInstanceKeyId(event.source_node_instance_key)))),
      revokeHostResources: (incarnation) => this.timers.disarm(incarnation.keyId),
      disposeHandler: (incarnation) =>
        this.index?.nodeById.get(incarnation.key.node_id)?.handler.dispose?.(incarnation.key, this.store?.capability.get(incarnation.keyId)?.state),
      releaseLocalState: (incarnation) => {
        if (this.store !== undefined) {
          releaseCapabilitySlot(this.store, incarnation.keyId);
        }
        this.nodeErrors.delete(incarnation.keyId);
      },
      retainsResources: (incarnation) =>
        this.timers.isArmed(incarnation.keyId) || this.store?.capability.has(incarnation.keyId) === true || this.nodeErrors.has(incarnation.keyId),
      teardownStepFailed: (incarnation, step) => {
        const code: F03ErrorCode = step === "REVOKE_HOST_RESOURCES" ? "F03-ERR-016" : "F03-ERR-011";
        const capabilityId = this.index?.nodeById.get(incarnation.key.node_id)?.node.capability.id;
        this.recordError(new RuntimeFailure(code, `Removed clone teardown step ${step} failed.`, capabilityId), { node: incarnation.key });
      },
      initialize
    };
  }

  /** After each commit: removed clones are invalidated and torn down, then added clones initialize as new incarnations. */
  private reconcileClones(index: ExecutionIndex, store: CommittedStore): void {
    if (!this.dynamicClones) {
      return;
    }
    const env = new StoreTransaction(index, store).env;
    this.lifecycle.reconcile(
      expandNodeInstances(index, env),
      this.lifecycleHost((incarnation, instance) => this.initializeClone(index, store, incarnation, instance))
    );
  }

  /** A failed added-clone initializer isolates only that clone; the Instance and its siblings stay READY. */
  private initializeClone(index: ExecutionIndex, store: CommittedStore, incarnation: CloneIncarnation, instance: ConcreteNodeInstance): void {
    try {
      const state = this.initialState(index, instance, new StoreTransaction(index, store).env);
      installCapabilitySlot(store, incarnation.keyId, { key: instance.key, state });
    } catch (error: unknown) {
      const failure = asFailure(error);
      if (failure.code === "F03-ERR-018") {
        throw failure;
      }
      this.isolateNode(instance.key, executionOf(index, instance.key.node_id), failure, "INITIALIZE");
    }
  }

  private isolateNode(key: NodeInstanceKey, execution: NodeExecution, failure: RuntimeFailure, cause: IsolationCause): NodeIsolationRecord {
    const keyId = nodeInstanceKeyId(key);
    const record: NodeIsolationRecord = deepFreeze({
      node_instance_key: structuredClone(key),
      node_id: execution.node.id,
      capability_id: execution.node.capability.id,
      error_code: failure.code,
      message: failure.message,
      cause,
      lifecycle_generation: this.lifecycle.incarnation(keyId)?.generation ?? 0
    });
    this.nodeErrors.set(keyId, record);
    this.recordError(failure, { node: key, capabilityId: execution.node.capability.id });
    this.evidence.emit("F03-EVT-007", { runtimeStatus: this.currentStatus, errorCode: failure.code, capabilityId: execution.node.capability.id });
    return record;
  }

  private isolatedSubtree(index: ExecutionIndex, key: NodeInstanceKey): boolean {
    for (let current: NodeInstanceKey | undefined = key; current !== undefined; current = parentInstanceKey(index, current)) {
      if (this.nodeErrors.has(nodeInstanceKeyId(current))) {
        return true;
      }
    }
    return false;
  }

  private resolveSource(view: ReadView, request: EnqueueRequest): { readonly execution: NodeExecution; readonly scope: LexicalScope; readonly generation: number } | DispatchRejection {
    const execution = view.index.nodeById.get(request.key.node_id);
    const scope = execution === undefined ? undefined : lexicalScopeOf(view.index, request.key, view.tx.env);
    if (execution === undefined || scope === undefined) {
      return "INVALID_NODE_INSTANCE_KEY";
    }
    const incarnation = this.lifecycle.incarnation(nodeInstanceKeyId(request.key));
    if (incarnation === undefined) {
      return "INVALID_NODE_INSTANCE_KEY";
    }
    if (request.generation !== undefined && request.generation !== incarnation.generation) {
      return "STALE_LIFECYCLE_GENERATION";
    }
    return this.isolatedSubtree(view.index, request.key) ? "NODE_ISOLATED" : { execution, scope, generation: incarnation.generation };
  }

  private admitEvent(request: EnqueueRequest): AdmittedEvent | DispatchRejection {
    const view = this.readView();
    if (view === undefined || this.currentStatus !== "READY") {
      return "INSTANCE_NOT_READY";
    }
    const source = this.resolveSource(view, request);
    if (typeof source === "string") {
      return source;
    }
    const { execution, scope, generation } = source;
    const descriptor = eventPayloadDescriptor(execution, request.eventName, resolveProps(execution, view.tx.env, scope), view.index);
    if (descriptor === undefined) {
      return "UNDECLARED_EVENT";
    }
    const owned = ownedPayload(request.payload);
    if (owned === undefined || !valueConforms(owned, descriptor)) {
      return "PAYLOAD_SCHEMA_MISMATCH";
    }
    return { sourceNodeId: execution.node.id, scope, payload: owned, generation, plan: checkpointPlanFor(view.index, execution, request.eventName) };
  }

  private admitWithClock(request: EnqueueRequest): { readonly event: AdmittedEvent; readonly admittedMs: number } | DispatchDenied {
    try {
      const event = this.admitEvent(request);
      return typeof event === "string" ? reject(event) : { event, admittedMs: this.reader.read() };
    } catch (error: unknown) {
      const failure = asFailure(error);
      this.recordError(failure);
      if (failure.code === "F03-ERR-018") {
        this.fatal(failure);
      }
      return reject(failure instanceof IntegrityFailure ? "INSTANCE_NOT_READY" : "INVALID_NODE_INSTANCE_KEY", failure.code);
    }
  }

  /** Admission creates exactly one RuntimeOperation with a unique token; a rejected event never gets one. */
  private enqueue(request: EnqueueRequest): RuntimeDispatchResult {
    if (this.currentStatus === "DISPOSED") {
      return reject("INSTANCE_DISPOSED", "F03-ERR-020");
    }
    const admitted = this.admitWithClock(request);
    if ("accepted" in admitted) {
      return admitted;
    }
    const { event, admittedMs } = admitted;
    const operation = new RuntimeOperation({
      token: `${this.sessionId}-op-${this.operations + 1}`,
      instanceEpoch: this.epoch,
      admittedMs,
      checkpointPlan: event.plan,
      recoveryEpisodeId: request.recoveryEpisodeId
    });
    const sequence = this.sequence + 1;
    const envelope: RuntimeEventEnvelope = {
      event_id_local: `evt-${sequence}`,
      sequence,
      source_node_id: event.sourceNodeId,
      source_node_instance_key: deepFreeze(structuredClone(request.key)),
      event_name: request.eventName,
      payload: event.payload,
      lexical_scope_bindings: event.scope,
      occurred_monotonic_ms: admittedMs,
      origin: request.origin,
      source_generation: event.generation,
      operation
    };
    if (!this.queue.offer(envelope)) {
      this.recordError(new RuntimeFailure("F03-ERR-014", "Event queue limit reached; event rejected."));
      return reject("EVENT_QUEUE_LIMIT", "F03-ERR-014");
    }
    this.sequence = sequence;
    this.operations += 1;
    operation.handle.subscribe(this.forwardOperation);
    this.forwardOperation(operation.projection());
    this.emitOperation({ type: "F03-EVT-011" }, operation);
    return { accepted: true, sequence, operation: operation.handle };
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
    const { operation } = event;
    if (!this.lifecycle.isCurrent(nodeInstanceKeyId(event.source_node_instance_key), event.source_generation)) {
      operation.close("CANCELLED");
      return false;
    }
    this.active = operation;
    operation.begin();
    try {
      return this.runEventAction(event, operation, this.store?.revision);
    } catch (error: unknown) {
      if (!(error instanceof RuntimeFailure)) {
        throw error;
      }
      operation.close("FAILED");
      this.recordError(error, { operation });
      this.fatal(error);
      return false;
    } finally {
      if (this.active === operation) {
        this.active = undefined;
      }
    }
  }

  /**
   * F03 §31 under the operation guard: guarded steps → pre-commit validation + mandatory pre-commit guard → commit →
   * clone reconcile → store notification → staged effects → emitted events.
   */
  private runEventAction(event: RuntimeEventEnvelope, operation: RuntimeOperation, baseline: number | undefined): boolean {
    const index = this.index ?? invariantBroken("Dispatch without hydrated index.");
    const store = this.store ?? invariantBroken("Dispatch without committed store.");
    const execution = executionOf(index, event.source_node_id);
    const actionId = Object.hasOwn(execution.node.events, event.event_name) ? execution.node.events[event.event_name] : undefined;
    if (actionId === undefined) {
      operation.markCommitted();
      return false;
    }
    const action = index.actionById.get(actionId) ?? invariantBroken(`Mapped action ${actionId} does not exist.`);
    const guard = new OperationGuard(operation, this.guardHost);
    const tx = new StoreTransaction(index, store, (boundary) => guard.check(boundary));
    try {
      guard.check("OPERATION_ADMISSION");
      executeAction({ index, tx, action, envelope: { payload: event.payload, scope: event.lexical_scope_bindings }, clock: this.host.services.clock, guard });
      this.preCommit(guard, index, tx, baseline);
    } catch (error: unknown) {
      this.abandon(error, operation, action.id, baseline);
      return false;
    }
    tx.commit();
    operation.markCommitted();
    this.committedActions += 1;
    this.reconcileClones(index, store);
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

  /** commit_ready only after pre-commit validation; the guard runs last, immediately before the single commit. */
  private preCommit(guard: OperationGuard, index: ExecutionIndex, tx: StoreTransaction, baseline: number | undefined): void {
    assertTimerCeilings(index, this.timers.armedSlots(), tx.effects);
    guard.check("PRE_COMMIT");
    const integrity = this.committedIntegrity(baseline);
    if (integrity !== "PROVEN") {
      throw new IntegrityFailure(integrity, "Committed store changed outside the current operation.");
    }
    guard.checkpoint(PRE_COMMIT_CHECKPOINT);
  }

  private committedIntegrity(baseline: number | undefined): IntegrityStatus {
    return assessCommittedIntegrity(baseline, this.store?.revision, this.currentStatus === "READY");
  }

  /** The working transaction is dropped; only the operation outcome differs by cause. */
  private abandon(error: unknown, operation: RuntimeOperation, actionId: string, baseline: number | undefined): void {
    if (error instanceof StaleOperation) {
      this.discardCompletion(operation, error.reason);
      return;
    }
    if (error instanceof HardDeadlineExceeded) {
      this.timeOut(operation, error, actionId, baseline);
      return;
    }
    operation.close("FAILED");
    this.rollBack(asFailure(error), actionId, operation);
  }

  private discardCompletion(operation: RuntimeOperation, reason: DiscardReason): void {
    operation.close("CANCELLED");
    this.emitOperation({ type: "F03-EVT-015", discardReason: reason }, operation);
  }

  /**
   * F03-RQ-014 / -016: the token closes TIMED_OUT and its staged transaction is gone. Only PROVEN integrity yields the
   * recoverable F03-ERR-021 handoff with last committed state kept; otherwise F03-ERR-018 replaces the timeout path.
   */
  private timeOut(operation: RuntimeOperation, error: HardDeadlineExceeded, actionId: string, baseline: number | undefined): void {
    operation.close("TIMED_OUT");
    if (error.lateCompletion) {
      this.emitOperation({ type: "F03-EVT-015", discardReason: "HARD_DEADLINE_ELAPSED" }, operation);
    }
    const integrity = this.committedIntegrity(baseline);
    if (integrity !== "PROVEN") {
      const failure = new IntegrityFailure(integrity, "Runtime integrity cannot be proven after a hard timeout.");
      this.recordError(failure, { actionId, operation });
      this.fatal(failure);
      return;
    }
    this.recordError(error, { actionId, operation, integrity: "PROVEN" });
    this.emitOperation({ type: "F03-EVT-014" }, operation);
    this.emitOperation({ type: "F03-EVT-016" }, operation);
  }

  private rollBack(failure: RuntimeFailure, actionId: string, operation: RuntimeOperation): void {
    this.recordError(failure, { actionId, operation });
    this.evidence.emit("F03-EVT-005", { runtimeStatus: "READY", errorCode: failure.code, capabilityId: failure.capabilityId });
    if (failure.code === "F03-ERR-018") {
      this.fatal(failure);
    }
  }

  private fatal(failure: RuntimeFailure): void {
    if (this.currentStatus === "FATAL_ERROR" || this.currentStatus === "DISPOSED") {
      return;
    }
    this.currentStatus = "FATAL_ERROR";
    this.cancelOperations(this.queue.clear());
    this.timers.disarmAll();
    this.evidence.emit("F03-EVT-010", {
      runtimeStatus: "FATAL_ERROR",
      errorCode: failure.code,
      capabilityId: failure.capabilityId,
      integrityStatus: integrityOf(failure)
    });
  }

  private cancelOperations(events: readonly RuntimeEventEnvelope[]): void {
    for (const event of events) {
      event.operation.close("CANCELLED");
    }
  }

  /** §15: stop the cycle, drop the pending chain, keep the last committed state (KEEP_CURRENT_APP). */
  private triggerLoopGuard(): void {
    this.cancelOperations(this.queue.clear());
    this.recordError(new RuntimeFailure("F03-ERR-015", "Runtime loop guard stopped the dispatch cycle."));
    this.evidence.emit("F03-EVT-008", { runtimeStatus: this.currentStatus, errorCode: "F03-ERR-015" });
  }

  private emitOperation(evidence: OperationEvidence, operation: RuntimeOperation): void {
    this.evidence.emitOperation(evidence, operation, { runtimeStatus: this.currentStatus, instanceSessionId: this.sessionId });
  }

  /** Effects of an incarnation removed by the same commit are dropped: a removed clone never arms a timer. */
  private runStagedEffects(effects: readonly StagedNodeEffect[]): void {
    for (const { source, effect } of effects) {
      const slot = nodeInstanceKeyId(source);
      const incarnation = this.lifecycle.incarnation(slot);
      if (incarnation === undefined) {
        continue;
      }
      switch (effect.kind) {
        case "SCHEDULE_TIMER":
          this.timers.arm(slot, effect.timer, () => {
            this.onTimerComplete(source, effect.completion_event, incarnation.generation);
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

  /** A late timer callback of a disposed Instance or a removed incarnation is ignored, never re-admitted. */
  private onTimerComplete(source: NodeInstanceKey, eventName: string, generation: number): void {
    if (this.currentStatus !== "READY" || !this.lifecycle.isCurrent(nodeInstanceKeyId(source), generation)) {
      return;
    }
    const receipt = this.enqueue({ key: source, eventName, payload: {}, origin: "TIMER", generation });
    if (!receipt.accepted && RECORDED_TIMER_REJECTIONS.has(receipt.reason)) {
      const capabilityId = this.index?.nodeById.get(source.node_id)?.node.capability.id;
      this.recordError(new RuntimeFailure("F03-ERR-016", `Timer completion event ${eventName} was rejected.`, capabilityId));
    }
    this.drain();
  }

  private enqueueEmitted(event: StagedEvent): void {
    this.enqueue({ key: event.source, eventName: event.event_name, payload: event.payload, origin: "CAPABILITY" });
  }

  private recordError(failure: RuntimeFailure, context: ErrorContext = {}): RuntimeErrorRecord {
    const integrity = context.integrity ?? integrityOf(failure);
    const capabilityId = failure.capabilityId ?? context.capabilityId;
    const record: RuntimeErrorRecord = {
      code: failure.code,
      message: failure.message,
      ...(capabilityId === undefined ? {} : { capability_id: capabilityId }),
      ...(context.actionId === undefined ? {} : { action_id: context.actionId }),
      ...(context.node === undefined ? {} : { node_instance_key: deepFreeze(structuredClone(context.node)) }),
      ...(context.operation === undefined ? {} : { operation_token: context.operation.token }),
      ...(integrity === undefined ? {} : { integrity_status: integrity })
    };
    if (this.errors.length >= MAX_RECORDED_ERRORS) {
      this.errors.shift();
    }
    this.errors.push(record);
    return record;
  }
}
