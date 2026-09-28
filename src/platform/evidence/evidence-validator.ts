import type {
  EventValidationResult,
  EvidenceEventInput,
  EvidenceRejection,
  EvidenceRejectionCode
} from "./evidence-types.js";
import {
  lockedEvidenceRegistry,
  type EvidenceRegistry,
  type EvidenceRegistryEntry,
  type EvidencePropertySchema
} from "./evidence-registry.js";

export const EVIDENCE_LIMITS = Object.freeze({
  eventBytes: 8 * 1024,
  propertiesBytes: 4 * 1024,
  batchEvents: 50,
  requestBytes: 256 * 1024,
  propertyDepth: 2,
  propertyStringCharacters: 256
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLUEPRINT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const FUNCTION_ID_PATTERN = /^F[0-9]{2}$/;
const BOUNDED_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const ENVELOPE_FIELDS = new Set([
  "event_id",
  "event_type",
  "schema_version",
  "occurred_at",
  "anonymous_id",
  "session_id",
  "function_id",
  "intent_id",
  "blueprint_hash",
  "share_id",
  "capability_id",
  "error_code",
  "policy_rule_id",
  "trace_id",
  "properties"
]);
const UUID_CONTEXT_FIELDS = [
  "event_id",
  "session_id",
  "intent_id",
  "share_id"
] as const;
const BOUNDED_CONTEXT_FIELDS = [
  "capability_id",
  "error_code",
  "policy_rule_id",
  "trace_id"
] as const;
const FORBIDDEN_PROPERTY_KEYS =
  /^(?:raw_?intent|intent|prompt|raw_?result|result|model_?response|runtime_?state|blueprint_?json|user_?agent|provider_?(?:secret|token)|secret|token|authorization|cookie|email|phone|ip_?address)$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function rejection(
  source: Record<string, unknown> | null,
  code: EvidenceRejectionCode,
  field: string | null
): EventValidationResult {
  const eventId = source?.event_id;
  return {
    accepted: false,
    rejection: {
      event_id: typeof eventId === "string" ? eventId : null,
      code,
      field
    }
  };
}

function validOptionalString(
  source: Record<string, unknown>,
  field: string,
  pattern: RegExp
): boolean {
  const value = source[field];
  return value === undefined || value === null ||
    (typeof value === "string" && pattern.test(value));
}

function inspectPropertyStructure(
  value: unknown,
  depth: number
): "depth" | "forbidden" | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  if (depth > EVIDENCE_LIMITS.propertyDepth) {
    return "depth";
  }
  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      const invalid = inspectPropertyStructure(nestedValue, depth + 1);
      if (invalid !== null) {
        return invalid;
      }
    }
    return null;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_PROPERTY_KEYS.test(key)) {
      return "forbidden";
    }
    const invalid = inspectPropertyStructure(nestedValue, depth + 1);
    if (invalid !== null) {
      return invalid;
    }
  }
  return null;
}

function validString(
  value: string,
  schema: EvidencePropertySchema
): "string" | "type" | null {
  const length = [...value].length;
  if (
    length > EVIDENCE_LIMITS.propertyStringCharacters ||
    (schema.maxLength !== undefined && length > schema.maxLength)
  ) {
    return "string";
  }
  if (schema.minLength !== undefined && length < schema.minLength) {
    return "type";
  }
  if (schema.enumValues !== undefined && !schema.enumValues.has(value)) {
    return "type";
  }
  if (schema.pattern !== undefined && !schema.pattern.test(value)) {
    return "type";
  }
  if (schema.format === "uuid" && !UUID_PATTERN.test(value)) {
    return "type";
  }
  if (schema.uuidVersion !== undefined) {
    const version = Number.parseInt(value[14] ?? "", 16);
    if (version !== schema.uuidVersion) {
      return "type";
    }
  }
  return null;
}

function validatePropertyValue(
  value: unknown,
  schema: EvidencePropertySchema
): "string" | "type" | null {
  if (schema.type === "string") {
    return typeof value === "string" ? validString(value, schema) : "type";
  }
  if (schema.type === "boolean") {
    return typeof value === "boolean" ? null : "type";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "type";
  }
  if (schema.type === "integer" && !Number.isInteger(value)) {
    return "type";
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    return "type";
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return "type";
  }
  return null;
}

function crossFieldValid(
  properties: Record<string, unknown>,
  schema: EvidencePropertySchema
): boolean {
  if (schema.crossFieldRule === undefined) {
    return true;
  }
  const completed = properties.completed_checkpoint_count;
  const planned = properties.planned_checkpoint_count;
  return completed === undefined ||
    planned === undefined ||
    (typeof completed === "number" &&
      typeof planned === "number" &&
      completed <= planned);
}

function requiredConditionMet(
  properties: Record<string, unknown>,
  schema: EvidencePropertySchema
): boolean {
  const condition = schema.requiredWhen;
  return condition === undefined ||
    properties[condition.property] !== condition.equals;
}

function propertyError(
  source: Record<string, unknown>,
  code: EvidenceRejection["code"],
  field: string
): EvidenceRejection {
  return { event_id: String(source.event_id), code, field };
}

function propertyValueError(
  source: Record<string, unknown>,
  key: string,
  value: unknown,
  schema: EvidencePropertySchema
): EvidenceRejection | null {
  const structural = inspectPropertyStructure(value, 1);
  if (structural === "forbidden") {
    return propertyError(source, "F07-ERR-005", key);
  }
  if (structural === "depth") {
    return propertyError(source, "F07-ERR-006", key);
  }
  const invalid = validatePropertyValue(value, schema);
  if (invalid === "string") {
    return propertyError(source, "F07-ERR-006", key);
  }
  if (invalid === "type") {
    return propertyError(source, "F07-ERR-003", key);
  }
  return null;
}

function validateRequiredProperties(
  source: Record<string, unknown>,
  properties: Record<string, unknown>,
  entry: EvidenceRegistryEntry
): EvidenceRejection | null {
  for (const [key, schema] of entry.propertySchemas) {
    if (
      properties[key] === undefined &&
      !requiredConditionMet(properties, schema)
    ) {
      return propertyError(source, "F07-ERR-003", key);
    }
    if (!crossFieldValid(properties, schema)) {
      return propertyError(source, "F07-ERR-003", key);
    }
  }
  return null;
}

function validateProperties(
  source: Record<string, unknown>,
  entry: EvidenceRegistryEntry,
  serializedProperties: string
): EvidenceRejection | null {
  const properties = source.properties;
  if (byteLength(serializedProperties) > EVIDENCE_LIMITS.propertiesBytes) {
    return { event_id: String(source.event_id), code: "F07-ERR-006", field: "properties" };
  }
  if (properties === undefined || properties === null) {
    return null;
  }
  if (!isRecord(properties)) {
    return { event_id: String(source.event_id), code: "F07-ERR-003", field: "properties" };
  }
  for (const [key, value] of Object.entries(properties)) {
    if (!entry.allowedProperties.has(key) || FORBIDDEN_PROPERTY_KEYS.test(key)) {
      return propertyError(source, "F07-ERR-005", key);
    }
    const schema = entry.propertySchemas.get(key);
    if (schema === undefined) {
      return propertyError(source, "F07-ERR-014", key);
    }
    const invalid = propertyValueError(source, key, value, schema);
    if (invalid !== null) {
      return invalid;
    }
  }
  return validateRequiredProperties(source, properties, entry);
}

function contextRejection(
  source: Record<string, unknown>,
  entry: EvidenceRegistryEntry
): Pick<EvidenceRejection, "code" | "field"> | null {
  for (const requiredField of entry.requiredContext) {
    if (source[requiredField] === undefined || source[requiredField] === null) {
      return { code: "F07-ERR-003", field: "context" };
    }
  }
  if (malformedAnonymousId(source.anonymous_id)) {
    return { code: "F07-ERR-001", field: "anonymous_id" };
  }
  for (const field of UUID_CONTEXT_FIELDS) {
    if (!validOptionalString(source, field, UUID_PATTERN)) {
      return { code: "F07-ERR-003", field: "context" };
    }
  }
  if (!validOptionalString(source, "blueprint_hash", BLUEPRINT_HASH_PATTERN)) {
    return { code: "F07-ERR-003", field: "context" };
  }
  return BOUNDED_CONTEXT_FIELDS.every(field =>
    validOptionalString(source, field, BOUNDED_IDENTIFIER_PATTERN)
  )
    ? null
    : { code: "F07-ERR-003", field: "context" };
}

function malformedAnonymousId(value: unknown): boolean {
  return value !== undefined && value !== null && !isUuid(value);
}

function asEvidenceEvent(source: Record<string, unknown>): EvidenceEventInput {
  return source as unknown as EvidenceEventInput;
}

export function validateEvidenceEvent(
  input: unknown,
  serializedEvent: string,
  registry: EvidenceRegistry = lockedEvidenceRegistry
): EventValidationResult {
  if (!isRecord(input)) {
    return rejection(null, "F07-ERR-003", null);
  }
  if (byteLength(serializedEvent) > EVIDENCE_LIMITS.eventBytes) {
    return rejection(input, "F07-ERR-006", null);
  }
  if (Object.keys(input).some(field => !ENVELOPE_FIELDS.has(field))) {
    return rejection(input, "F07-ERR-003", null);
  }
  if (typeof input.event_type !== "string") {
    return rejection(input, "F07-ERR-003", "event_type");
  }
  const entry = registry.find(input.event_type);
  if (entry === undefined) {
    return rejection(input, "F07-ERR-004", "event_type");
  }
  if (input.function_id !== entry.functionId || !FUNCTION_ID_PATTERN.test(entry.functionId)) {
    return rejection(input, "F07-ERR-014", "function_id");
  }
  if (input.schema_version !== entry.schemaVersion) {
    return rejection(input, "F07-ERR-003", "schema_version");
  }
  if (typeof input.occurred_at !== "string" || !Number.isFinite(Date.parse(input.occurred_at))) {
    return rejection(input, "F07-ERR-003", "occurred_at");
  }
  const invalidContext = contextRejection(input, entry);
  if (invalidContext !== null) {
    return rejection(input, invalidContext.code, invalidContext.field);
  }
  const serializedProperties = JSON.stringify(input.properties ?? {});
  const propertyRejection = validateProperties(input, entry, serializedProperties);
  if (propertyRejection !== null) {
    return { accepted: false, rejection: propertyRejection };
  }
  return { accepted: true, event: asEvidenceEvent(input) };
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
