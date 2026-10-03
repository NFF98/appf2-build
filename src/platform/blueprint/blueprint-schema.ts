import {
  CAPABILITY_ID_PATTERN,
  DESCRIPTOR_TYPES,
  SEMVER_PATTERN,
  type DescriptorType
} from "../capabilities/schema/validator-contract.js";
import { codePointLength, isJsonObject, NESTING_DEPTH_GUARD } from "./type-descriptor.js";
import {
  fail,
  type ActionStep,
  type Blueprint,
  type BlueprintAction,
  type BlueprintNode,
  type CapabilityRef,
  type Degradation,
  type JsonValue,
  type Repeat,
  type ResultOutput,
  type Rule,
  type StateEntry,
  type ValueSource
} from "./validation-types.js";

export const CANONICAL_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const RULE_ID_PATTERN = /^rule_[a-z0-9_]{1,58}$/;
export const NODE_ID_PATTERN = /^node_[a-z0-9_]{1,58}$/;
export const ACTION_ID_PATTERN = /^action_[a-z0-9_]{1,56}$/;
export const RESET_ALL_MUTABLE = "ALL_MUTABLE";
const VALUE_PATH_PATTERN = /^(?:[a-z][a-z0-9_]{0,63}(?:\.[a-z][a-z0-9_]{0,63})*)?$/;
const RESERVED_PREFIXES = ["nff_", "sys_", "__"] as const;

const TOP_LEVEL_KEYS = [
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
] as const;

const VALUE_SOURCE_KEYS: Readonly<Record<ValueSource["kind"], readonly string[]>> = {
  LITERAL: ["kind", "value"],
  STATE: ["kind", "key"],
  RULE: ["kind", "rule_id"],
  EVENT: ["kind", "path"],
  SCOPE: ["kind", "name", "path"],
  OP: ["kind", "op", "args"]
};

type JsonObject = Readonly<Record<string, JsonValue>>;

export function hasReservedPrefix(token: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => token.startsWith(prefix));
}

function schemaError(path: string, message: string): never {
  return fail("F02-ERR-002", "V02", path, message);
}

function nullPrototypeRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function exactObject(
  value: JsonValue | undefined,
  path: string,
  required: readonly string[],
  optional: readonly string[] = []
): JsonObject {
  if (!isJsonObject(value)) {
    schemaError(path, "Expected an object.");
  }
  const object = value as JsonObject;
  for (const key of Object.keys(object)) {
    if (!required.includes(key) && !optional.includes(key)) {
      schemaError(`${path}.${key}`, `Unknown executable key ${key}.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(object, key)) {
      schemaError(`${path}.${key}`, `Missing required key ${key}.`);
    }
  }
  return object;
}

function readString(value: JsonValue | undefined, path: string, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern !== undefined && !pattern.test(value))) {
    schemaError(path, "Expected a string matching the canonical grammar.");
  }
  return value;
}

function readBoundedText(value: JsonValue | undefined, path: string, min: number, max: number): string {
  const text = readString(value, path);
  const length = codePointLength(text);
  if (length < min || length > max) {
    schemaError(path, `Expected ${min}..${max} Unicode code points.`);
  }
  return text;
}

function readCanonicalIdentifier(value: JsonValue | undefined, path: string): string {
  const token = readString(value, path, CANONICAL_IDENTIFIER_PATTERN);
  if (hasReservedPrefix(token)) {
    schemaError(path, "Identifier uses a platform-reserved prefix.");
  }
  return token;
}

function readEnum<T extends string>(value: JsonValue | undefined, path: string, allowed: readonly T[]): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    schemaError(path, `Expected one of ${allowed.join(", ")}.`);
  }
  return match;
}

function readArray(value: JsonValue | undefined, path: string, min: number, max: number): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    schemaError(path, "Expected an array.");
  }
  const array = value as readonly JsonValue[];
  if (array.length < min || array.length > max) {
    schemaError(path, `Expected ${min}..${max} items.`);
  }
  return array;
}

function readMap<T>(
  value: JsonValue | undefined,
  path: string,
  readEntry: (entry: JsonValue | undefined, entryPath: string, key: string) => T
): Readonly<Record<string, T>> {
  if (!isJsonObject(value)) {
    schemaError(path, "Expected an object map.");
  }
  const result = nullPrototypeRecord<T>();
  const object = value as JsonObject;
  for (const key of Object.keys(object)) {
    result[key] = readEntry(object[key], `${path}.${key}`, key);
  }
  return result;
}

function assertUnique(values: readonly string[], path: string, label: string): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      schemaError(`${path}[${index}]`, `Duplicate ${label}.`);
    }
    seen.add(value);
  });
}

function isValueSourceKind(kind: JsonValue | undefined): kind is ValueSource["kind"] {
  return typeof kind === "string" && Object.hasOwn(VALUE_SOURCE_KEYS, kind);
}

export function parseValueSource(raw: JsonValue | undefined, path: string, depth = 1): ValueSource {
  if (depth > NESTING_DEPTH_GUARD) {
    fail("F02-ERR-011", "V09", path, "Value Source nesting exceeds the depth guard.");
  }
  const kind = isJsonObject(raw) ? (raw as JsonObject).kind : undefined;
  if (!isValueSourceKind(kind)) {
    schemaError(`${path}.kind`, "Unknown Value Source kind.");
  }
  const source = exactObject(raw, path, VALUE_SOURCE_KEYS[kind]);
  switch (kind) {
    case "LITERAL":
      if (source.value === null) {
        schemaError(`${path}.value`, "LITERAL null is forbidden.");
      }
      return { kind, value: source.value as JsonValue };
    case "STATE":
      return { kind, key: readString(source.key, `${path}.key`, CANONICAL_IDENTIFIER_PATTERN) };
    case "RULE":
      return { kind, rule_id: readString(source.rule_id, `${path}.rule_id`, RULE_ID_PATTERN) };
    case "EVENT":
      return { kind, path: readString(source.path, `${path}.path`, VALUE_PATH_PATTERN) };
    case "SCOPE":
      return {
        kind,
        name: readString(source.name, `${path}.name`, CANONICAL_IDENTIFIER_PATTERN),
        path: readString(source.path, `${path}.path`, VALUE_PATH_PATTERN)
      };
    case "OP":
      return {
        kind,
        op: readString(source.op, `${path}.op`),
        args: readArray(source.args, `${path}.args`, 0, Number.MAX_SAFE_INTEGER).map((arg, index) =>
          parseValueSource(arg, `${path}.args[${index}]`, depth + 1)
        )
      };
  }
}

function parseCapabilityRef(raw: JsonValue | undefined, path: string): CapabilityRef {
  const ref = exactObject(raw, path, ["id", "version"]);
  return {
    id: readString(ref.id, `${path}.id`, CAPABILITY_ID_PATTERN),
    version: readString(ref.version, `${path}.version`, SEMVER_PATTERN)
  };
}

function parseDegradation(raw: JsonValue | undefined, path: string): Degradation {
  const degradation = exactObject(raw, path, [
    "requirement_id",
    "description",
    "capability_refs",
    "preserves_semantic_core"
  ]);
  const refs = readArray(degradation.capability_refs, `${path}.capability_refs`, 1, 20).map((ref, index) =>
    parseCapabilityRef(ref, `${path}.capability_refs[${index}]`)
  );
  assertUnique(
    refs.map((ref) => `${ref.id}@${ref.version}`),
    `${path}.capability_refs`,
    "capability ref"
  );
  if (typeof degradation.preserves_semantic_core !== "boolean") {
    schemaError(`${path}.preserves_semantic_core`, "Expected a boolean.");
  }
  return {
    requirement_id: readCanonicalIdentifier(degradation.requirement_id, `${path}.requirement_id`),
    description: readBoundedText(degradation.description, `${path}.description`, 1, 500),
    capability_refs: refs,
    preserves_semantic_core: degradation.preserves_semantic_core
  };
}

function parseSupport(raw: JsonValue | undefined, path: string): Blueprint["support"] {
  const support = exactObject(raw, path, ["coverage_status", "degradations"]);
  const degradations = readArray(support.degradations, `${path}.degradations`, 0, 50).map((entry, index) =>
    parseDegradation(entry, `${path}.degradations[${index}]`)
  );
  assertUnique(
    degradations.map((degradation) => degradation.requirement_id),
    `${path}.degradations`,
    "requirement_id"
  );
  return {
    coverage_status: readEnum(support.coverage_status, `${path}.coverage_status`, [
      "FULLY_SUPPORTED",
      "PARTIALLY_SUPPORTED"
    ] as const),
    degradations
  };
}

function parseMeta(raw: JsonValue | undefined, path: string): Blueprint["meta"] {
  const meta = exactObject(raw, path, ["title"], ["description"]);
  const title = readBoundedText(meta.title, `${path}.title`, 1, 120);
  if (!Object.hasOwn(meta, "description")) {
    return { title };
  }
  return { title, description: readBoundedText(meta.description, `${path}.description`, 0, 500) };
}

function readDescriptorType(value: JsonValue | undefined, path: string): DescriptorType {
  return readEnum(value, path, DESCRIPTOR_TYPES);
}

function parseStateEntry(raw: JsonValue | undefined, path: string): StateEntry {
  const mode = isJsonObject(raw) ? (raw as JsonObject).mode : undefined;
  if (mode === "MUTABLE") {
    const entry = exactObject(raw, path, ["mode", "type", "initial"], ["constraints"]);
    const type = readDescriptorType(entry.type, `${path}.type`);
    const initial = entry.initial as JsonValue;
    return Object.hasOwn(entry, "constraints")
      ? { mode, type, initial, constraints: entry.constraints as JsonValue }
      : { mode, type, initial };
  }
  if (mode === "DERIVED") {
    const entry = exactObject(raw, path, ["mode", "type", "expr"]);
    return {
      mode,
      type: readDescriptorType(entry.type, `${path}.type`),
      expr: parseValueSource(entry.expr, `${path}.expr`)
    };
  }
  return schemaError(`${path}.mode`, "State mode must be MUTABLE or DERIVED.");
}

function parseRule(raw: JsonValue | undefined, path: string): Rule {
  const rule = exactObject(raw, path, ["id", "result_type", "expr"]);
  return {
    id: readString(rule.id, `${path}.id`, RULE_ID_PATTERN),
    result_type: readDescriptorType(rule.result_type, `${path}.result_type`),
    expr: parseValueSource(rule.expr, `${path}.expr`)
  };
}

function withOptionalWhen<T extends object>(step: T, raw: JsonObject, path: string): T & { when?: ValueSource } {
  return Object.hasOwn(raw, "when") ? { ...step, when: parseValueSource(raw.when, `${path}.when`) } : step;
}

function parseStep(raw: JsonValue | undefined, path: string): ActionStep {
  const type = isJsonObject(raw) ? (raw as JsonObject).type : undefined;
  if (type === "SET_STATE") {
    const step = exactObject(raw, path, ["type", "target", "value"], ["when"]);
    return withOptionalWhen(
      {
        type,
        target: readString(step.target, `${path}.target`, CANONICAL_IDENTIFIER_PATTERN),
        value: parseValueSource(step.value, `${path}.value`)
      },
      step,
      path
    );
  }
  if (type === "INVOKE_CAPABILITY") {
    const step = exactObject(raw, path, ["type", "target_node_id", "capability_action", "args"], ["when"]);
    return withOptionalWhen(
      {
        type,
        target_node_id: readString(step.target_node_id, `${path}.target_node_id`, NODE_ID_PATTERN),
        capability_action: readString(step.capability_action, `${path}.capability_action`),
        args: readMap(step.args, `${path}.args`, (entry, entryPath) => parseValueSource(entry, entryPath))
      },
      step,
      path
    );
  }
  if (type === "RESET_STATE") {
    const step = exactObject(raw, path, ["type", "target"]);
    const target = step.target === RESET_ALL_MUTABLE
      ? RESET_ALL_MUTABLE
      : readString(step.target, `${path}.target`, CANONICAL_IDENTIFIER_PATTERN);
    return { type, target };
  }
  return schemaError(`${path}.type`, "Unknown action step type.");
}

function parseAction(raw: JsonValue | undefined, path: string): BlueprintAction {
  const action = exactObject(raw, path, ["id", "steps"]);
  return {
    id: readString(action.id, `${path}.id`, ACTION_ID_PATTERN),
    steps: readArray(action.steps, `${path}.steps`, 1, 16).map((step, index) =>
      parseStep(step, `${path}.steps[${index}]`)
    )
  };
}

function parseRepeat(raw: JsonValue | undefined, path: string): Repeat {
  const repeat = exactObject(raw, path, ["items", "item_alias", "max_items"], ["index_alias"]);
  const maxItems = repeat.max_items;
  if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 0 || maxItems > 500) {
    schemaError(`${path}.max_items`, "max_items must be an integer 0..500.");
  }
  const parsed: Repeat = {
    items: parseValueSource(repeat.items, `${path}.items`),
    item_alias: readCanonicalIdentifier(repeat.item_alias, `${path}.item_alias`),
    max_items: maxItems
  };
  return Object.hasOwn(repeat, "index_alias")
    ? { ...parsed, index_alias: readCanonicalIdentifier(repeat.index_alias, `${path}.index_alias`) }
    : parsed;
}

function parseNode(raw: JsonValue | undefined, path: string): BlueprintNode {
  const node = exactObject(raw, path, ["id", "capability", "props", "bindings", "events", "children"], ["repeat"]);
  const children = readArray(node.children, `${path}.children`, 0, Number.MAX_SAFE_INTEGER).map((child, index) =>
    readString(child, `${path}.children[${index}]`, NODE_ID_PATTERN)
  );
  assertUnique(children, `${path}.children`, "child node reference");
  const parsed: BlueprintNode = {
    id: readString(node.id, `${path}.id`, NODE_ID_PATTERN),
    capability: parseCapabilityRef(node.capability, `${path}.capability`),
    props: readMap(node.props, `${path}.props`, (entry, entryPath) => parseValueSource(entry, entryPath)),
    bindings: readMap(node.bindings, `${path}.bindings`, (entry, entryPath) => parseValueSource(entry, entryPath)),
    events: readMap(node.events, `${path}.events`, (entry, entryPath) => readString(entry, entryPath, ACTION_ID_PATTERN)),
    children
  };
  return Object.hasOwn(node, "repeat") ? { ...parsed, repeat: parseRepeat(node.repeat, `${path}.repeat`) } : parsed;
}

function parseResultOutput(raw: JsonValue | undefined, path: string): ResultOutput {
  const output = exactObject(raw, path, ["id", "label", "value", "sensitivity"]);
  return {
    id: readCanonicalIdentifier(output.id, `${path}.id`),
    label: readBoundedText(output.label, `${path}.label`, 1, 120),
    value: parseValueSource(output.value, `${path}.value`),
    sensitivity: readEnum(output.sensitivity, `${path}.sensitivity`, ["NORMAL", "SENSITIVE", "DO_NOT_PERSIST"] as const)
  };
}

function parseIdentifiedArray<T extends { readonly id: string }>(
  raw: JsonValue | undefined,
  path: string,
  bounds: readonly [number, number],
  parseItem: (item: JsonValue, itemPath: string) => T
): readonly T[] {
  const items = readArray(raw, path, bounds[0], bounds[1]).map((item, index) => parseItem(item, `${path}[${index}]`));
  assertUnique(
    items.map((item) => item.id),
    path,
    "id"
  );
  return items;
}

export function parseBlueprintSchema(root: JsonObject): Blueprint {
  const blueprint = exactObject(root, "$", TOP_LEVEL_KEYS);
  const result = exactObject(blueprint.result, "$.result", ["outputs"]);
  return {
    schema_version: readString(blueprint.schema_version, "$.schema_version", SEMVER_PATTERN),
    registry_version: readString(blueprint.registry_version, "$.registry_version", SEMVER_PATTERN),
    kind: readEnum(blueprint.kind, "$.kind", ["APP"] as const),
    meta: parseMeta(blueprint.meta, "$.meta"),
    support: parseSupport(blueprint.support, "$.support"),
    state: readMap(blueprint.state, "$.state", (entry, entryPath, key) => {
      readString(key, entryPath, CANONICAL_IDENTIFIER_PATTERN);
      return parseStateEntry(entry, entryPath);
    }),
    rules: parseIdentifiedArray(blueprint.rules, "$.rules", [0, Number.MAX_SAFE_INTEGER], parseRule),
    actions: parseIdentifiedArray(blueprint.actions, "$.actions", [0, Number.MAX_SAFE_INTEGER], parseAction),
    nodes: parseIdentifiedArray(blueprint.nodes, "$.nodes", [1, 100], parseNode),
    root_node_id: readString(blueprint.root_node_id, "$.root_node_id", NODE_ID_PATTERN),
    result: {
      outputs: parseIdentifiedArray(result.outputs, "$.result.outputs", [0, 50], parseResultOutput)
    }
  };
}
