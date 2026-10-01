import type { ActionStepModel, BlueprintModel, NodeModel, ValueLocation } from "./blueprint-model.js";
import { dependencyGraph, findCycle, walkValueSource } from "./dependency-graph.js";
import { operatorArgCountAllowed } from "./operator-arity.js";
import { capabilityKey, findCapabilityContract, VALIDATOR_REGISTRY_VERSION } from "./registry-contract.js";
import type { JsonObject } from "./strict-json.js";
import type { IssueCollector } from "./validation-types.js";

const SUPPORTED_SCHEMA_VERSION = "1.0.0";

export function validateVersions(
  model: BlueprintModel,
  issues: IssueCollector
): "INCOMPATIBLE" | null {
  if (model.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    issues.add({
      error_code: "F02-ERR-003",
      stage: "V03",
      json_path: "$.schema_version",
      capability_ref: null,
      message_key: "schema_version_unsupported"
    });
  }
  if (model.registryVersion !== VALIDATOR_REGISTRY_VERSION) {
    issues.add({
      error_code: "F02-ERR-004",
      stage: "V03",
      json_path: "$.registry_version",
      capability_ref: null,
      message_key: "registry_incompatible"
    });
  }
  return issues.failed ? "INCOMPATIBLE" : null;
}

export function validateCapabilityExistence(
  model: BlueprintModel,
  issues: IssueCollector
): void {
  for (const node of model.nodes.values()) {
    if (findCapabilityContract(node.capabilityId, node.capabilityVersion) !== undefined) {
      continue;
    }
    issues.add({
      error_code: "F02-ERR-005",
      stage: "V04",
      json_path: `${node.path}.capability`,
      capability_ref: capabilityKey(node.capabilityId, node.capabilityVersion),
      message_key: "capability_not_found"
    });
  }
}

export function validateDerivedDependencies(
  model: BlueprintModel,
  issues: IssueCollector
): void {
  for (const state of model.states.values()) {
    if (state.expr === null) {
      continue;
    }
    walkValueSource(state.expr, (value, path) => {
      reportMissingState({
        model,
        value,
        path,
        stage: "V05",
        errorCode: "F02-ERR-006",
        messageKey: "state_reference_missing",
        issues
      });
    });
  }
  if (findCycle(dependencyGraph(model, false)) !== null) {
    issues.add({
      error_code: "F02-ERR-006",
      stage: "V05",
      json_path: "$.state",
      capability_ref: null,
      message_key: "dependency_cycle"
    });
  }
}

export function validateBindingsAndRules(
  model: BlueprintModel,
  issues: IssueCollector
): void {
  for (const location of collectLocations(model)) {
    if (location.family === "ACTION") {
      walkValueSource(location, (value, path) => {
        reportOperator(value, path, issues);
      });
      continue;
    }
    walkValueSource(location, (value, path) => {
      reportOperator(value, path, issues);
      reportSourceReference(model, location, value, path, issues);
    });
    reportUndeclaredBinding(model, location, issues);
  }
  if (findCycle(dependencyGraph(model, true)) !== null) {
    issues.add({
      error_code: "F02-ERR-009",
      stage: "V07",
      json_path: "$.rules",
      capability_ref: null,
      message_key: "dependency_cycle"
    });
  }
}

export function validateActionsAndEvents(
  model: BlueprintModel,
  issues: IssueCollector
): void {
  for (const node of model.nodes.values()) {
    reportNodeEvents(model, node, issues);
  }
  for (const action of model.actions.values()) {
    for (const step of action.steps) {
      reportActionStep(model, step, issues);
    }
  }
}

function reportNodeEvents(
  model: BlueprintModel,
  node: NodeModel,
  issues: IssueCollector
): void {
  const contract = findCapabilityContract(node.capabilityId, node.capabilityVersion);
  const ref = capabilityKey(node.capabilityId, node.capabilityVersion);
  for (const [eventName, actionId] of node.events) {
    if (contract !== undefined && !contract.events.has(eventName)) {
      issues.add({
        error_code: "F02-ERR-010",
        stage: "V08",
        json_path: `${node.path}.events.${eventName}`,
        capability_ref: ref,
        message_key: "undeclared_event"
      });
    }
    if (!model.actions.has(actionId)) {
      issues.add({
        error_code: "F02-ERR-010",
        stage: "V08",
        json_path: `${node.path}.events.${eventName}`,
        capability_ref: actionId,
        message_key: "action_reference_missing"
      });
    }
  }
}

function reportActionStep(
  model: BlueprintModel,
  step: ActionStepModel,
  issues: IssueCollector
): void {
  if (step.type === "SET_STATE" || (step.type === "RESET_STATE" && step.target !== "ALL_MUTABLE")) {
    const state = step.target === null ? undefined : model.states.get(step.target);
    if (state === undefined || state.mode !== "MUTABLE") {
      issues.add({
        error_code: "F02-ERR-010",
        stage: "V08",
        json_path: `${step.path}.target`,
        capability_ref: step.target,
        message_key: "set_state_target_invalid"
      });
    }
  }
  if (step.type === "INVOKE_CAPABILITY") {
    reportInvoke(model, step, issues);
  }
  const locations = [step.value, step.when, ...step.args];
  for (const location of locations) {
    if (location === null) {
      continue;
    }
    walkValueSource(location, (value, path) => {
      reportMissingState({
        model,
        value,
        path,
        stage: "V08",
        errorCode: "F02-ERR-010",
        messageKey: "state_reference_missing",
        issues
      });
      reportMissingRule({
        model,
        value,
        path,
        stage: "V08",
        errorCode: "F02-ERR-010",
        issues
      });
      if (value.kind === "SCOPE") {
        issues.add({
          error_code: "F02-ERR-010",
          stage: "V08",
          json_path: path,
          capability_ref: null,
          message_key: "scope_source_outside_repeat"
        });
      }
    });
  }
}

function reportInvoke(
  model: BlueprintModel,
  step: { readonly path: string; readonly targetNodeId: string | null; readonly capabilityAction: string | null },
  issues: IssueCollector
): void {
  const node = step.targetNodeId === null ? undefined : model.nodes.get(step.targetNodeId);
  if (node === undefined) {
    issues.add({
      error_code: "F02-ERR-010",
      stage: "V08",
      json_path: `${step.path}.target_node_id`,
      capability_ref: step.targetNodeId,
      message_key: "action_node_reference_missing"
    });
    return;
  }
  const contract = findCapabilityContract(node.capabilityId, node.capabilityVersion);
  if (contract === undefined || step.capabilityAction === null || !contract.actions.has(step.capabilityAction)) {
    issues.add({
      error_code: "F02-ERR-010",
      stage: "V08",
      json_path: `${step.path}.capability_action`,
      capability_ref: capabilityKey(node.capabilityId, node.capabilityVersion),
      message_key: "capability_action_undeclared"
    });
  }
}

function reportSourceReference(
  model: BlueprintModel,
  location: ValueLocation,
  value: JsonObject,
  path: string,
  issues: IssueCollector
): void {
  const message = location.family === "BINDING" || location.family === "REPEAT"
    ? "binding_reference_missing"
    : "state_reference_missing";
  reportMissingState({
    model,
    value,
    path,
    stage: "V07",
    errorCode: "F02-ERR-008",
    messageKey: message,
    issues
  });
  reportMissingRule({
    model,
    value,
    path,
    stage: "V07",
    errorCode: "F02-ERR-008",
    issues
  });
  reportEventOutsideAction(value, path, issues);
  reportScope(location, value, path, issues);
  reportRepeatSource(model, location, value, path, issues);
}

function reportUndeclaredBinding(
  model: BlueprintModel,
  location: ValueLocation,
  issues: IssueCollector
): void {
  if (location.family !== "BINDING") {
    return;
  }
  const node = nodeForBinding(model, location.path);
  if (node === undefined) {
    return;
  }
  const contract = findCapabilityContract(node.capabilityId, node.capabilityVersion);
  const key = location.path.slice(location.path.lastIndexOf(".") + 1);
  if (contract !== undefined && !contract.bindings.has(key)) {
    issues.add({
      error_code: "F02-ERR-008",
      stage: "V07",
      json_path: location.path,
      capability_ref: capabilityKey(node.capabilityId, node.capabilityVersion),
      message_key: "undeclared_binding"
    });
  }
}

function nodeForBinding(model: BlueprintModel, path: string): NodeModel | undefined {
  for (const node of model.nodes.values()) {
    if (path.startsWith(`${node.path}.bindings.`)) {
      return node;
    }
  }
  return undefined;
}

function reportEventOutsideAction(value: JsonObject, path: string, issues: IssueCollector): void {
  if (value.kind !== "EVENT") {
    return;
  }
  issues.add({
    error_code: "F02-ERR-008",
    stage: "V07",
    json_path: path,
    capability_ref: null,
    message_key: "event_source_outside_action"
  });
}

function reportScope(
  location: ValueLocation,
  value: JsonObject,
  path: string,
  issues: IssueCollector
): void {
  if (value.kind !== "SCOPE") {
    return;
  }
  const name = typeof value.name === "string" ? value.name : "";
  const allowed = location.scope === "REPEAT" && location.repeatAliases?.has(name) === true;
  if (allowed) {
    return;
  }
  issues.add({
    error_code: "F02-ERR-008",
    stage: "V07",
    json_path: path,
    capability_ref: null,
    message_key: "scope_source_outside_repeat"
  });
}

function reportRepeatSource(
  model: BlueprintModel,
  location: ValueLocation,
  value: JsonObject,
  path: string,
  issues: IssueCollector
): void {
  if (location.family !== "REPEAT") {
    return;
  }
  if (path === location.path && value.kind !== "STATE") {
    issues.add({
      error_code: "F02-ERR-008",
      stage: "V07",
      json_path: path,
      capability_ref: null,
      message_key: "binding_reference_missing"
    });
  }
  if (value.kind !== "STATE" || typeof value.key !== "string") {
    return;
  }
  const state = model.states.get(value.key);
  if (state !== undefined && state.valueType !== "LIST") {
    issues.add({
      error_code: "F02-ERR-008",
      stage: "V07",
      json_path: path,
      capability_ref: value.key,
      message_key: "binding_reference_missing"
    });
  }
}

function reportMissingState(input: {
  readonly model: BlueprintModel;
  readonly value: JsonObject;
  readonly path: string;
  readonly stage: "V05" | "V07" | "V08";
  readonly errorCode: "F02-ERR-006" | "F02-ERR-008" | "F02-ERR-010";
  readonly messageKey: string;
  readonly issues: IssueCollector;
}): void {
  const key = input.value.key;
  if (input.value.kind !== "STATE" || typeof key !== "string" || input.model.states.has(key)) {
    return;
  }
  input.issues.add({
    error_code: input.errorCode,
    stage: input.stage,
    json_path: input.path,
    capability_ref: key,
    message_key: input.messageKey
  });
}

function reportMissingRule(input: {
  readonly model: BlueprintModel;
  readonly value: JsonObject;
  readonly path: string;
  readonly stage: "V07" | "V08";
  readonly errorCode: "F02-ERR-008" | "F02-ERR-010";
  readonly issues: IssueCollector;
}): void {
  const ruleId = input.value.rule_id;
  if (input.value.kind !== "RULE" || typeof ruleId !== "string" || input.model.rules.has(ruleId)) {
    return;
  }
  input.issues.add({
    error_code: input.errorCode,
    stage: input.stage,
    json_path: input.path,
    capability_ref: ruleId,
    message_key: "rule_reference_missing"
  });
}

function reportOperator(value: JsonObject, path: string, issues: IssueCollector): void {
  if (value.kind !== "OP" || typeof value.op !== "string" || !Array.isArray(value.args)) {
    return;
  }
  const allowed = operatorArgCountAllowed(value.op, value.args.length);
  if (allowed === null) {
    issues.add({
      error_code: "F02-ERR-009",
      stage: "V07",
      json_path: `${path}.op`,
      capability_ref: value.op,
      message_key: "expression_invalid"
    });
    return;
  }
  if (!allowed) {
    issues.add({
      error_code: "F02-ERR-009",
      stage: "V07",
      json_path: `${path}.args`,
      capability_ref: value.op,
      message_key: "expression_invalid"
    });
  }
}

function collectLocations(model: BlueprintModel): ValueLocation[] {
  const locations: ValueLocation[] = [...model.resultValues];
  for (const state of model.states.values()) {
    if (state.expr !== null) {
      locations.push(state.expr);
    }
  }
  for (const rule of model.rules.values()) {
    locations.push(rule.expr);
  }
  for (const node of model.nodes.values()) {
    locations.push(...node.props, ...node.bindings);
    if (node.repeat !== null) {
      locations.push(node.repeat.items);
    }
  }
  for (const action of model.actions.values()) {
    for (const step of action.steps) {
      if (step.value !== null) {
        locations.push(step.value);
      }
      if (step.when !== null) {
        locations.push(step.when);
      }
      locations.push(...step.args);
    }
  }
  return locations;
}
