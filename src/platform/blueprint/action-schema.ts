import type { ActionModel, ActionStepModel, RuleModel, ValueLocation } from "./blueprint-model.js";
import {
  ACTION_ID_PATTERN,
  NODE_ID_PATTERN,
  STATE_KEY_PATTERN,
  expectArray,
  expectObject,
  expectString,
  matches,
  rejectUnknownKeys,
  schemaIssue
} from "./json-shape.js";
import type { JsonObject, JsonValue } from "./strict-json.js";
import type { IssueCollector } from "./validation-types.js";
import { validateValueSource } from "./value-source.js";

const ACTION_KEYS = new Set(["id", "steps"]);
const SET_STATE_KEYS = new Set(["type", "target", "value", "when"]);
const RESET_STATE_KEYS = new Set(["type", "target", "when"]);
const INVOKE_KEYS = new Set(["type", "target_node_id", "capability_action", "args", "when"]);

export function validateActionArray(
  actions: JsonValue | undefined,
  issues: IssueCollector
): Map<string, ActionModel> | null {
  const entries = expectArray(actions, "$.actions", issues);
  if (entries === null) {
    return null;
  }
  const models = new Map<string, ActionModel>();
  for (let index = 0; index < entries.length; index += 1) {
    const model = validateAction(entries[index]!, `$.actions[${index}]`, issues);
    if (model === null) {
      continue;
    }
    if (models.has(model.id)) {
      schemaIssue(issues, `$.actions[${index}].id`, "duplicate_id");
      continue;
    }
    models.set(model.id, model);
  }
  return models;
}

export function validateRuleArray(
  rules: JsonValue | undefined,
  issues: IssueCollector
): Map<string, RuleModel> | null {
  const entries = expectArray(rules, "$.rules", issues);
  if (entries === null) {
    return null;
  }
  const models = new Map<string, RuleModel>();
  const allowed = new Set(["id", "result_type", "expr"]);
  const resultTypes = new Set(["BOOLEAN", "NUMBER", "STRING", "ENUM"]);
  for (let index = 0; index < entries.length; index += 1) {
    const path = `$.rules[${index}]`;
    const object = expectObject(entries[index], path, issues);
    if (object === null) {
      continue;
    }
    rejectUnknownKeys(object, allowed, path, issues);
    const id = expectString(object.id, `${path}.id`, issues);
    const resultType = expectString(object.result_type, `${path}.result_type`, issues);
    if (id === null || !matches(id, /^rule_[a-z0-9_]{1,58}$/) || resultType === null || !resultTypes.has(resultType)) {
      schemaIssue(issues, path, "schema_invalid");
      continue;
    }
    if (models.has(id)) {
      schemaIssue(issues, `${path}.id`, "duplicate_id");
      continue;
    }
    const exprPath = `${path}.expr`;
    if (!validateValueSource(object.expr ?? null, exprPath, issues)) {
      continue;
    }
    models.set(id, {
      id,
      expr: {
        path: exprPath,
        value: object.expr!,
        family: "RULE_EXPR",
        scope: "GENERAL",
        owner: `rule:${id}`,
        repeatAliases: null
      }
    });
  }
  return models;
}

function validateAction(
  value: JsonValue,
  path: string,
  issues: IssueCollector
): ActionModel | null {
  const object = expectObject(value, path, issues);
  if (object === null) {
    return null;
  }
  rejectUnknownKeys(object, ACTION_KEYS, path, issues);
  const id = expectString(object.id, `${path}.id`, issues);
  const steps = expectArray(object.steps, `${path}.steps`, issues);
  if (id === null || !matches(id, ACTION_ID_PATTERN) || steps === null) {
    if (id !== null && !matches(id, ACTION_ID_PATTERN)) {
      schemaIssue(issues, `${path}.id`, "schema_invalid");
    }
    return null;
  }
  return {
    id,
    steps: steps.flatMap((step, index) => {
      const model = validateStep(step, `${path}.steps[${index}]`, issues);
      return model === null ? [] : [model];
    })
  };
}

function validateStep(
  value: JsonValue,
  path: string,
  issues: IssueCollector
): ActionStepModel | null {
  const object = expectObject(value, path, issues);
  if (object === null || typeof object.type !== "string") {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  if (object.type === "SET_STATE") {
    return validateSetState(object, path, issues);
  }
  if (object.type === "RESET_STATE") {
    return validateResetState(object, path, issues);
  }
  if (object.type === "INVOKE_CAPABILITY") {
    return validateInvoke(object, path, issues);
  }
  schemaIssue(issues, `${path}.type`, "schema_invalid");
  return null;
}

function validateSetState(
  object: JsonObject,
  path: string,
  issues: IssueCollector
): ActionStepModel | null {
  rejectUnknownKeys(object, SET_STATE_KEYS, path, issues);
  const target = expectString(object.target, `${path}.target`, issues);
  if (target === null || !matches(target, STATE_KEY_PATTERN) || !validateValueSource(object.value ?? null, `${path}.value`, issues)) {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  return {
    type: "SET_STATE",
    path,
    target,
    value: actionValue(`${path}.value`, object.value!, null),
    when: optionalWhen(object.when, `${path}.when`, issues),
    targetNodeId: null,
    capabilityAction: null,
    args: []
  };
}

function validateResetState(
  object: JsonObject,
  path: string,
  issues: IssueCollector
): ActionStepModel | null {
  rejectUnknownKeys(object, RESET_STATE_KEYS, path, issues);
  const target = expectString(object.target, `${path}.target`, issues);
  if (target === null || (target !== "ALL_MUTABLE" && !matches(target, STATE_KEY_PATTERN))) {
    schemaIssue(issues, `${path}.target`, "schema_invalid");
    return null;
  }
  return {
    type: "RESET_STATE",
    path,
    target,
    value: null,
    when: optionalWhen(object.when, `${path}.when`, issues),
    targetNodeId: null,
    capabilityAction: null,
    args: []
  };
}

function validateInvoke(
  object: JsonObject,
  path: string,
  issues: IssueCollector
): ActionStepModel | null {
  rejectUnknownKeys(object, INVOKE_KEYS, path, issues);
  const targetNodeId = expectString(object.target_node_id, `${path}.target_node_id`, issues);
  const capabilityAction = expectString(object.capability_action, `${path}.capability_action`, issues);
  const args = expectObject(object.args, `${path}.args`, issues);
  if (targetNodeId === null || capabilityAction === null || args === null || !matches(targetNodeId, NODE_ID_PATTERN) || capabilityAction.length === 0) {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  const argLocations = readArgs(args, `${path}.args`, issues);
  if (argLocations === null) {
    return null;
  }
  return {
    type: "INVOKE_CAPABILITY",
    path,
    target: null,
    value: null,
    when: optionalWhen(object.when, `${path}.when`, issues),
    targetNodeId,
    capabilityAction,
    args: argLocations
  };
}

function readArgs(
  args: JsonObject,
  path: string,
  issues: IssueCollector
): ValueLocation[] | null {
  const locations: ValueLocation[] = [];
  for (const key of Object.keys(args)) {
    const argPath = `${path}.${key}`;
    if (!validateValueSource(args[key]!, argPath, issues)) {
      return null;
    }
    locations.push(actionValue(argPath, args[key]!, null));
  }
  return locations;
}

function optionalWhen(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): ValueLocation | null {
  if (value === undefined) {
    return null;
  }
  if (!validateValueSource(value, path, issues)) {
    return null;
  }
  return actionValue(path, value, null);
}

function actionValue(path: string, value: JsonValue, owner: string | null): ValueLocation {
  return {
    path,
    value,
    family: "ACTION",
    scope: "ACTION",
    owner,
    repeatAliases: null
  };
}
