import { validateActionArray, validateRuleArray } from "./action-schema.js";
import type { BlueprintModel, SchemaOutcome, ValueLocation } from "./blueprint-model.js";
import {
  NODE_ID_PATTERN,
  expectArray,
  expectObject,
  expectString,
  matches,
  rejectUnknownKeys,
  schemaIssue,
  unicodeLength
} from "./json-shape.js";
import type { JsonObject, JsonValue } from "./strict-json.js";
import { validateNodeArray } from "./node-schema.js";
import { validateStateMap } from "./state-schema.js";
import { IssueCollector } from "./validation-types.js";
import { validateValueSource } from "./value-source.js";

const TOP_LEVEL_KEYS = new Set([
  "schema_version",
  "registry_version",
  "kind",
  "meta",
  "support",
  "state",
  "rules",
  "actions",
  "nodes",
  "root_node_id",
  "result"
]);
const META_KEYS = new Set(["title", "description"]);
const SUPPORT_KEYS = new Set(["coverage_status", "degradations"]);
const DEGRADATION_KEYS = new Set([
  "requirement_id",
  "description",
  "capability_refs",
  "preserves_semantic_core"
]);
const RESULT_KEYS = new Set(["outputs"]);
const OUTPUT_KEYS = new Set(["id", "label", "value", "sensitivity"]);
const COVERAGE = new Set(["FULLY_SUPPORTED", "PARTIALLY_SUPPORTED"]);
const SENSITIVITY = new Set(["NORMAL", "SENSITIVE", "DO_NOT_PERSIST"]);
const OUTPUT_ID = /^[a-z][a-z0-9_]{0,63}$/;

export function validateBlueprintSchema(document: JsonObject): SchemaOutcome {
  const issues = new IssueCollector();
  rejectUnknownKeys(document, TOP_LEVEL_KEYS, "$", issues);
  const schemaVersion = expectString(document.schema_version, "$.schema_version", issues);
  const registryVersion = expectString(document.registry_version, "$.registry_version", issues);
  validateKind(document.kind, issues);
  validateMeta(document.meta, issues);
  validateSupport(document.support, issues);
  const states = validateStateMap(document.state, issues);
  const rules = validateRuleArray(document.rules, issues);
  const actions = validateActionArray(document.actions, issues);
  const nodes = validateNodeArray(document.nodes, issues);
  const rootNodeId = readRoot(document.root_node_id, issues);
  const resultValues = validateResult(document.result, issues);
  if (
    issues.failed
    || states === null
    || rules === null
    || actions === null
    || nodes === null
    || rootNodeId === null
    || schemaVersion === null
    || registryVersion === null
    || resultValues === null
  ) {
    return {
      issues: issues.list,
      model: null,
      schemaVersion,
      registryVersion
    };
  }
  const model: BlueprintModel = {
    document,
    schemaVersion,
    registryVersion,
    states,
    rules,
    actions,
    nodes,
    rootNodeId,
    resultValues,
    eventBindingCount: countEvents(nodes),
    timerCount: countTimers(nodes)
  };
  return { issues: issues.list, model, schemaVersion, registryVersion };
}

function validateKind(value: JsonValue | undefined, issues: IssueCollector): void {
  if (value !== "APP") {
    schemaIssue(issues, "$.kind", "schema_invalid");
  }
}

function validateMeta(value: JsonValue | undefined, issues: IssueCollector): void {
  const meta = expectObject(value, "$.meta", issues);
  if (meta === null) {
    return;
  }
  rejectUnknownKeys(meta, META_KEYS, "$.meta", issues);
  const title = expectString(meta.title, "$.meta.title", issues);
  if (title === null || unicodeLength(title) < 1 || unicodeLength(title) > 120) {
    schemaIssue(issues, "$.meta.title", "schema_invalid");
  }
  if (meta.description !== undefined) {
    const description = expectString(meta.description, "$.meta.description", issues);
    if (description === null || unicodeLength(description) > 500) {
      schemaIssue(issues, "$.meta.description", "schema_invalid");
    }
  }
}

function validateSupport(value: JsonValue | undefined, issues: IssueCollector): void {
  const support = expectObject(value, "$.support", issues);
  if (support === null) {
    return;
  }
  rejectUnknownKeys(support, SUPPORT_KEYS, "$.support", issues);
  if (typeof support.coverage_status !== "string" || !COVERAGE.has(support.coverage_status)) {
    schemaIssue(issues, "$.support.coverage_status", "schema_invalid");
  }
  const degradations = expectArray(support.degradations, "$.support.degradations", issues);
  if (degradations === null) {
    return;
  }
  degradations.forEach((entry, index) => {
    validateDegradation(entry, `$.support.degradations[${index}]`, issues);
  });
}

function validateDegradation(value: JsonValue, path: string, issues: IssueCollector): void {
  const object = expectObject(value, path, issues);
  if (object === null) {
    return;
  }
  rejectUnknownKeys(object, DEGRADATION_KEYS, path, issues);
  const requirementId = expectString(object.requirement_id, `${path}.requirement_id`, issues);
  const description = expectString(object.description, `${path}.description`, issues);
  if (requirementId === null || requirementId.length === 0 || description === null) {
    schemaIssue(issues, path, "schema_invalid");
  }
  if (typeof object.preserves_semantic_core !== "boolean") {
    schemaIssue(issues, `${path}.preserves_semantic_core`, "schema_invalid");
  }
  const refs = expectArray(object.capability_refs, `${path}.capability_refs`, issues);
  if (refs === null) {
    return;
  }
  for (let index = 0; index < refs.length; index += 1) {
    const ref = refs[index];
    if (typeof ref !== "string" || ref.length === 0) {
      schemaIssue(issues, `${path}.capability_refs[${index}]`, "schema_invalid");
    }
  }
}

function readRoot(value: JsonValue | undefined, issues: IssueCollector): string | null {
  const root = expectString(value, "$.root_node_id", issues);
  if (root === null) {
    return null;
  }
  if (!matches(root, NODE_ID_PATTERN)) {
    schemaIssue(issues, "$.root_node_id", "schema_invalid");
    return null;
  }
  return root;
}

function validateResult(value: JsonValue | undefined, issues: IssueCollector): ValueLocation[] | null {
  const result = expectObject(value, "$.result", issues);
  if (result === null) {
    return null;
  }
  rejectUnknownKeys(result, RESULT_KEYS, "$.result", issues);
  const outputs = expectArray(result.outputs, "$.result.outputs", issues);
  if (outputs === null) {
    return null;
  }
  const locations: ValueLocation[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < outputs.length; index += 1) {
    const location = validateOutput(outputs[index]!, `$.result.outputs[${index}]`, seen, issues);
    if (location !== null) {
      locations.push(location);
    }
  }
  return locations;
}

function validateOutput(
  value: JsonValue,
  path: string,
  seen: Set<string>,
  issues: IssueCollector
): ValueLocation | null {
  const object = expectObject(value, path, issues);
  if (object === null) {
    return null;
  }
  rejectUnknownKeys(object, OUTPUT_KEYS, path, issues);
  const id = expectString(object.id, `${path}.id`, issues);
  const label = expectString(object.label, `${path}.label`, issues);
  if (id === null || !matches(id, OUTPUT_ID) || seen.has(id) || label === null || label.length === 0) {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  if (typeof object.sensitivity !== "string" || !SENSITIVITY.has(object.sensitivity)) {
    schemaIssue(issues, `${path}.sensitivity`, "schema_invalid");
    return null;
  }
  const valuePath = `${path}.value`;
  if (!validateValueSource(object.value ?? null, valuePath, issues)) {
    return null;
  }
  seen.add(id);
  return {
    path: valuePath,
    value: object.value!,
    family: "RESULT",
    scope: "GENERAL",
    owner: null,
    repeatAliases: null
  };
}

function countEvents(nodes: BlueprintModel["nodes"]): number {
  let count = 0;
  for (const node of nodes.values()) {
    count += node.events.size;
  }
  return count;
}

function countTimers(nodes: BlueprintModel["nodes"]): number {
  let count = 0;
  for (const node of nodes.values()) {
    if (node.capabilityId === "logic.timer") {
      count += 1;
    }
  }
  return count;
}
