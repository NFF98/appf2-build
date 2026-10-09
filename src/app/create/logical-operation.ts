/**
 * Shared API §7 rule 13 / F00 §28: one Idempotency-Key per logical operation. A network retry or an identical
 * resubmission keeps the key until the operation settles; a materially different payload is a new operation.
 */
export class LogicalOperationKeys {
  private current: { readonly fingerprint: string; readonly key: string } | null = null;

  public constructor(private readonly newKey: () => string) {}

  public keyFor(fingerprint: string): string {
    if (this.current?.fingerprint !== fingerprint) this.current = { fingerprint, key: this.newKey() };
    return this.current.key;
  }

  /** The logical operation reached a final outcome (success or terminal failure); the next one gets a new key. */
  public settle(): void {
    this.current = null;
  }
}
