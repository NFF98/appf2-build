import { createHash } from "node:crypto";

import type { BlueprintValidationContext } from "../../src/platform/blueprint/validation-types.js";
import { MemoryBlueprintAdmissionRepository } from "../../src/platform/blueprint/blueprint-repository.js";
import type { BlueprintValidationDependencies } from "../../src/platform/blueprint/validate-blueprint.js";

export const TRACE_ID = "trace-sp2-t002";
export const VALIDATION_RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
export const COMPILER_RUN_ID = "223e4567-e89b-42d3-a456-426614174111";
export const CREATED_AT = "2026-10-02T00:00:00.000Z";

export function validBlueprint(): Record<string, unknown> {
  return {
    schema_version: "1.0.0",
    registry_version: "1.0.0",
    kind: "APP",
    meta: {
      title: "Budget",
      description: "Split a bill"
    },
    support: {
      coverage_status: "FULLY_SUPPORTED",
      degradations: []
    },
    state: {
      budget: {
        mode: "MUTABLE",
        type: "NUMBER",
        initial: 10,
        constraints: { min: 0, max: 100 }
      }
    },
    rules: [],
    actions: [
      {
        id: "action_set_budget",
        steps: [
          {
            type: "SET_STATE",
            target: "budget",
            value: { kind: "EVENT", path: "value" }
          }
        ]
      }
    ],
    nodes: [
      {
        id: "node_root",
        capability: { id: "layout.container", version: "1.0.0" },
        children: ["node_budget"]
      },
      {
        id: "node_budget",
        capability: { id: "input.number", version: "1.0.0" },
        bindings: {
          bind: { kind: "STATE", key: "budget" }
        },
        events: {
          change: "action_set_budget"
        }
      }
    ],
    root_node_id: "node_root",
    result: {
      outputs: [
        {
          id: "budget_out",
          label: "Budget",
          value: { kind: "STATE", key: "budget" },
          sensitivity: "NORMAL"
        }
      ]
    }
  };
}

export function encodeBlueprint(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

export function sha256OfBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validationContext(
  overrides: Partial<BlueprintValidationContext> = {}
): BlueprintValidationContext {
  return {
    candidate_source: "IMPORT",
    trace_id: TRACE_ID,
    compiler_run_id: null,
    ...overrides
  };
}

export function validationDependencies(
  repository = new MemoryBlueprintAdmissionRepository(),
  randomUUID: () => string = () => VALIDATION_RUN_ID
): BlueprintValidationDependencies & { repository: MemoryBlueprintAdmissionRepository } {
  return {
    repository,
    now: () => CREATED_AT,
    randomUUID
  };
}

export function replaceNode(
  blueprint: Record<string, unknown>,
  nodeId: string,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const nodes = blueprint.nodes as Array<Record<string, unknown>>;
  return {
    ...blueprint,
    nodes: nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node)
  };
}
