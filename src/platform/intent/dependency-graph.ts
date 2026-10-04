import type { PolicyVisibleItem } from "./intent-contract.js";

/**
 * Same-Envelope depends_on_ids graph. KnownInput IDs are leaves: they can be depended on but never
 * depend on anything. All traversals are iterative and visit each node at most once (O(V+E)).
 */
export class DependencyGraph {
  private readonly upstreamOf = new Map<string, readonly string[]>();
  private readonly downstreamOf = new Map<string, string[]>();
  private readonly unresolvedIds = new Set<string>();

  constructor(items: readonly PolicyVisibleItem[]) {
    for (const item of items) {
      const upstream = [...new Set(item.depends_on_ids)];
      this.upstreamOf.set(item.id, upstream);
      if (item.resolution_state === "UNRESOLVED") this.unresolvedIds.add(item.id);
      for (const dependency of upstream) {
        const dependents = this.downstreamOf.get(dependency) ?? [];
        dependents.push(item.id);
        this.downstreamOf.set(dependency, dependents);
      }
    }
  }

  /** Policy item IDs that sit on at least one dependency cycle (Kahn's algorithm leftovers), sorted. */
  cyclicItemIds(): string[] {
    const pendingUpstream = new Map<string, number>();
    for (const [id, upstream] of this.upstreamOf) {
      pendingUpstream.set(id, upstream.filter((dependency) => this.upstreamOf.has(dependency)).length);
    }
    const ready = [...pendingUpstream].filter(([, count]) => count === 0).map(([id]) => id);
    while (ready.length > 0) {
      const id = ready.pop()!;
      pendingUpstream.delete(id);
      for (const dependent of this.downstreamOf.get(id) ?? []) {
        const count = pendingUpstream.get(dependent);
        if (count === undefined) continue;
        pendingUpstream.set(dependent, count - 1);
        if (count === 1) ready.push(dependent);
      }
    }
    return [...pendingUpstream.keys()].sort();
  }

  /** F01-DATA-003A re-ask basis: the targets plus their recursive depends_on_ids closure. */
  reaskBasis(targetIds: readonly string[]): Set<string> {
    return this.reach(targetIds, this.upstreamOf);
  }

  /**
   * IDs whose recursive depends_on_ids closure contains at least one of `upstreamIds`. A start ID is
   * included only when it itself depends (transitively) on another start ID.
   */
  dependentsClosure(upstreamIds: Iterable<string>): Set<string> {
    const firstHop = [...upstreamIds].flatMap((id) => this.downstreamOf.get(id) ?? []);
    return this.reach(firstHop, this.downstreamOf);
  }

  /** F01-RQ-002 downstream_unknowns_resolved: distinct UNRESOLVED (F01-DATA-004 UNKNOWN) descendants. */
  unresolvedDescendantCount(targetId: string): number {
    let count = 0;
    for (const id of this.dependentsClosure([targetId])) {
      if (this.unresolvedIds.has(id)) count += 1;
    }
    return count;
  }

  private reach(startIds: readonly string[], edges: ReadonlyMap<string, readonly string[]>): Set<string> {
    const visited = new Set<string>();
    const pending = [...startIds];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const next of edges.get(id) ?? []) {
        if (!visited.has(next)) pending.push(next);
      }
    }
    return visited;
  }
}
