import type { RuntimeAppHandle, RuntimeAppHost } from "../../platform/runtime/runtime-operation.js";
import type { AppDeliveryClient, DeliveryFailure } from "./app-delivery.js";

export type LaunchFailure = DeliveryFailure | "RUNTIME_REJECTED";

/** F00-AC-007 VALIDATED → secure delivery → F03 hydrate → APP surface; each state names its exact Blueprint. */
export type LaunchState =
  | { readonly kind: "IDLE" }
  | { readonly kind: "DELIVERING"; readonly contentHash: string }
  | { readonly kind: "HYDRATING"; readonly contentHash: string }
  | { readonly kind: "READY"; readonly contentHash: string; readonly app: RuntimeAppHandle }
  | { readonly kind: "FAILED"; readonly contentHash: string; readonly failure: LaunchFailure };

export interface AppLauncherDependencies {
  readonly delivery: AppDeliveryClient;
  /** The page's F03 browser host; null when it is missing, which fails every launch closed. */
  readonly host: RuntimeAppHost | null;
}

const RETRYABLE: ReadonlySet<LaunchFailure> = new Set<LaunchFailure>(["TEMPORARILY_UNAVAILABLE", "NETWORK"]);

export function isRetryableLaunchFailure(failure: LaunchFailure): boolean {
  return RETRYABLE.has(failure);
}

const IDLE: LaunchState = Object.freeze({ kind: "IDLE" });

/**
 * One launch per validated content hash. A newer launch supersedes an older one (its late App is released on
 * arrival), so a stale Blueprint can never become the visible App.
 */
export class AppLauncher {
  private state: LaunchState = IDLE;
  private attempt = 0;
  private target: { readonly intentId: string; readonly contentHash: string } | null = null;
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly dependencies: AppLauncherDependencies) {}

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public readonly getSnapshot = (): LaunchState => this.state;

  /** Idempotent for the hash already launching or launched; a different hash starts a fresh launch. */
  public launch(intentId: string, contentHash: string): void {
    if (this.target?.contentHash === contentHash && this.target.intentId === intentId && this.state.kind !== "IDLE") return;
    this.target = { intentId, contentHash };
    void this.run();
  }

  public retry(): void {
    if (this.state.kind === "FAILED" && isRetryableLaunchFailure(this.state.failure)) void this.run();
  }

  /** Leaves the launched App (e.g. explicit Home); its App is released and no late result can revive it. */
  public reset(): void {
    this.attempt += 1;
    this.releaseCurrent();
    this.target = null;
    this.set(IDLE);
  }

  private async run(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    const attempt = ++this.attempt;
    this.releaseCurrent();
    this.set({ kind: "DELIVERING", contentHash: target.contentHash });
    const delivered = await this.dependencies.delivery.deliver(target.intentId, target.contentHash);
    if (attempt !== this.attempt) return;
    if (!delivered.ok) return this.set({ kind: "FAILED", contentHash: target.contentHash, failure: delivered.failure });
    const { host } = this.dependencies;
    if (host === null) return this.set({ kind: "FAILED", contentHash: target.contentHash, failure: "RUNTIME_REJECTED" });
    this.set({ kind: "HYDRATING", contentHash: target.contentHash });
    const launched = await host.launch(delivered.admitted);
    if (attempt !== this.attempt) {
      if (launched.ok) launched.app.release();
      return;
    }
    if (!launched.ok) return this.set({ kind: "FAILED", contentHash: target.contentHash, failure: "RUNTIME_REJECTED" });
    this.set({ kind: "READY", contentHash: target.contentHash, app: launched.app });
  }

  private releaseCurrent(): void {
    if (this.state.kind === "READY") this.state.app.release();
  }

  private set(next: LaunchState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }
}
