import type { CapabilityRef } from "../blueprint/validation-types.js";
import { parentInstanceKey, resolveProps, type ConcreteNodeInstance } from "./capability-runtime.js";
import type { ExecutionIndex } from "./execution-index.js";
import type { EvaluationEnv } from "./expression-vm.js";
import { nodeInstanceKeyId, type NodeInstanceKey } from "./node-instance-key.js";
import { invariantBroken, RuntimeFailure, type F03ErrorCode } from "./runtime-errors.js";
import type { RuntimeRecord } from "./runtime-value.js";

export type IsolationCause = "INITIALIZE" | "RENDER";

/** Node-local error slot (F03-RQ-009). Its subtree renders a fallback; the rest of the App keeps last-known-good state. */
export interface NodeIsolationRecord {
  readonly node_instance_key: NodeInstanceKey;
  readonly node_id: string;
  readonly capability_id: string;
  readonly error_code: F03ErrorCode;
  readonly message: string;
  readonly cause: IsolationCause;
  readonly lifecycle_generation: number;
}

export interface NodeRenderInput<T> {
  readonly node_instance_key: NodeInstanceKey;
  readonly node_id: string;
  readonly capability: CapabilityRef;
  readonly props: RuntimeRecord;
  readonly lifecycle_generation: number;
  readonly children: readonly T[];
}

/** Host renderer (F00 / UI adapter). It only presents; it never writes Runtime state. */
export interface RuntimeNodeRenderer<T> {
  render(input: NodeRenderInput<T>): T;
  fallback(isolation: NodeIsolationRecord): T;
}

export interface RenderPassHost {
  readonly index: ExecutionIndex;
  readonly env: EvaluationEnv;
  readonly instances: readonly ConcreteNodeInstance[];
  isolation(keyId: string): NodeIsolationRecord | undefined;
  generation(keyId: string): number;
  isolate(instance: ConcreteNodeInstance, failure: RuntimeFailure): NodeIsolationRecord;
}

function asRenderFailure(error: unknown): RuntimeFailure {
  if (error instanceof RuntimeFailure) {
    if (error.code === "F03-ERR-018") {
      throw error;
    }
    return error;
  }
  return new RuntimeFailure("F03-ERR-013", "Node renderer threw.");
}

/**
 * One render pass over committed state. Recursion depth is bounded by the admitted V09 uiChildDepth (12). A failing
 * node is isolated into its error slot and replaced by its fallback; siblings and ancestors still render.
 */
export function renderNodeTree<T>(host: RenderPassHost, renderer: RuntimeNodeRenderer<T>): T | undefined {
  const [root, ...rest] = host.instances;
  if (root === undefined) {
    return undefined;
  }
  const children = new Map<string, ConcreteNodeInstance[]>();
  for (const instance of rest) {
    const parent = parentInstanceKey(host.index, instance.key) ?? invariantBroken(`Node ${instance.key.node_id} has no parent instance.`);
    const parentId = nodeInstanceKeyId(parent);
    const siblings = children.get(parentId) ?? [];
    siblings.push(instance);
    children.set(parentId, siblings);
  }
  const visit = (instance: ConcreteNodeInstance): T => {
    const keyId = nodeInstanceKeyId(instance.key);
    const isolated = host.isolation(keyId);
    if (isolated !== undefined) {
      return renderer.fallback(isolated);
    }
    try {
      const execution = host.index.nodeById.get(instance.key.node_id) ?? invariantBroken(`Node ${instance.key.node_id} is not indexed.`);
      const props = resolveProps(execution, host.env, instance.scope);
      const rendered = (children.get(keyId) ?? []).map(visit);
      return renderer.render({
        node_instance_key: instance.key,
        node_id: execution.node.id,
        capability: execution.node.capability,
        props,
        lifecycle_generation: host.generation(keyId),
        children: rendered
      });
    } catch (error: unknown) {
      return renderer.fallback(host.isolate(instance, asRenderFailure(error)));
    }
  };
  return visit(root);
}
