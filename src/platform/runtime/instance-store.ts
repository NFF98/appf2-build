import { RESET_ALL_MUTABLE } from "../blueprint/blueprint-schema.js";
import { valueConforms } from "../blueprint/type-descriptor.js";
import type { CapabilityEmittedEvent, CapabilityState, StagedEffect } from "./capability-protocol.js";
import type { EvaluationVertex, ExecutionIndex } from "./execution-index.js";
import { evaluateTyped, type EvaluationEnv } from "./expression-vm.js";
import type { NodeInstanceKey } from "./node-instance-key.js";
import { Pcg32Cursor, type Pcg32State } from "./prng.js";
import { invariantBroken, RuntimeFailure, runtimeFail } from "./runtime-errors.js";
import { admittedRuntimeValue, matchesBaseType, type RuntimeValue } from "./runtime-value.js";

/** Rule cache entry; a failed rule is never defaulted to a value (F03 §13 rule 4). */
export type RuleEntry =
  | { readonly ok: true; readonly value: RuntimeValue }
  | { readonly ok: false; readonly failure: RuntimeFailure };

export interface CapabilitySlot {
  readonly key: NodeInstanceKey;
  readonly state: CapabilityState | undefined;
}

/**
 * Last committed Instance state. Only `StoreTransaction.commit` and the clone lifecycle slot transitions below write
 * it; each write bumps `revision`, which is what makes "committed state untouched" provable.
 */
export interface CommittedStore {
  readonly mutable: Map<string, RuntimeValue>;
  readonly derived: Map<string, RuntimeValue>;
  readonly rules: Map<string, RuleEntry>;
  readonly capability: Map<string, CapabilitySlot>;
  rng: Pcg32State;
  revision: number;
}

export type RecomputeBoundary = "RECOMPUTE_BEFORE" | "RECOMPUTE_AFTER";

export interface StagedEvent extends CapabilityEmittedEvent {
  readonly source: NodeInstanceKey;
}

export interface StagedNodeEffect {
  readonly source: NodeInstanceKey;
  readonly effect: StagedEffect;
}

export function emptyStore(rng: Pcg32State): CommittedStore {
  return { mutable: new Map(), derived: new Map(), rules: new Map(), capability: new Map(), rng, revision: 0 };
}

/** Lifecycle transition for a clone added after hydration; never part of an Action transaction. */
export function installCapabilitySlot(store: CommittedStore, keyId: string, slot: CapabilitySlot): void {
  store.capability.set(keyId, slot);
  store.revision += 1;
}

/** Lifecycle transition for a removed clone: its capability-local state is released, never reused. */
export function releaseCapabilitySlot(store: CommittedStore, keyId: string): void {
  if (store.capability.delete(keyId)) {
    store.revision += 1;
  }
}

/**
 * Copy-on-write working state over the committed store (F03-RQ-007). Reads see working writes first, so a later
 * Action step observes earlier mutations and their recomputed derived/rule values; discarding the transaction
 * leaves the committed store untouched.
 */
export class StoreTransaction {
  public readonly env: EvaluationEnv;
  public readonly rng: Pcg32Cursor;
  public readonly events: StagedEvent[] = [];
  public readonly effects: StagedNodeEffect[] = [];
  private readonly mutable = new Map<string, RuntimeValue>();
  private readonly derived = new Map<string, RuntimeValue>();
  private readonly rules = new Map<string, RuleEntry>();
  private readonly capability = new Map<string, CapabilitySlot>();

  public constructor(
    private readonly index: ExecutionIndex,
    private readonly committed: CommittedStore,
    private readonly guard?: (boundary: RecomputeBoundary) => void
  ) {
    this.rng = new Pcg32Cursor(committed.rng);
    this.env = { readState: (key) => this.readState(key), readRule: (ruleId) => this.readRule(ruleId) };
  }

  public readState(key: string): RuntimeValue {
    const value = this.mutable.get(key) ?? this.committed.mutable.get(key) ?? this.derived.get(key) ?? this.committed.derived.get(key);
    return value ?? invariantBroken(`STATE ${key} is not a declared state.`);
  }

  public readRule(ruleId: string): RuntimeValue {
    const entry = this.rules.get(ruleId) ?? this.committed.rules.get(ruleId) ?? invariantBroken(`RULE ${ruleId} does not exist.`);
    if (!entry.ok) {
      throw new RuntimeFailure("F03-ERR-006", `RULE ${ruleId} evaluation failed: ${entry.failure.code}.`);
    }
    return entry.value;
  }

  /** H04 + H06 + H07: initial mutable state then every derived state / rule in topological order. */
  public initialize(): void {
    for (const [key, descriptor] of this.index.mutable) {
      const value = this.initialValue(key);
      if (!valueConforms(value, descriptor)) {
        invariantBroken(`Initial value of ${key} does not conform to its admitted descriptor.`);
      }
      this.mutable.set(key, value);
    }
    this.recompute(this.index.evaluationOrder);
  }

  /** SET_STATE write: type + constraint check, no coercion, then affected derived/rule recompute (§17). */
  public writeMutable(key: string, value: RuntimeValue): void {
    const descriptor = this.index.mutable.get(key) ?? invariantBroken(`SET_STATE target ${key} is not MUTABLE.`);
    if (!valueConforms(value, descriptor)) {
      runtimeFail("F03-ERR-010", `SET_STATE value violates the type / constraints of ${key}.`);
    }
    this.mutable.set(key, value);
    this.recompute(this.index.affectedByMutable.get(key) ?? []);
  }

  /** RESET_STATE: Blueprint initial values for one key or ALL_MUTABLE; capability-local state is untouched (§18). */
  public resetMutable(target: string): void {
    if (target === RESET_ALL_MUTABLE) {
      for (const key of this.index.mutable.keys()) {
        this.mutable.set(key, this.initialValue(key));
      }
      this.recompute(this.index.evaluationOrder);
      return;
    }
    if (!this.index.mutable.has(target)) {
      invariantBroken(`RESET_STATE target ${target} is not MUTABLE.`);
    }
    this.mutable.set(target, this.initialValue(target));
    this.recompute(this.index.affectedByMutable.get(target) ?? []);
  }

  public readCapability(keyId: string): CapabilitySlot | undefined {
    return this.capability.get(keyId) ?? this.committed.capability.get(keyId);
  }

  public stageCapability(keyId: string, slot: CapabilitySlot): void {
    this.capability.set(keyId, slot);
  }

  public commit(): void {
    for (const [key, value] of this.mutable) {
      this.committed.mutable.set(key, value);
    }
    for (const [key, value] of this.derived) {
      this.committed.derived.set(key, value);
    }
    for (const [id, entry] of this.rules) {
      this.committed.rules.set(id, entry);
    }
    for (const [keyId, slot] of this.capability) {
      this.committed.capability.set(keyId, slot);
    }
    this.committed.rng = this.rng.snapshot();
    this.committed.revision += 1;
  }

  private initialValue(key: string): RuntimeValue {
    const entry = this.index.blueprint.state[key];
    return entry?.mode === "MUTABLE" ? admittedRuntimeValue(entry.initial) : invariantBroken(`State ${key} is not MUTABLE.`);
  }

  /** Derived failure fails the transaction (§9); rule failure is cached and isolated (§13, §27 LEVEL 1). */
  private recompute(vertices: readonly EvaluationVertex[]): void {
    if (vertices.length === 0) {
      return;
    }
    this.guard?.("RECOMPUTE_BEFORE");
    this.recomputeVertices(vertices);
    this.guard?.("RECOMPUTE_AFTER");
  }

  private recomputeVertices(vertices: readonly EvaluationVertex[]): void {
    for (const vertex of vertices) {
      if (vertex.kind === "DERIVED") {
        this.derived.set(vertex.key, this.evaluateVertex(vertex));
        continue;
      }
      try {
        this.rules.set(vertex.id, { ok: true, value: this.evaluateVertex(vertex) });
      } catch (error: unknown) {
        if (!(error instanceof RuntimeFailure) || error.code === "F03-ERR-018") {
          throw error;
        }
        this.rules.set(vertex.id, { ok: false, failure: error });
      }
    }
  }

  private evaluateVertex(vertex: EvaluationVertex): RuntimeValue {
    const value = evaluateTyped(vertex.expr, this.env);
    if (!matchesBaseType(value, vertex.type)) {
      invariantBroken(`Admitted ${vertex.kind} expression produced a value outside its declared ${vertex.type}.`);
    }
    return value;
  }
}
