import type { LexicalScope } from "./capability-runtime.js";
import type { NodeInstanceKey } from "./node-instance-key.js";
import type { RuntimeValue } from "./runtime-value.js";

/** F03 §15 guards. */
export const MAX_QUEUED_EVENTS = 256;
export const MAX_EVENTS_PER_CYCLE = 64;
export const MAX_COMMITS_PER_CYCLE = 64;

export type EventOrigin = "USER" | "SYSTEM" | "TIMER" | "CAPABILITY";

/** F03 §14 immutable admitted event envelope. */
export interface RuntimeEventEnvelope {
  readonly event_id_local: string;
  readonly sequence: number;
  readonly source_node_id: string;
  readonly source_node_instance_key: NodeInstanceKey;
  readonly event_name: string;
  readonly payload: RuntimeValue;
  readonly lexical_scope_bindings: LexicalScope;
  readonly occurred_monotonic_ms: number;
  readonly origin: EventOrigin;
}

/** Bounded FIFO with O(1) amortized poll; nested events only ever append to the tail (§15). */
export class BoundedEventQueue {
  private items: (RuntimeEventEnvelope | undefined)[] = [];
  private head = 0;

  public get size(): number {
    return this.items.length - this.head;
  }

  public offer(event: RuntimeEventEnvelope): boolean {
    if (this.size >= MAX_QUEUED_EVENTS) {
      return false;
    }
    this.items.push(event);
    return true;
  }

  public poll(): RuntimeEventEnvelope | undefined {
    if (this.head >= this.items.length) {
      return undefined;
    }
    const event = this.items[this.head];
    this.items[this.head] = undefined;
    this.head += 1;
    if (this.head >= MAX_QUEUED_EVENTS && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return event;
  }

  public clear(): void {
    this.items = [];
    this.head = 0;
  }
}
