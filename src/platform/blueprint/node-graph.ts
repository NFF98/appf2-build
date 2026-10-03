import type { GeneratedCapabilityValidator } from "../capabilities/schema/validator-contract.js";
import { fail, type Blueprint, type BlueprintNode } from "./validation-types.js";

export interface NodeGraph {
  readonly order: readonly BlueprintNode[];
  readonly indexById: ReadonlyMap<string, number>;
  readonly parentById: ReadonlyMap<string, string>;
}

function graphError(path: string, message: string): never {
  return fail("F02-ERR-007", "V06", path, message);
}

function assertComposition(node: BlueprintNode, capability: GeneratedCapabilityValidator, path: string): void {
  const { composition } = capability.validator;
  if (!composition.children && node.children.length > 0) {
    graphError(`${path}.children`, "Capability composition does not allow children.");
  }
  if (!composition.repeat && node.repeat !== undefined) {
    graphError(`${path}.repeat`, "Capability composition does not allow repeat.");
  }
  if (composition.repeat && composition.repeat_required === true && node.repeat === undefined) {
    graphError(`${path}.repeat`, "Capability composition requires repeat.");
  }
  if (node.repeat?.index_alias !== undefined && node.repeat.index_alias === node.repeat.item_alias) {
    graphError(`${path}.repeat.index_alias`, "item_alias and index_alias must differ.");
  }
}

function assignParents(blueprint: Blueprint, indexById: ReadonlyMap<string, number>): Map<string, string> {
  const parentById = new Map<string, string>();
  blueprint.nodes.forEach((node, index) => {
    node.children.forEach((childId, childIndex) => {
      const childPath = `$.nodes[${index}].children[${childIndex}]`;
      if (!indexById.has(childId)) {
        graphError(childPath, "Child node reference does not exist.");
      }
      if (childId === blueprint.root_node_id) {
        graphError(childPath, "Root node must not be a child.");
      }
      if (parentById.has(childId)) {
        graphError(childPath, "Node has more than one structural parent.");
      }
      parentById.set(childId, node.id);
    });
  });
  return parentById;
}

function aliasesOf(node: BlueprintNode): readonly string[] {
  if (node.repeat === undefined) {
    return [];
  }
  return node.repeat.index_alias === undefined
    ? [node.repeat.item_alias]
    : [node.repeat.item_alias, node.repeat.index_alias];
}

export function validateNodeGraph(
  blueprint: Blueprint,
  capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>
): NodeGraph {
  const indexById = new Map(blueprint.nodes.map((node, index) => [node.id, index] as const));
  const rootIndex = indexById.get(blueprint.root_node_id);
  if (rootIndex === undefined) {
    return graphError("$.root_node_id", "root_node_id does not reference an existing node.");
  }
  const parentById = assignParents(blueprint, indexById);
  const order: BlueprintNode[] = [];
  const pending: { readonly index: number; readonly aliases: ReadonlySet<string> }[] = [
    { index: rootIndex, aliases: new Set<string>() }
  ];
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const node = blueprint.nodes[item.index] as BlueprintNode;
    const path = `$.nodes[${item.index}]`;
    const capability = capabilities.get(node.id) as GeneratedCapabilityValidator;
    assertComposition(node, capability, path);
    const childAliases = new Set(item.aliases);
    for (const alias of aliasesOf(node)) {
      if (childAliases.has(alias)) {
        graphError(`${path}.repeat`, "Repeat alias must not shadow an ancestor alias.");
      }
      childAliases.add(alias);
    }
    order.push(node);
    for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      pending.push({ index: indexById.get(node.children[childIndex] as string) as number, aliases: childAliases });
    }
  }
  if (order.length !== blueprint.nodes.length) {
    const reached = new Set(order);
    const orphan = blueprint.nodes.findIndex((node) => !reached.has(node));
    graphError(`$.nodes[${orphan}]`, "Node is not reachable from the root as part of one rooted tree.");
  }
  return { order, indexById, parentById };
}
