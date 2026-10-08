import { nodeInstanceKeyId, type NodeInstanceKey } from "./node-instance-key.js";
import { IntegrityFailure } from "./runtime-integrity.js";

/** One materialization of a NodeInstanceKey. A removed incarnation is never revived; re-adding gets a new generation. */
export interface CloneIncarnation {
  readonly key: NodeInstanceKey;
  readonly keyId: string;
  readonly generation: number;
}

export type TeardownStep = "REVOKE_HOST_RESOURCES" | "DISPOSE_HANDLER";

/** Side effects owned by the Runtime Instance; the registry only decides order and proves the outcome. */
export interface CloneLifecycleHost<T extends { readonly key: NodeInstanceKey }> {
  /** Cancels queued events / pending callbacks owned by these incarnations before their state is released. */
  cancelPending(removed: ReadonlySet<string>): void;
  /** Cancels timers / subscriptions owned by the incarnation. */
  revokeHostResources(incarnation: CloneIncarnation): void;
  disposeHandler(incarnation: CloneIncarnation): void;
  /** Deletes the capability-local state slot and the node-local error slot. */
  releaseLocalState(incarnation: CloneIncarnation): void;
  /** Proof query after teardown: any surviving host resource or local slot means teardown cannot be proven. */
  retainsResources(incarnation: CloneIncarnation): boolean;
  /** Teardown step failed but the incarnation is already provably inert; recorded as a node-local error. */
  teardownStepFailed(incarnation: CloneIncarnation, step: TeardownStep, error: unknown): void;
  initialize(incarnation: CloneIncarnation, instance: T): void;
}

export interface ReconcileOutcome {
  readonly removed: readonly CloneIncarnation[];
  readonly added: readonly CloneIncarnation[];
}

/**
 * F03 §5.1 Dynamic Repeat Lifecycle. Retained clones keep their incarnation untouched; removed clones are invalidated
 * first, then added clones initialize as fresh incarnations.
 */
export class CloneLifecycleRegistry {
  private readonly current = new Map<string, CloneIncarnation>();
  private readonly lastGeneration = new Map<string, number>();

  public incarnation(keyId: string): CloneIncarnation | undefined {
    return this.current.get(keyId);
  }

  public isCurrent(keyId: string, generation: number): boolean {
    return this.current.get(keyId)?.generation === generation;
  }

  public incarnations(): readonly CloneIncarnation[] {
    return [...this.current.values()];
  }

  public reconcile<T extends { readonly key: NodeInstanceKey }>(next: readonly T[], host: CloneLifecycleHost<T>): ReconcileOutcome {
    const nextById = new Map(next.map((instance) => [nodeInstanceKeyId(instance.key), instance] as const));
    const removed = [...this.current.values()].filter((incarnation) => !nextById.has(incarnation.keyId));
    this.teardown(removed, host);
    const added: CloneIncarnation[] = [];
    for (const [keyId, instance] of nextById) {
      if (this.current.has(keyId)) {
        continue;
      }
      const incarnation: CloneIncarnation = Object.freeze({ key: instance.key, keyId, generation: (this.lastGeneration.get(keyId) ?? 0) + 1 });
      this.lastGeneration.set(keyId, incarnation.generation);
      this.current.set(keyId, incarnation);
      added.push(incarnation);
      host.initialize(incarnation, instance);
    }
    return { removed, added };
  }

  /** Instance dispose: every current incarnation goes through the same fail-closed teardown. */
  public teardownAll<T extends { readonly key: NodeInstanceKey }>(host: CloneLifecycleHost<T>): readonly CloneIncarnation[] {
    const all = [...this.current.values()];
    this.teardown(all, host);
    return all;
  }

  private teardown<T extends { readonly key: NodeInstanceKey }>(removed: readonly CloneIncarnation[], host: CloneLifecycleHost<T>): void {
    if (removed.length === 0) {
      return;
    }
    for (const incarnation of removed) {
      this.current.delete(incarnation.keyId);
    }
    host.cancelPending(new Set(removed.map((incarnation) => incarnation.keyId)));
    for (const incarnation of removed) {
      teardownStep(incarnation, host, "REVOKE_HOST_RESOURCES", () => host.revokeHostResources(incarnation));
      teardownStep(incarnation, host, "DISPOSE_HANDLER", () => host.disposeHandler(incarnation));
      host.releaseLocalState(incarnation);
      if (this.isCurrent(incarnation.keyId, incarnation.generation) || host.retainsResources(incarnation)) {
        throw new IntegrityFailure("ASSURANCE_DEGRADED", `Teardown of clone ${incarnation.keyId} cannot be proven.`);
      }
    }
  }
}

/** Rule 10: a failed step is tolerated only because the incarnation is already non-current and therefore inert. */
function teardownStep<T extends { readonly key: NodeInstanceKey }>(
  incarnation: CloneIncarnation,
  host: CloneLifecycleHost<T>,
  step: TeardownStep,
  run: () => void
): void {
  try {
    run();
  } catch (error: unknown) {
    host.teardownStepFailed(incarnation, step, error);
  }
}
