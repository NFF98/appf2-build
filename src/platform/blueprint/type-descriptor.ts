import type {
  EnumMember,
  NumberDescriptor,
  RecordDescriptor,
  TargetMatcher,
  TypeDescriptor
} from "../capabilities/schema/validator-contract.js";

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const STRING_MAX_LENGTH_CEILING = 8192;
export const LIST_MAX_LENGTH_CEILING = 500;
export const ENUM_MAX_ITEMS = 500;
export const NESTING_DEPTH_GUARD = 13;

export type DescriptorErrorKind = "INVALID" | "DEPTH_GUARD";

export class TypeDescriptorError extends Error {
  public constructor(
    public readonly kind: DescriptorErrorKind,
    public readonly path: string,
    message: string
  ) {
    super(message);
    this.name = "TypeDescriptorError";
  }
}

export interface DescriptorParseOptions {
  readonly allowOptionalFields: boolean;
}

export function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function codePointLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
      }
    }
    length += 1;
  }
  return length;
}

export function compareCodePoints(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const shared = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < shared; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isEnumMember(value: unknown): value is EnumMember {
  return (
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function invalid(path: string, message: string): never {
  throw new TypeDescriptorError("INVALID", path, message);
}

function assertExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) {
      invalid(`${path}.${key}`, `Unknown TypeDescriptor key ${key}.`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      invalid(`${path}.${key}`, `Missing TypeDescriptor key ${key}.`);
    }
  }
}

function constraintsOf(raw: Readonly<Record<string, unknown>>, path: string): Readonly<Record<string, unknown>> {
  const constraints = raw.constraints;
  if (!isJsonObject(constraints)) {
    invalid(`${path}.constraints`, "TypeDescriptor constraints must be an object.");
  }
  return constraints;
}

function parseNumber(raw: Readonly<Record<string, unknown>>, path: string): TypeDescriptor {
  assertExactKeys(raw, ["type"], ["constraints"], path);
  if (!Object.hasOwn(raw, "constraints")) {
    return { type: "NUMBER" };
  }
  const constraints = constraintsOf(raw, path);
  assertExactKeys(constraints, [], ["min", "max"], `${path}.constraints`);
  const { min, max } = constraints;
  for (const [key, bound] of [["min", min], ["max", max]] as const) {
    if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) {
      invalid(`${path}.constraints.${key}`, "NUMBER bounds must be finite numbers.");
    }
  }
  const result: { min?: number; max?: number } = {};
  if (typeof min === "number") {
    result.min = min;
  }
  if (typeof max === "number") {
    result.max = max;
  }
  if (result.min !== undefined && result.max !== undefined && result.min > result.max) {
    invalid(`${path}.constraints`, "NUMBER min must not exceed max.");
  }
  return { type: "NUMBER", constraints: result };
}

function parseString(raw: Readonly<Record<string, unknown>>, path: string): TypeDescriptor {
  assertExactKeys(raw, ["type", "constraints"], [], path);
  const constraints = constraintsOf(raw, path);
  assertExactKeys(constraints, ["max_length"], [], `${path}.constraints`);
  if (!isIntegerInRange(constraints.max_length, 0, STRING_MAX_LENGTH_CEILING)) {
    invalid(`${path}.constraints.max_length`, "STRING max_length must be an integer 0..8192.");
  }
  return { type: "STRING", constraints: { max_length: constraints.max_length } };
}

function parseEnum(raw: Readonly<Record<string, unknown>>, path: string): TypeDescriptor {
  assertExactKeys(raw, ["type", "constraints"], [], path);
  const constraints = constraintsOf(raw, path);
  assertExactKeys(constraints, ["allowed"], [], `${path}.constraints`);
  const allowed = constraints.allowed;
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.length > ENUM_MAX_ITEMS) {
    invalid(`${path}.constraints.allowed`, "ENUM allowed must contain 1..500 items.");
  }
  const members: EnumMember[] = [];
  for (const member of allowed) {
    if (!isEnumMember(member) || typeof member !== typeof allowed[0]) {
      invalid(`${path}.constraints.allowed`, "ENUM members must share one finite primitive type.");
    }
    members.push(member);
  }
  if (new Set(members).size !== members.length) {
    invalid(`${path}.constraints.allowed`, "ENUM members must be unique.");
  }
  return { type: "ENUM", constraints: { allowed: members } };
}

interface PendingDescriptor {
  readonly raw: unknown;
  readonly path: string;
  readonly depth: number;
  readonly assign: (descriptor: TypeDescriptor) => void;
}

function parseOptionalFields(
  constraints: Readonly<Record<string, unknown>>,
  fieldKeys: readonly string[],
  path: string,
  options: DescriptorParseOptions
): readonly string[] | undefined {
  if (!Object.hasOwn(constraints, "optional_fields")) {
    return undefined;
  }
  const optionalPath = `${path}.constraints.optional_fields`;
  if (!options.allowOptionalFields) {
    invalid(optionalPath, "optional_fields is not allowed in this descriptor context.");
  }
  const optionalFields = constraints.optional_fields;
  if (!Array.isArray(optionalFields)) {
    invalid(optionalPath, "optional_fields must be an array.");
  }
  const result: string[] = [];
  for (const field of optionalFields) {
    if (typeof field !== "string" || !fieldKeys.includes(field)) {
      invalid(optionalPath, "optional_fields must reference declared fields.");
    }
    const previous = result.at(-1);
    if (previous !== undefined && compareCodePoints(previous, field) >= 0) {
      invalid(optionalPath, "optional_fields must be unique and lexicographically sorted.");
    }
    result.push(field);
  }
  return result;
}

function expandComposite(
  raw: Readonly<Record<string, unknown>>,
  item: PendingDescriptor,
  options: DescriptorParseOptions,
  stack: PendingDescriptor[]
): void {
  const { path, depth } = item;
  assertExactKeys(raw, ["type", "constraints"], [], path);
  const constraints = constraintsOf(raw, path);
  if (raw.type === "LIST") {
    assertExactKeys(constraints, ["item", "max_length"], [], `${path}.constraints`);
    if (!isIntegerInRange(constraints.max_length, 0, LIST_MAX_LENGTH_CEILING)) {
      invalid(`${path}.constraints.max_length`, "LIST max_length must be an integer 0..500.");
    }
    const maxLength = constraints.max_length;
    stack.push({
      raw: constraints.item,
      path: `${path}.constraints.item`,
      depth: depth + 1,
      assign: (child) => item.assign({ type: "LIST", constraints: { item: child, max_length: maxLength } })
    });
    return;
  }
  assertExactKeys(constraints, ["fields"], ["optional_fields"], `${path}.constraints`);
  const rawFields = constraints.fields;
  if (!isJsonObject(rawFields)) {
    invalid(`${path}.constraints.fields`, "RECORD fields must be an object.");
  }
  const fieldKeys = Object.keys(rawFields);
  const optionalFields = parseOptionalFields(constraints, fieldKeys, path, options);
  const fields: Record<string, TypeDescriptor> = Object.create(null) as Record<string, TypeDescriptor>;
  let remaining = fieldKeys.length;
  const complete = (): void => {
    const recordConstraints: RecordDescriptor["constraints"] =
      optionalFields === undefined ? { fields } : { fields, optional_fields: optionalFields };
    item.assign({ type: "RECORD", constraints: recordConstraints });
  };
  if (remaining === 0) {
    complete();
    return;
  }
  for (const key of fieldKeys) {
    if (!FIELD_KEY_PATTERN.test(key)) {
      invalid(`${path}.constraints.fields.${key}`, "RECORD field keys must match the field key grammar.");
    }
    stack.push({
      raw: rawFields[key],
      path: `${path}.constraints.fields.${key}`,
      depth: depth + 1,
      assign: (child) => {
        fields[key] = child;
        remaining -= 1;
        if (remaining === 0) {
          complete();
        }
      }
    });
  }
}

function parseOne(item: PendingDescriptor, options: DescriptorParseOptions, stack: PendingDescriptor[]): void {
  if (item.depth > NESTING_DEPTH_GUARD) {
    throw new TypeDescriptorError("DEPTH_GUARD", item.path, "TypeDescriptor nesting exceeds the depth guard.");
  }
  if (!isJsonObject(item.raw)) {
    invalid(item.path, "TypeDescriptor must be an object.");
  }
  const raw = item.raw;
  switch (raw.type) {
    case "NUMBER":
      item.assign(parseNumber(raw, item.path));
      return;
    case "STRING":
      item.assign(parseString(raw, item.path));
      return;
    case "BOOLEAN":
      assertExactKeys(raw, ["type"], [], item.path);
      item.assign({ type: "BOOLEAN" });
      return;
    case "ENUM":
      item.assign(parseEnum(raw, item.path));
      return;
    case "LIST":
    case "RECORD":
      expandComposite(raw, item, options, stack);
      return;
    default:
      invalid(`${item.path}.type`, "Unknown TypeDescriptor type.");
  }
}

export function parseTypeDescriptor(
  raw: unknown,
  path: string,
  options: DescriptorParseOptions,
  startDepth = 1
): TypeDescriptor {
  let result: TypeDescriptor | undefined;
  const stack: PendingDescriptor[] = [
    { raw, path, depth: startDepth, assign: (descriptor) => (result = descriptor) }
  ];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    parseOne(item, options, stack);
  }
  if (result === undefined) {
    return invalid(path, "TypeDescriptor could not be resolved.");
  }
  return result;
}

function enumPrimitive(descriptor: { readonly constraints: { readonly allowed: readonly EnumMember[] } }): string {
  return typeof descriptor.constraints.allowed[0];
}

function optionalSet(descriptor: RecordDescriptor): ReadonlySet<string> {
  return new Set(descriptor.constraints.optional_fields ?? []);
}

function sameKeys(left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>): boolean {
  const leftKeys = Object.keys(left);
  return leftKeys.length === Object.keys(right).length && leftKeys.every((key) => Object.hasOwn(right, key));
}

function numberAssignable(
  source: { readonly constraints?: { readonly min?: number; readonly max?: number } },
  target: { readonly constraints?: { readonly min?: number; readonly max?: number } }
): boolean {
  const targetMin = target.constraints?.min;
  const targetMax = target.constraints?.max;
  const sourceMin = source.constraints?.min;
  const sourceMax = source.constraints?.max;
  if (targetMin !== undefined && (sourceMin === undefined || sourceMin < targetMin)) {
    return false;
  }
  return targetMax === undefined || (sourceMax !== undefined && sourceMax <= targetMax);
}

function recordAssignable(source: RecordDescriptor, target: RecordDescriptor): boolean {
  const sourceFields = source.constraints.fields;
  const targetFields = target.constraints.fields;
  if (!sameKeys(sourceFields, targetFields)) {
    return false;
  }
  const targetOptional = optionalSet(target);
  if ((source.constraints.optional_fields ?? []).some((field) => !targetOptional.has(field))) {
    return false;
  }
  return Object.keys(sourceFields).every((key) => {
    const sourceField = sourceFields[key];
    const targetField = targetFields[key];
    return sourceField !== undefined && targetField !== undefined && isAssignable(sourceField, targetField);
  });
}

export function isAssignable(source: TypeDescriptor, target: TypeDescriptor): boolean {
  switch (source.type) {
    case "BOOLEAN":
      return target.type === "BOOLEAN";
    case "NUMBER":
      return target.type === "NUMBER" && numberAssignable(source, target);
    case "STRING":
      return target.type === "STRING" && source.constraints.max_length <= target.constraints.max_length;
    case "ENUM": {
      if (target.type !== "ENUM" || enumPrimitive(source) !== enumPrimitive(target)) {
        return false;
      }
      const allowed = new Set(target.constraints.allowed);
      return source.constraints.allowed.every((member) => allowed.has(member));
    }
    case "LIST":
      return (
        target.type === "LIST" &&
        source.constraints.max_length <= target.constraints.max_length &&
        isAssignable(source.constraints.item, target.constraints.item)
      );
    case "RECORD":
      return target.type === "RECORD" && recordAssignable(source, target);
  }
}

export class DescriptorJoinError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "DescriptorJoinError";
  }
}

function joinNumbers(descriptors: readonly TypeDescriptor[]): TypeDescriptor {
  let min: number | undefined = Number.POSITIVE_INFINITY;
  let max: number | undefined = Number.NEGATIVE_INFINITY;
  for (const descriptor of descriptors) {
    const constraints = descriptor.type === "NUMBER" ? descriptor.constraints : undefined;
    min = min === undefined || constraints?.min === undefined ? undefined : Math.min(min, constraints.min);
    max = max === undefined || constraints?.max === undefined ? undefined : Math.max(max, constraints.max);
  }
  const constraints: { min?: number; max?: number } = {};
  if (min !== undefined) {
    constraints.min = min;
  }
  if (max !== undefined) {
    constraints.max = max;
  }
  return Object.keys(constraints).length === 0 ? { type: "NUMBER" } : { type: "NUMBER", constraints };
}

function joinEnums(descriptors: readonly TypeDescriptor[]): TypeDescriptor {
  const members = new Set<EnumMember>();
  let primitive: string | undefined;
  for (const descriptor of descriptors) {
    if (descriptor.type !== "ENUM") {
      throw new DescriptorJoinError("ENUM join requires ENUM branches.");
    }
    const branchPrimitive = enumPrimitive(descriptor);
    if (primitive !== undefined && primitive !== branchPrimitive) {
      throw new DescriptorJoinError("ENUM join requires one primitive member type.");
    }
    primitive = branchPrimitive;
    for (const member of descriptor.constraints.allowed) {
      members.add(member);
    }
  }
  if (members.size > ENUM_MAX_ITEMS) {
    throw new DescriptorJoinError("ENUM join exceeds 500 members.");
  }
  return { type: "ENUM", constraints: { allowed: [...members] } };
}

function joinRecords(descriptors: readonly RecordDescriptor[]): TypeDescriptor {
  const [first] = descriptors;
  if (first === undefined) {
    throw new DescriptorJoinError("RECORD join requires branches.");
  }
  const fields: Record<string, TypeDescriptor> = Object.create(null) as Record<string, TypeDescriptor>;
  const optional = new Set<string>();
  for (const descriptor of descriptors) {
    if (!sameKeys(descriptor.constraints.fields, first.constraints.fields)) {
      throw new DescriptorJoinError("RECORD join requires exactly equal field keys.");
    }
    for (const field of descriptor.constraints.optional_fields ?? []) {
      optional.add(field);
    }
  }
  for (const key of Object.keys(first.constraints.fields)) {
    fields[key] = joinDescriptors(
      descriptors.map((descriptor) => descriptor.constraints.fields[key] as TypeDescriptor)
    );
  }
  if (optional.size === 0) {
    return { type: "RECORD", constraints: { fields } };
  }
  return {
    type: "RECORD",
    constraints: { fields, optional_fields: [...optional].sort(compareCodePoints) }
  };
}

function maxOf(descriptors: readonly TypeDescriptor[], select: (descriptor: TypeDescriptor) => number): number {
  return descriptors.reduce((largest, descriptor) => Math.max(largest, select(descriptor)), 0);
}

export function joinDescriptors(descriptors: readonly TypeDescriptor[]): TypeDescriptor {
  const [first] = descriptors;
  if (first === undefined) {
    throw new DescriptorJoinError("Join requires at least one branch.");
  }
  if (descriptors.some((descriptor) => descriptor.type !== first.type)) {
    throw new DescriptorJoinError("Join requires one base type.");
  }
  switch (first.type) {
    case "BOOLEAN":
      return first;
    case "NUMBER":
      return joinNumbers(descriptors);
    case "STRING":
      return {
        type: "STRING",
        constraints: {
          max_length: maxOf(descriptors, (descriptor) =>
            descriptor.type === "STRING" ? descriptor.constraints.max_length : 0
          )
        }
      };
    case "ENUM":
      return joinEnums(descriptors);
    case "LIST":
      return {
        type: "LIST",
        constraints: {
          item: joinDescriptors(
            descriptors.map((descriptor) => (descriptor.type === "LIST" ? descriptor.constraints.item : first))
          ),
          max_length: maxOf(descriptors, (descriptor) =>
            descriptor.type === "LIST" ? descriptor.constraints.max_length : 0
          )
        }
      };
    case "RECORD":
      return joinRecords(descriptors.filter((descriptor): descriptor is RecordDescriptor => descriptor.type === "RECORD"));
  }
}

function recordValueConforms(value: unknown, descriptor: RecordDescriptor): boolean {
  if (!isJsonObject(value)) {
    return false;
  }
  const { fields } = descriptor.constraints;
  const optional = optionalSet(descriptor);
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) {
      return false;
    }
  }
  return Object.keys(fields).every((key) => {
    if (!Object.hasOwn(value, key)) {
      return optional.has(key);
    }
    const field = fields[key];
    return field !== undefined && valueConforms(value[key], field);
  });
}

function numberConforms(value: unknown, descriptor: NumberDescriptor): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  const { min, max } = descriptor.constraints ?? {};
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

export function valueConforms(value: unknown, descriptor: TypeDescriptor): boolean {
  switch (descriptor.type) {
    case "NUMBER":
      return numberConforms(value, descriptor);
    case "STRING":
      return typeof value === "string" && codePointLength(value) <= descriptor.constraints.max_length;
    case "BOOLEAN":
      return typeof value === "boolean";
    case "ENUM":
      return isEnumMember(value) && descriptor.constraints.allowed.includes(value);
    case "LIST":
      return (
        Array.isArray(value) &&
        value.length <= descriptor.constraints.max_length &&
        value.every((item) => valueConforms(item, descriptor.constraints.item))
      );
    case "RECORD":
      return recordValueConforms(value, descriptor);
  }
}

export function scalarSingletonDescriptor(value: unknown): TypeDescriptor | undefined {
  if (typeof value === "boolean") {
    return { type: "BOOLEAN" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { type: "NUMBER", constraints: { min: value, max: value } };
  }
  if (typeof value === "string") {
    const length = codePointLength(value);
    return length <= STRING_MAX_LENGTH_CEILING ? { type: "STRING", constraints: { max_length: length } } : undefined;
  }
  return undefined;
}

export function concreteMatcherDescriptor(matcher: TargetMatcher): TypeDescriptor | undefined {
  return matcher.kind === "EXACT" ? matcher.descriptor : undefined;
}

export function matchesTarget(source: TypeDescriptor, matcher: TargetMatcher): boolean {
  switch (matcher.kind) {
    case "EXACT":
      return isAssignable(source, matcher.descriptor);
    case "ONE_OF":
      return matcher.options.some((option) => matchesTarget(source, option));
    case "ANY_ENUM":
      return source.type === "ENUM";
    case "ANY_RECORD":
      return source.type === "RECORD";
    case "LIST_OF":
      return (
        source.type === "LIST" &&
        (matcher.max_length === undefined || source.constraints.max_length <= matcher.max_length) &&
        matchesTarget(source.constraints.item, matcher.item)
      );
  }
}

export function resolveDescriptorPath(root: TypeDescriptor, path: string): TypeDescriptor | undefined {
  if (path === "") {
    return root;
  }
  let current: TypeDescriptor = root;
  for (const segment of path.split(".")) {
    if (current.type !== "RECORD" || !Object.hasOwn(current.constraints.fields, segment)) {
      return undefined;
    }
    if (optionalSet(current).has(segment)) {
      return undefined;
    }
    const next: TypeDescriptor | undefined = current.constraints.fields[segment];
    if (next === undefined) {
      return undefined;
    }
    current = next;
  }
  return current;
}
