import type { PolicyVisibleItem } from "./intent-contract.js";

/**
 * Same-Envelope dependency graph over policy-visible items. KnownInput IDs are leaf nodes:
 * they may be depended on but never depend on anything themselves.
 */
export class DependencyGraph {
  private readonly dependsOn = new Map<string, readonly string[]>();
  private readonly dependents = new Map<string, string[]>();
  private readonly unresolved = new Set<string>();

  constructor(items: readonly PolicyVisibleItem[]) {
    for (const item of items) {
      const upstream = [...new Set(item.depends_on_ids)];
      this.dependsOn.set(item.id, upstream);
      if (item.resolution_state === "UNRESOLVED") this.unresolved.add(item.id);
      for (const dependency of upstream) {
        const list = this.dependents.get(dependency) ?? [];
        list.push(item.id);
        this.dependents.set(dependency, list);
      }
    }
  }

  /** Item IDs that participate in at least one cycle (Kahn's algorithm leftovers). */
  cyclicItemIds(): string[] {
    const remaining = new Map<string, number>();
    for (const [id, upstream] of this.dependsOn) {
      remaining.set(id, upstream.filter((dependency) => this.dependsOn.has(dependency)).length);
    }
    const ready = [...remaining].filter(([, count]) => count === 0).map(([id]) => id);
    while (ready.length > 0) {
      const id = ready.pop()!;
      remaining.delete(id);
      for (const dependent of this.dependents.get(id) ?? []) {
        const count = remaining.get(dependent);
        if (count === undefined) continue;
        remaining.set(dependent, count - 1);
        if (count - 1 === 0) ready.push(dependent);
      }
    }
    return [...remaining.keys()].sort();
  }

  /** F01-DATA-003A re-ask basis: targets plus their recursive depends_on_ids closure. */
  reaskBasis(targetIds: readonly string[]): Set<string> {
    const basis = new Set<string>();
    const pending = [...targetIds];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (basis.has(id)) continue;
      basis.add(id);
      pending.push(...(this.dependsOn.get(id) ?? []));
    }
    return basis;
  }

  /** F01-RQ-002 downstream_unknowns_resolved: distinct UNRESOLVED descendants of the target. */
  unresolvedDescendantCount(targetId: string): number {
    const visited = new Set<string>([targetId]);
    const pending = [...(this.dependents.get(targetId) ?? [])];
    let count = 0;
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      if (this.unresolved.has(id)) count += 1;
      pending.push(...(this.dependents.get(id) ?? []));
    }
    return count;
  }
}
