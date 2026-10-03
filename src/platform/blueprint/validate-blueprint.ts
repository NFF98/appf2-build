import { randomUUID } from "node:crypto";

import { VALIDATOR_REGISTRY } from "../../../generated/capabilities/validator-registry.js";
import type {
  GeneratedCapabilityValidator,
  TypeDescriptor,
  ValidatorRegistry
} from "../capabilities/schema/validator-contract.js";
import { validateActions, type TypedNode } from "./action-typing.js";
import { sealPassedResult } from "./admissible-provenance.js";
import { parseBlueprintSchema } from "./blueprint-schema.js";
import { computeCandidateDigest, parseCandidatePayload } from "./candidate-intake.js";
import { createEligibilityEvaluator, type EligibilityEvaluator } from "../capabilities/execution-eligibility.js";
import { admitNodeCapabilities, lookupCapability, typeNodeFields } from "./capability-contract.js";
import { hashCanonicalBlueprintBytes } from "./content-identity.js";
import { validateNodeGraph } from "./node-graph.js";
import { validateResources, type ResourceValidation } from "./resource-bounds.js";
import { validatePermissions } from "./security-policy.js";
import { inferExpressionTypes, validateStates, type ExpressionTypes } from "./state-rules.js";
import { inferValueSource, type TypingContext } from "./value-source-typing.js";
import {
  BLUEPRINT_SCHEMA_VERSION,
  BlueprintValidationFailure,
  fail,
  type AdmissibleBlueprint,
  type Blueprint,
  type BlueprintValidationResult,
  type ResourceUsageReport,
  type ValidationIssue
} from "./validation-types.js";

export interface BlueprintValidationContext {
  readonly registry?: ValidatorRegistry;
  /** Server-owned trusted Runtime version; defaults to the Registry snapshot runtime_version. */
  readonly runtimeVersion?: string;
  readonly traceId?: string;
  readonly validationRunId?: string;
}

const INDEX_DESCRIPTOR: TypeDescriptor = { type: "NUMBER", constraints: { min: 0 } };
const INCOMPATIBLE_CODES: ReadonlySet<string> = new Set(["F02-ERR-003", "F02-ERR-004"]);

function checkVersions(blueprint: Blueprint, registry: ValidatorRegistry): void {
  if (blueprint.schema_version !== BLUEPRINT_SCHEMA_VERSION) {
    fail("F02-ERR-003", "V03", "$.schema_version", "Blueprint schema_version is not supported.");
  }
  if (blueprint.registry_version !== registry.registry_version) {
    fail("F02-ERR-004", "V03", "$.registry_version", "Blueprint registry_version is not the supported Registry snapshot.");
  }
}

function repeatScope(
  typed: TypedNode,
  context: TypingContext
): ReadonlyMap<string, TypeDescriptor> {
  const { node } = typed.fields;
  if (node.repeat === undefined) {
    return typed.scope;
  }
  const path = `${typed.path}.repeat`;
  const items = inferValueSource(node.repeat.items, `${path}.items`, { ...context, scope: typed.scope });
  if (items.type !== "LIST") {
    return fail("F02-ERR-008", "V07", `${path}.items`, "repeat.items must be a LIST.");
  }
  if (node.repeat.max_items > items.constraints.max_length) {
    fail("F02-ERR-008", "V07", `${path}.max_items`, "repeat.max_items exceeds the LIST max_length.");
  }
  const scope = new Map(typed.scope);
  scope.set(node.repeat.item_alias, items.constraints.item);
  if (node.repeat.index_alias !== undefined) {
    scope.set(node.repeat.index_alias, INDEX_DESCRIPTOR);
  }
  return scope;
}

function typeNodes(
  graph: ReturnType<typeof validateNodeGraph>,
  capabilities: ReadonlyMap<string, GeneratedCapabilityValidator>,
  types: ExpressionTypes
): readonly TypedNode[] {
  const base: TypingContext = { errorCode: "F02-ERR-008", stage: "V07", ...types };
  const nodeIds = new Set(graph.indexById.keys());
  const childScopes = new Map<string, ReadonlyMap<string, TypeDescriptor>>();
  const repeatedSubtrees = new Set<string>();
  return graph.order.map((node) => {
    const path = `$.nodes[${graph.indexById.get(node.id) as number}]`;
    const parentId = graph.parentById.get(node.id);
    const scope = (parentId === undefined ? undefined : childScopes.get(parentId)) ?? new Map<string, TypeDescriptor>();
    const hasRepeatAncestor = parentId !== undefined && repeatedSubtrees.has(parentId);
    const capability = capabilities.get(node.id) as GeneratedCapabilityValidator;
    const fields = typeNodeFields(node, capability, path, { ...base, scope }, nodeIds);
    const typed: TypedNode = { fields, path, scope, hasRepeatAncestor };
    childScopes.set(node.id, repeatScope(typed, base));
    if (hasRepeatAncestor || node.repeat !== undefined) {
      repeatedSubtrees.add(node.id);
    }
    return typed;
  });
}

function typeResults(blueprint: Blueprint, types: ExpressionTypes): void {
  const context: TypingContext = { errorCode: "F02-ERR-008", stage: "V07", ...types };
  blueprint.result.outputs.forEach((output, index) => {
    inferValueSource(output.value, `$.result.outputs[${index}].value`, context);
  });
}

function validateSupport(blueprint: Blueprint, registry: ValidatorRegistry, eligibility: EligibilityEvaluator): void {
  const { coverage_status: status, degradations } = blueprint.support;
  if (status === "FULLY_SUPPORTED" && degradations.length > 0) {
    fail("F02-ERR-014", "V11", "$.support.degradations", "FULLY_SUPPORTED requires no degradations.");
  }
  if (status === "PARTIALLY_SUPPORTED" && degradations.length === 0) {
    fail("F02-ERR-014", "V11", "$.support.degradations", "PARTIALLY_SUPPORTED requires degradations.");
  }
  degradations.forEach((degradation, index) => {
    const path = `$.support.degradations[${index}]`;
    if (!degradation.preserves_semantic_core) {
      fail("F02-ERR-014", "V11", `${path}.preserves_semantic_core`, "Degradation must preserve the semantic core.");
    }
    degradation.capability_refs.forEach((ref, refIndex) => {
      const refPath = `${path}.capability_refs[${refIndex}]`;
      if (lookupCapability(registry, ref) === undefined) {
        fail("F02-ERR-014", "V11", refPath, "Degradation references an unknown capability.", ref);
      }
      const failure = eligibility(ref);
      if (failure !== undefined) {
        fail("F02-ERR-014", "V11", refPath, `Degradation capability is not eligible: ${failure.reason}.`, ref);
      }
    });
  });
}

function admissible(resources: ResourceValidation, blueprint: Blueprint): AdmissibleBlueprint {
  return {
    blueprint,
    canonicalJson: resources.canonicalJson,
    byteSize: resources.canonicalBytes.byteLength,
    contentHash: hashCanonicalBlueprintBytes(resources.canonicalBytes)
  };
}

interface PipelineProgress {
  resourceUsage?: ResourceUsageReport;
}

function runPipeline(
  candidatePayloadBytes: Uint8Array,
  registry: ValidatorRegistry,
  runtimeVersion: string,
  progress: PipelineProgress
): AdmissibleBlueprint {
  const root = parseCandidatePayload(candidatePayloadBytes);
  const blueprint = parseBlueprintSchema(root);
  checkVersions(blueprint, registry);
  const eligibility = createEligibilityEvaluator({
    registry,
    blueprintSchemaVersion: blueprint.schema_version,
    runtimeVersion
  });
  const capabilities = admitNodeCapabilities(blueprint, registry, eligibility);
  const stateAnalysis = validateStates(blueprint);
  const graph = validateNodeGraph(blueprint, capabilities);
  const types = inferExpressionTypes(blueprint, stateAnalysis);
  const typedNodes = typeNodes(graph, capabilities, types);
  typeResults(blueprint, types);
  validateActions(blueprint, typedNodes, types);
  const resources = validateResources({ root, blueprint, mutable: stateAnalysis.mutable, graph, capabilities });
  progress.resourceUsage = resources.usage;
  validatePermissions(blueprint, registry, capabilities);
  validateSupport(blueprint, registry, eligibility);
  return admissible(resources, blueprint);
}

export function validateBlueprintCandidate(
  candidatePayloadBytes: Uint8Array,
  context: BlueprintValidationContext = {}
): BlueprintValidationResult {
  const registry = context.registry ?? VALIDATOR_REGISTRY;
  const progress: PipelineProgress = {};
  const reportBase = {
    validation_run_id: context.validationRunId ?? randomUUID(),
    candidate_digest: computeCandidateDigest(candidatePayloadBytes),
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    registry_version: registry.registry_version,
    registry_digest: registry.registry_digest,
    trace_id: context.traceId ?? randomUUID()
  };
  try {
    const result = runPipeline(candidatePayloadBytes, registry, context.runtimeVersion ?? registry.runtime_version, progress);
    return sealPassedResult({
      report: {
        ...reportBase,
        status: "PASSED",
        content_hash: result.contentHash,
        issues: [],
        resource_usage: progress.resourceUsage as ResourceUsageReport
      },
      admissible: result
    });
  } catch (error: unknown) {
    if (!(error instanceof BlueprintValidationFailure)) {
      throw error;
    }
    const issue: ValidationIssue = error.issue;
    const status = INCOMPATIBLE_CODES.has(issue.error_code) ? "INCOMPATIBLE" : "REJECTED";
    const usage = progress.resourceUsage === undefined ? {} : { resource_usage: progress.resourceUsage };
    return { report: { ...reportBase, status, issues: [issue], ...usage } };
  }
}
