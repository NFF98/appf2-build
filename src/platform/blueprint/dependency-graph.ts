import type { BlueprintModel, ValueLocation } from "./blueprint-model.js";
import type { JsonObject, JsonValue } from "./strict-json.js";

interface WalkFrame {
  readonly value: JsonValue;
  readonly path: string;
}

function isWalkObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function walkValueSource(
  location: ValueLocation,
  visit: (value: JsonObject, path: string) => void
): void {
  const stack: WalkFrame[] = [{ value: location.value, path: location.path }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined || !isWalkObject(frame.value)) {
      continue;
    }
    visit(frame.value, frame.path);
    if (frame.value.kind !== "OP" || !Array.isArray(frame.value.args)) {
      continue;
    }
    for (let index = frame.value.args.length - 1; index >= 0; index -= 1) {
      stack.push({
        value: frame.value.args[index],
        path: `${frame.path}.args[${index}]`
      });
    }
  }
}

export function findCycle(graph: ReadonlyMap<string, readonly string[]>): readonly string[] | null {
  const color = new Map<string, number>();
  for (const node of graph.keys()) {
    if ((color.get(node) ?? 0) !== 0) {
      continue;
    }
    const cycle = explore(node, graph, color);
    if (cycle !== null) {
      return cycle;
    }
  }
  return null;
}

export function addEdge(graph: Map<string, string[]>, from: string, to: string): void {
  const edges = graph.get(from);
  if (edges === undefined) {
    graph.set(from, [to]);
  } else {
    edges.push(to);
  }
  if (!graph.has(to)) {
    graph.set(to, []);
  }
}

export function dependencyGraph(
  model: BlueprintModel,
  includeRules: boolean
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const state of model.states.values()) {
    if (state.mode === "DERIVED") {
      graph.set(`state:${state.key}`, []);
    }
  }
  if (includeRules) {
    for (const rule of model.rules.values()) {
      graph.set(`rule:${rule.id}`, []);
    }
  }
  const locations = expressionLocations(model, includeRules);
  for (const location of locations) {
    if (location.owner === null) {
      continue;
    }
    const owner = location.owner;
    walkValueSource(location, (value) => {
      recordDependency(graph, model, owner, value, includeRules);
    });
  }
  return graph;
}

function expressionLocations(
  model: BlueprintModel,
  includeRules: boolean
): ValueLocation[] {
  const locations: ValueLocation[] = [];
  for (const state of model.states.values()) {
    if (state.expr !== null) {
      locations.push(state.expr);
    }
  }
  if (includeRules) {
    for (const rule of model.rules.values()) {
      locations.push(rule.expr);
    }
  }
  return locations;
}

function recordDependency(
  graph: Map<string, string[]>,
  model: BlueprintModel,
  owner: string,
  value: JsonObject,
  includeRules: boolean
): void {
  if (value.kind === "STATE" && typeof value.key === "string") {
    const target = model.states.get(value.key);
    if (target?.mode === "DERIVED") {
      addEdge(graph, owner, `state:${value.key}`);
    }
  }
  if (
    includeRules
    && value.kind === "RULE"
    && typeof value.rule_id === "string"
    && model.rules.has(value.rule_id)
  ) {
    addEdge(graph, owner, `rule:${value.rule_id}`);
  }
}

function explore(
  start: string,
  graph: ReadonlyMap<string, readonly string[]>,
  color: Map<string, number>
): readonly string[] | null {
  const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
  const path = [start];
  color.set(start, 1);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) {
      break;
    }
    const edges = graph.get(frame.node) ?? [];
    if (frame.next >= edges.length) {
      color.set(frame.node, 2);
      stack.pop();
      path.pop();
      continue;
    }
    const next = edges[frame.next] ?? "";
    frame.next += 1;
    const tone = color.get(next) ?? 0;
    if (tone === 1) {
      const startIndex = path.indexOf(next);
      return path.slice(startIndex < 0 ? 0 : startIndex);
    }
    if (tone === 0) {
      color.set(next, 1);
      path.push(next);
      stack.push({ node: next, next: 0 });
    }
  }
  return null;
}
