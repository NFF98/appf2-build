import type { NodeModel, RepeatModel, ValueLocation } from "./blueprint-model.js";
import {
  ALIAS_PATTERN,
  NODE_ID_PATTERN,
  expectArray,
  expectObject,
  expectString,
  isJsonObject,
  matches,
  rejectUnknownKeys,
  schemaIssue
} from "./json-shape.js";
import type { JsonObject, JsonValue } from "./strict-json.js";
import type { IssueCollector } from "./validation-types.js";
import { isActionId, validateValueSource } from "./value-source.js";

const NODE_KEYS = new Set([
  "id",
  "capability",
  "props",
  "bindings",
  "events",
  "children",
  "repeat"
]);
const CAPABILITY_KEYS = new Set(["id", "version"]);
const REPEAT_KEYS = new Set(["items", "item_alias", "index_alias", "max_items"]);

export function validateNodeArray(
  nodes: JsonValue | undefined,
  issues: IssueCollector
): Map<string, NodeModel> | null {
  const entries = expectArray(nodes, "$.nodes", issues);
  if (entries === null) {
    return null;
  }
  const models = new Map<string, NodeModel>();
  for (let index = 0; index < entries.length; index += 1) {
    const model = validateNode(entries[index]!, `$.nodes[${index}]`, issues);
    if (model === null) {
      continue;
    }
    if (models.has(model.id)) {
      schemaIssue(issues, model.path, "duplicate_id");
      continue;
    }
    models.set(model.id, model);
  }
  return models;
}

function validateNode(
  value: JsonValue,
  path: string,
  issues: IssueCollector
): NodeModel | null {
  const object = expectObject(value, path, issues);
  if (object === null) {
    return null;
  }
  rejectUnknownKeys(object, NODE_KEYS, path, issues);
  const id = expectString(object.id, `${path}.id`, issues);
  const capability = readCapability(object.capability, `${path}.capability`, issues);
  if (id === null || !matches(id, NODE_ID_PATTERN) || capability === null) {
    if (id !== null && !matches(id, NODE_ID_PATTERN)) {
      schemaIssue(issues, `${path}.id`, "schema_invalid");
    }
    return null;
  }
  const repeat = readRepeat(object.repeat, `${path}.repeat`, id, issues);
  const aliases = repeat?.aliases ?? null;
  const scope = repeat === null ? "GENERAL" : "REPEAT";
  return {
    id,
    path,
    capabilityId: capability.id,
    capabilityVersion: capability.version,
    props: readValueMap({
      value: object.props,
      path: `${path}.props`,
      family: "PROP",
      scope,
      owner: null,
      repeatAliases: aliases,
      issues
    }),
    bindings: readValueMap({
      value: object.bindings,
      path: `${path}.bindings`,
      family: "BINDING",
      scope,
      owner: null,
      repeatAliases: aliases,
      issues
    }),
    events: readEvents(object.events, `${path}.events`, issues),
    children: readChildren(object.children, `${path}.children`, issues),
    repeat
  };
}

function readCapability(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): { id: string; version: string } | null {
  const object = expectObject(value, path, issues);
  if (object === null) {
    return null;
  }
  rejectUnknownKeys(object, CAPABILITY_KEYS, path, issues);
  const id = expectString(object.id, `${path}.id`, issues);
  const version = expectString(object.version, `${path}.version`, issues);
  if (id === null || version === null || id.length === 0 || version.length === 0) {
    return null;
  }
  return { id, version };
}

function readValueMap(input: {
  readonly value: JsonValue | undefined;
  readonly path: string;
  readonly family: ValueLocation["family"];
  readonly scope: ValueLocation["scope"];
  readonly owner: string | null;
  readonly repeatAliases: ReadonlySet<string> | null;
  readonly issues: IssueCollector;
}): ValueLocation[] {
  if (input.value === undefined) {
    return [];
  }
  const object = expectObject(input.value, input.path, input.issues);
  if (object === null) {
    return [];
  }
  const locations: ValueLocation[] = [];
  for (const key of Object.keys(object)) {
    const childPath = `${input.path}.${key}`;
    if (validateValueSource(object[key]!, childPath, input.issues)) {
      locations.push({
        path: childPath,
        value: object[key]!,
        family: input.family,
        scope: input.scope,
        owner: input.owner,
        repeatAliases: input.repeatAliases
      });
    }
  }
  return locations;
}

function readEvents(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): Map<string, string> {
  const events = new Map<string, string>();
  if (value === undefined) {
    return events;
  }
  const object = expectObject(value, path, issues);
  if (object === null) {
    return events;
  }
  for (const key of Object.keys(object)) {
    const actionId = object[key];
    if (typeof actionId !== "string" || !isActionId(actionId)) {
      schemaIssue(issues, `${path}.${key}`, "schema_invalid");
      continue;
    }
    events.set(key, actionId);
  }
  return events;
}

function readChildren(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): string[] {
  if (value === undefined) {
    return [];
  }
  const entries = expectArray(value, path, issues);
  if (entries === null) {
    return [];
  }
  const children: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const child = entries[index];
    const childPath = `${path}[${index}]`;
    if (typeof child !== "string" || !matches(child, NODE_ID_PATTERN) || seen.has(child)) {
      schemaIssue(issues, childPath, "schema_invalid");
      continue;
    }
    seen.add(child);
    children.push(child);
  }
  return children;
}

function readRepeat(
  value: JsonValue | undefined,
  path: string,
  nodeId: string,
  issues: IssueCollector
): RepeatModel | null {
  if (value === undefined) {
    return null;
  }
  const object = expectObject(value, path, issues);
  if (object === null || !repeatShape(object, path, issues)) {
    return null;
  }
  const itemAlias = object.item_alias as string;
  const indexAlias = object.index_alias as string;
  const itemsPath = `${path}.items`;
  if (!validateValueSource(object.items!, itemsPath, issues)) {
    return null;
  }
  const aliases = new Set([itemAlias, indexAlias]);
  return {
    items: {
      path: itemsPath,
      value: object.items!,
      family: "REPEAT",
      scope: "REPEAT",
      owner: `node:${nodeId}`,
      repeatAliases: aliases
    },
    aliases
  };
}

function repeatShape(object: JsonObject, path: string, issues: IssueCollector): boolean {
  const before = issues.list.length;
  rejectUnknownKeys(object, REPEAT_KEYS, path, issues);
  const itemAlias = expectString(object.item_alias, `${path}.item_alias`, issues);
  const indexAlias = expectString(object.index_alias, `${path}.index_alias`, issues);
  if (itemAlias === null || indexAlias === null || !matches(itemAlias, ALIAS_PATTERN) || !matches(indexAlias, ALIAS_PATTERN) || itemAlias === indexAlias) {
    schemaIssue(issues, path, "schema_invalid");
  }
  if (!isWholeNumber(object.max_items) || object.max_items < 1) {
    schemaIssue(issues, `${path}.max_items`, "schema_invalid");
  }
  if (!isJsonObject(object.items)) {
    schemaIssue(issues, `${path}.items`, "schema_invalid");
  }
  return issues.list.length === before;
}

function isWholeNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
