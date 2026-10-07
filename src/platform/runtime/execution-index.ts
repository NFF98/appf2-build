import type { DescriptorType, TypeDescriptor, ValidatorContract } from "../capabilities/schema/validator-contract.js";
import { validateStates } from "../blueprint/state-rules.js";
import { collectReferences } from "../blueprint/value-source-typing.js";
import type { Blueprint, BlueprintAction, BlueprintNode, ValueSource } from "../blueprint/validation-types.js";
import type { TrustedCapabilityHandler } from "./capability-protocol.js";
import { invariantBroken } from "./runtime-errors.js";

export type EvaluationVertex =
  | { readonly kind: "DERIVED"; readonly key: string; readonly type: DescriptorType; readonly expr: ValueSource }
  | { readonly kind: "RULE"; readonly id: string; readonly type: DescriptorType; readonly expr: ValueSource };

export interface NodeBinding {
  readonly validator: ValidatorContract;
  readonly handler: TrustedCapabilityHandler;
}

export interface NodeExecution extends NodeBinding {
  readonly node: BlueprintNode;
  /** Strict structural ancestors carrying `repeat`, outermost → innermost (F03 §5.1 rule 1). */
  readonly repeatAncestors: readonly string[];
}

/** F03 §8: Browser-memory-only, rebuildable indexes; never written back and never a second semantic truth. */
export interface ExecutionIndex {
  readonly blueprint: Blueprint;
  readonly mutable: ReadonlyMap<string, TypeDescriptor>;
  readonly evaluationOrder: readonly EvaluationVertex[];
  readonly affectedByMutable: ReadonlyMap<string, readonly EvaluationVertex[]>;
  readonly actionById: ReadonlyMap<string, BlueprintAction>;
  readonly nodeById: ReadonlyMap<string, NodeExecution>;
  /** Structural pre-order from `root_node_id`. */
  readonly nodeOrder: readonly string[];
}

const STATE_VERTEX = "state:";
const RULE_VERTEX = "rule:";

function vertexOf(blueprint: Blueprint, id: string, ruleById: ReadonlyMap<string, Blueprint["rules"][number]>): EvaluationVertex {
  if (id.startsWith(STATE_VERTEX)) {
    const key = id.slice(STATE_VERTEX.length);
    const entry = blueprint.state[key];
    return entry?.mode === "DERIVED"
      ? { kind: "DERIVED", key, type: entry.type, expr: entry.expr }
      : invariantBroken(`Derived vertex ${key} is not a DERIVED state.`);
  }
  const rule = ruleById.get(id.slice(RULE_VERTEX.length));
  return rule === undefined
    ? invariantBroken(`Rule vertex ${id} does not exist.`)
    : { kind: "RULE", id: rule.id, type: rule.result_type, expr: rule.expr };
}

function vertexId(vertex: EvaluationVertex): string {
  return vertex.kind === "DERIVED" ? STATE_VERTEX + vertex.key : RULE_VERTEX + vertex.id;
}

/** Tarjan components from F02 are emitted dependencies-first; admitted graphs are acyclic singletons. */
function evaluationOrder(blueprint: Blueprint, components: readonly (readonly string[])[]): EvaluationVertex[] {
  const ruleById = new Map(blueprint.rules.map((rule) => [rule.id, rule] as const));
  return components.map((component) => {
    if (component.length !== 1) {
      return invariantBroken("Admitted derived/rule dependency graph contains a cycle.");
    }
    return vertexOf(blueprint, component[0] as string, ruleById);
  });
}

function affectedIndex(
  mutableKeys: Iterable<string>,
  order: readonly EvaluationVertex[]
): ReadonlyMap<string, readonly EvaluationVertex[]> {
  const rank = new Map(order.map((vertex, index) => [vertexId(vertex), index] as const));
  const dependents = new Map<string, EvaluationVertex[]>();
  for (const vertex of order) {
    const references = collectReferences(vertex.expr);
    const sources = [...references.states.map((key) => STATE_VERTEX + key), ...references.rules.map((id) => RULE_VERTEX + id)];
    for (const source of new Set(sources)) {
      const list = dependents.get(source) ?? [];
      list.push(vertex);
      dependents.set(source, list);
    }
  }
  const affected = new Map<string, readonly EvaluationVertex[]>();
  for (const key of mutableKeys) {
    const seen = new Map<string, EvaluationVertex>();
    const pending = [STATE_VERTEX + key];
    for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
      for (const dependent of dependents.get(current) ?? []) {
        const id = vertexId(dependent);
        if (!seen.has(id)) {
          seen.set(id, dependent);
          pending.push(id);
        }
      }
    }
    affected.set(key, [...seen.values()].sort((left, right) => (rank.get(vertexId(left)) ?? 0) - (rank.get(vertexId(right)) ?? 0)));
  }
  return affected;
}

function indexNodes(blueprint: Blueprint, bind: (node: BlueprintNode) => NodeBinding): { byId: Map<string, NodeExecution>; order: string[] } {
  const definitions = new Map(blueprint.nodes.map((node) => [node.id, node] as const));
  const byId = new Map<string, NodeExecution>();
  const order: string[] = [];
  const pending: { readonly id: string; readonly ancestors: readonly string[] }[] = [{ id: blueprint.root_node_id, ancestors: [] }];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const node = definitions.get(item.id);
    if (node === undefined || byId.has(item.id)) {
      return invariantBroken(`Admitted node tree is not a rooted tree at ${item.id}.`);
    }
    byId.set(node.id, { node, repeatAncestors: item.ancestors, ...bind(node) });
    order.push(node.id);
    const childAncestors = node.repeat === undefined ? item.ancestors : [...item.ancestors, node.id];
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      pending.push({ id: node.children[index] as string, ancestors: childAncestors });
    }
  }
  return { byId, order };
}

export function buildExecutionIndex(blueprint: Blueprint, bind: (node: BlueprintNode) => NodeBinding): ExecutionIndex {
  const analysis = validateStates(blueprint);
  const order = evaluationOrder(blueprint, analysis.components);
  const nodes = indexNodes(blueprint, bind);
  return {
    blueprint,
    mutable: analysis.mutable,
    evaluationOrder: order,
    affectedByMutable: affectedIndex(analysis.mutable.keys(), order),
    actionById: new Map(blueprint.actions.map((action) => [action.id, action] as const)),
    nodeById: nodes.byId,
    nodeOrder: nodes.order
  };
}
