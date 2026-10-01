import type { BlueprintModel } from "./blueprint-model.js";
import { findCycle } from "./dependency-graph.js";
import { capabilityKey, findCapabilityContract } from "./registry-contract.js";
import type { IssueCollector } from "./validation-types.js";

export function validateNodeGraph(model: BlueprintModel, issues: IssueCollector): void {
  if (!model.nodes.has(model.rootNodeId)) {
    issues.add({
      error_code: "F02-ERR-007",
      stage: "V06",
      json_path: "$.root_node_id",
      capability_ref: null,
      message_key: "root_missing"
    });
    return;
  }
  reportComposition(model, issues);
  reportMissingChildren(model, issues);
  if (findCycle(childGraph(model)) !== null) {
    issues.add({
      error_code: "F02-ERR-007",
      stage: "V06",
      json_path: "$.nodes",
      capability_ref: null,
      message_key: "node_cycle"
    });
  }
  for (const nodeId of unreachableNodes(model)) {
    issues.add({
      error_code: "F02-ERR-007",
      stage: "V06",
      json_path: "$.nodes",
      capability_ref: nodeId,
      message_key: "node_unreachable"
    });
  }
}

function reportComposition(model: BlueprintModel, issues: IssueCollector): void {
  for (const node of model.nodes.values()) {
    const contract = findCapabilityContract(node.capabilityId, node.capabilityVersion);
    if (contract === undefined) {
      continue;
    }
    const ref = capabilityKey(node.capabilityId, node.capabilityVersion);
    if (node.children.length > 0 && !contract.allowsChildren) {
      issues.add({
        error_code: "F02-ERR-007",
        stage: "V06",
        json_path: `${node.path}.children`,
        capability_ref: ref,
        message_key: "composition_not_allowed"
      });
    }
    if (node.repeat !== null && !contract.allowsRepeat) {
      issues.add({
        error_code: "F02-ERR-007",
        stage: "V06",
        json_path: `${node.path}.repeat`,
        capability_ref: ref,
        message_key: "repeat_not_supported"
      });
    }
  }
}

function reportMissingChildren(model: BlueprintModel, issues: IssueCollector): void {
  for (const node of model.nodes.values()) {
    for (const child of node.children) {
      if (!model.nodes.has(child)) {
        issues.add({
          error_code: "F02-ERR-007",
          stage: "V06",
          json_path: `${node.path}.children`,
          capability_ref: child,
          message_key: "child_missing"
        });
      }
    }
  }
}

function childGraph(model: BlueprintModel): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const node of model.nodes.values()) {
    graph.set(node.id, []);
  }
  for (const node of model.nodes.values()) {
    const edges = graph.get(node.id);
    if (edges === undefined) {
      continue;
    }
    for (const child of node.children) {
      if (graph.has(child)) {
        edges.push(child);
      }
    }
  }
  return graph;
}

function unreachableNodes(model: BlueprintModel): string[] {
  const seen = new Set<string>();
  const queue = [model.rootNodeId];
  let cursor = 0;
  while (cursor < queue.length) {
    const current = queue[cursor] ?? "";
    cursor += 1;
    if (seen.has(current) || !model.nodes.has(current)) {
      continue;
    }
    seen.add(current);
    const node = model.nodes.get(current);
    if (node === undefined) {
      continue;
    }
    for (const child of node.children) {
      if (!seen.has(child)) {
        queue.push(child);
      }
    }
  }
  const missing: string[] = [];
  for (const nodeId of model.nodes.keys()) {
    if (!seen.has(nodeId)) {
      missing.push(nodeId);
    }
  }
  missing.sort();
  return missing;
}
