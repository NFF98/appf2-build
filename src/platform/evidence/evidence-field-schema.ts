export type EvidenceFieldType = "string" | "integer" | "number" | "boolean";
export type EvidenceFieldFormat = "uuid" | "date-time";

export interface EvidenceEnvelopeRequirement {
  readonly field: string;
  readonly equals: string;
}

export interface EvidenceFieldSchema {
  readonly type: EvidenceFieldType;
  readonly enumValues?: ReadonlySet<string>;
  readonly pattern?: RegExp;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly format?: EvidenceFieldFormat;
  readonly uuidVersion?: number;
  readonly serverAdded: boolean;
  readonly crossFieldRule?: string;
  readonly requiredWhenEnvelope?: EvidenceEnvelopeRequirement;
}

export type EvidenceFieldFault = "too_long" | "invalid";

export class EvidenceRegistryDefinitionError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EvidenceRegistryDefinitionError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const SUPPORTED_CROSS_FIELD_RULE =
  "completed_checkpoint_count <= planned_checkpoint_count when planned_checkpoint_count is present";
const REQUIRED_WHEN_ENVELOPE_EXPRESSION = /^([a-z][a-z0-9_]*) = (\S+)$/;
const FIELD_SCHEMA_KEYWORDS = new Set([
  "type",
  "enum",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "x-uuid-version",
  "x-enum-by-function",
  "x-cross-field-rule",
  "x-semantic-rule",
  "x-unit",
  "x-server-added"
]);
const CONSTRAINT_KEYWORDS = new Set(["enum", "x-required-when-envelope"]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function fail(label: string, reason: string): never {
  throw new EvidenceRegistryDefinitionError(`Invalid evidence registry definition ${label}: ${reason}`);
}

function assertKnownKeywords(
  source: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string
): void {
  for (const keyword of Object.keys(source)) {
    if (!allowed.has(keyword)) {
      fail(label, `unsupported keyword ${keyword}`);
    }
  }
}

function fieldType(value: unknown, label: string): EvidenceFieldType {
  if (value === "string" || value === "integer" || value === "number" || value === "boolean") {
    return value;
  }
  return fail(label, "unsupported type");
}

function fieldFormat(value: unknown, label: string): EvidenceFieldFormat | undefined {
  if (value === undefined || value === "uuid" || value === "date-time") {
    return value;
  }
  return fail(label, "unsupported format");
}

function optionalNumber(
  source: Record<string, unknown>,
  keyword: string,
  label: string
): number | undefined {
  const value = source[keyword];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fail(label, `${keyword} must be a finite number`);
}

function optionalPattern(value: unknown, label: string): RegExp | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return fail(label, "pattern must be a string");
  }
  try {
    return new RegExp(value);
  } catch {
    return fail(label, "pattern does not compile");
  }
}

function stringSet(value: unknown, label: string): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string")) {
    return fail(label, "enum must be a non-empty string array");
  }
  return new Set(value);
}

function crossFieldRule(value: unknown, label: string): string | undefined {
  if (value === undefined || value === SUPPORTED_CROSS_FIELD_RULE) {
    return value;
  }
  return fail(label, "unsupported cross-field rule");
}

function serverAdded(value: unknown, label: string): boolean {
  if (value === undefined || typeof value === "boolean") {
    return value === true;
  }
  return fail(label, "x-server-added must be boolean");
}

function assertNarrows(
  values: ReadonlySet<string>,
  base: EvidenceFieldSchema,
  label: string
): ReadonlySet<string> {
  for (const value of values) {
    if (evidenceFieldFault(value, base) !== null) {
      fail(label, `enum value ${value} widens the base schema`);
    }
  }
  return values;
}

function functionScopedEnum(
  source: Record<string, unknown>,
  base: EvidenceFieldSchema,
  functionId: string | undefined,
  label: string
): ReadonlySet<string> | undefined {
  const byFunction = source["x-enum-by-function"];
  if (byFunction === undefined) {
    return base.enumValues;
  }
  if (!isRecord(byFunction)) {
    return fail(label, "x-enum-by-function must be an object");
  }
  const scoped = functionId === undefined
    ? undefined
    : stringSet(byFunction[functionId], label);
  return scoped === undefined ? base.enumValues : assertNarrows(scoped, base, label);
}

export function parseEvidenceFieldSchema(
  source: unknown,
  label: string,
  functionId?: string
): EvidenceFieldSchema {
  if (!isRecord(source)) {
    return fail(label, "schema is missing");
  }
  assertKnownKeywords(source, FIELD_SCHEMA_KEYWORDS, label);
  const base: EvidenceFieldSchema = {
    type: fieldType(source.type, label),
    enumValues: stringSet(source.enum, label),
    pattern: optionalPattern(source.pattern, label),
    minimum: optionalNumber(source, "minimum", label),
    maximum: optionalNumber(source, "maximum", label),
    minLength: optionalNumber(source, "minLength", label),
    maxLength: optionalNumber(source, "maxLength", label),
    format: fieldFormat(source.format, label),
    uuidVersion: optionalNumber(source, "x-uuid-version", label),
    serverAdded: serverAdded(source["x-server-added"], label),
    crossFieldRule: crossFieldRule(source["x-cross-field-rule"], label)
  };
  if (base.uuidVersion !== undefined && base.format !== "uuid") {
    fail(label, "x-uuid-version requires format uuid");
  }
  return Object.freeze({
    ...base,
    enumValues: functionScopedEnum(source, base, functionId, label)
  });
}

function envelopeRequirement(
  expression: unknown,
  envelope: ReadonlyMap<string, EvidenceFieldSchema>,
  label: string
): EvidenceEnvelopeRequirement | undefined {
  if (expression === undefined) {
    return undefined;
  }
  const match = typeof expression === "string"
    ? REQUIRED_WHEN_ENVELOPE_EXPRESSION.exec(expression)
    : null;
  if (match === null) {
    return fail(label, "unsupported x-required-when-envelope expression");
  }
  const [, field, equals] = match;
  const fieldSchema = envelope.get(field);
  if (fieldSchema === undefined) {
    return fail(label, `x-required-when-envelope references unknown envelope field ${field}`);
  }
  if (evidenceFieldFault(equals, fieldSchema) !== null) {
    return fail(label, `x-required-when-envelope value is invalid for ${field}`);
  }
  return { field, equals };
}

export function narrowEvidenceFieldSchema(
  base: EvidenceFieldSchema,
  constraint: unknown,
  envelope: ReadonlyMap<string, EvidenceFieldSchema>,
  label: string
): EvidenceFieldSchema {
  if (!isRecord(constraint)) {
    return fail(label, "constraint must be an object");
  }
  assertKnownKeywords(constraint, CONSTRAINT_KEYWORDS, label);
  const narrowed = stringSet(constraint.enum, label);
  return Object.freeze({
    ...base,
    enumValues: narrowed === undefined ? base.enumValues : assertNarrows(narrowed, base, label),
    requiredWhenEnvelope: envelopeRequirement(
      constraint["x-required-when-envelope"],
      envelope,
      label
    )
  });
}

function formatValid(value: string, schema: EvidenceFieldSchema): boolean {
  if (schema.format === "uuid" && !UUID_PATTERN.test(value)) {
    return false;
  }
  if (
    schema.uuidVersion !== undefined &&
    Number.parseInt(value[14] ?? "", 16) !== schema.uuidVersion
  ) {
    return false;
  }
  return schema.format !== "date-time" ||
    (DATE_TIME_PATTERN.test(value) && Number.isFinite(Date.parse(value)));
}

function stringFault(value: string, schema: EvidenceFieldSchema): EvidenceFieldFault | null {
  const length = [...value].length;
  if (schema.maxLength !== undefined && length > schema.maxLength) {
    return "too_long";
  }
  const valid =
    (schema.minLength === undefined || length >= schema.minLength) &&
    (schema.enumValues === undefined || schema.enumValues.has(value)) &&
    (schema.pattern === undefined || schema.pattern.test(value)) &&
    formatValid(value, schema);
  return valid ? null : "invalid";
}

function numberFault(value: number, schema: EvidenceFieldSchema): EvidenceFieldFault | null {
  const valid =
    Number.isFinite(value) &&
    (schema.type !== "integer" || Number.isInteger(value)) &&
    (schema.minimum === undefined || value >= schema.minimum) &&
    (schema.maximum === undefined || value <= schema.maximum);
  return valid ? null : "invalid";
}

export function evidenceFieldFault(
  value: unknown,
  schema: EvidenceFieldSchema
): EvidenceFieldFault | null {
  if (schema.type === "string") {
    return typeof value === "string" ? stringFault(value, schema) : "invalid";
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean" ? null : "invalid";
  }
  return typeof value === "number" ? numberFault(value, schema) : "invalid";
}
