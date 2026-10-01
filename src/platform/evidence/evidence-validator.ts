import type {
  EventValidationResult,
  EvidenceEventInput,
  EvidenceRejection,
  EvidenceRejectionCode
} from "./evidence-types.js";
import {
  lockedEvidenceRegistry,
  type EvidenceRegistry,
  type EvidenceRegistryEntry
} from "./evidence-registry.js";
import {
  evidenceFieldFault,
  isRecord,
  isUuid,
  type EvidenceFieldSchema
} from "./evidence-field-schema.js";

export { isUuid };

export const EVIDENCE_LIMITS = Object.freeze({
  eventBytes: 8 * 1024,
  propertiesBytes: 4 * 1024,
  batchEvents: 50,
  requestBytes: 256 * 1024,
  propertyDepth: 2,
  propertyStringCharacters: 256
});

const MANDATORY_ENVELOPE_FIELDS = [
  "event_id",
  "event_type",
  "schema_version",
  "occurred_at",
  "function_id"
] as const;
const FIELD_LABELLED_ENVELOPE_FIELDS = new Set([
  "event_type",
  "schema_version",
  "occurred_at",
  "function_id"
]);
const FORBIDDEN_PROPERTY_KEYS =
  /^(?:raw_?intent|intent|prompt|raw_?result|result|model_?response|runtime_?state|blueprint_?json|user_?agent|provider_?(?:secret|token)|secret|token|authorization|cookie|email|phone|ip_?address)$/i;

type RejectionDetail = Pick<EvidenceRejection, "code" | "field">;

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

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

function envelopeFieldRejection(field: string): RejectionDetail {
  if (field === "anonymous_id") {
    return { code: "F07-ERR-001", field: "anonymous_id" };
  }
  return {
    code: "F07-ERR-003",
    field: FIELD_LABELLED_ENVELOPE_FIELDS.has(field) ? field : "context"
  };
}

function envelopeRejection(
  source: Record<string, unknown>,
  registry: EvidenceRegistry
): RejectionDetail | null {
  for (const field of MANDATORY_ENVELOPE_FIELDS) {
    if (isAbsent(source[field])) {
      return envelopeFieldRejection(field);
    }
  }
  for (const [field, schema] of registry.clientEnvelopeSchemas) {
    const value = source[field];
    if (!isAbsent(value) && evidenceFieldFault(value, schema) !== null) {
      return envelopeFieldRejection(field);
    }
  }
  return null;
}

function registeredEntryRejection(
  source: Record<string, unknown>,
  entry: EvidenceRegistryEntry
): RejectionDetail | null {
  if (source.function_id !== entry.functionId) {
    return { code: "F07-ERR-014", field: "function_id" };
  }
  if (source.schema_version !== entry.schemaVersion) {
    return { code: "F07-ERR-003", field: "schema_version" };
  }
  for (const requiredField of entry.requiredContext) {
    if (isAbsent(source[requiredField])) {
      return { code: "F07-ERR-003", field: "context" };
    }
  }
  return null;
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
  const nested = Array.isArray(value) ? value : Object.values(value);
  if (!Array.isArray(value) && Object.keys(value).some(key => FORBIDDEN_PROPERTY_KEYS.test(key))) {
    return "forbidden";
  }
  for (const nestedValue of nested) {
    const invalid = inspectPropertyStructure(nestedValue, depth + 1);
    if (invalid !== null) {
      return invalid;
    }
  }
  return null;
}

function crossFieldValid(
  properties: Record<string, unknown>,
  schema: EvidenceFieldSchema
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

function requiredByEnvelope(
  source: Record<string, unknown>,
  schema: EvidenceFieldSchema
): boolean {
  const condition = schema.requiredWhenEnvelope;
  return condition !== undefined && source[condition.field] === condition.equals;
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
  schema: EvidenceFieldSchema
): EvidenceRejection | null {
  const structural = inspectPropertyStructure(value, 1);
  if (structural === "forbidden") {
    return propertyError(source, "F07-ERR-005", key);
  }
  if (structural === "depth") {
    return propertyError(source, "F07-ERR-006", key);
  }
  if (typeof value === "string" && [...value].length > EVIDENCE_LIMITS.propertyStringCharacters) {
    return propertyError(source, "F07-ERR-006", key);
  }
  const fault = evidenceFieldFault(value, schema);
  if (fault === null) {
    return null;
  }
  return propertyError(source, fault === "too_long" ? "F07-ERR-006" : "F07-ERR-003", key);
}

function validateRequiredProperties(
  source: Record<string, unknown>,
  properties: Record<string, unknown>,
  entry: EvidenceRegistryEntry
): EvidenceRejection | null {
  for (const [key, schema] of entry.propertySchemas) {
    if (properties[key] === undefined && requiredByEnvelope(source, schema)) {
      return propertyError(source, "F07-ERR-003", key);
    }
    if (!crossFieldValid(properties, schema)) {
      return propertyError(source, "F07-ERR-003", key);
    }
  }
  return null;
}

function propertyKeyError(
  source: Record<string, unknown>,
  keys: readonly string[],
  entry: EvidenceRegistryEntry,
  registry: EvidenceRegistry
): EvidenceRejection | null {
  const reserved = keys.find(key => registry.reservedEnvelopeFields.has(key));
  const forbidden = reserved ?? keys.find(key =>
    !entry.allowedProperties.has(key) || FORBIDDEN_PROPERTY_KEYS.test(key)
  );
  return forbidden === undefined ? null : propertyError(source, "F07-ERR-005", forbidden);
}

function validateProperties(
  source: Record<string, unknown>,
  entry: EvidenceRegistryEntry,
  registry: EvidenceRegistry
): EvidenceRejection | null {
  const rawProperties = source.properties;
  if (byteLength(JSON.stringify(rawProperties ?? {})) > EVIDENCE_LIMITS.propertiesBytes) {
    return propertyError(source, "F07-ERR-006", "properties");
  }
  const properties = isAbsent(rawProperties) ? {} : rawProperties;
  if (!isRecord(properties)) {
    return propertyError(source, "F07-ERR-003", "properties");
  }
  const invalidKey = propertyKeyError(source, Object.keys(properties), entry, registry);
  if (invalidKey !== null) {
    return invalidKey;
  }
  for (const [key, value] of Object.entries(properties)) {
    const schema = entry.propertySchemas.get(key);
    const invalid = schema === undefined
      ? propertyError(source, "F07-ERR-014", key)
      : propertyValueError(source, key, value, schema);
    if (invalid !== null) {
      return invalid;
    }
  }
  return validateRequiredProperties(source, properties, entry);
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
  if (Object.keys(input).some(field => field !== "properties" && !registry.clientEnvelopeSchemas.has(field))) {
    return rejection(input, "F07-ERR-003", null);
  }
  const invalidEnvelope = envelopeRejection(input, registry);
  if (invalidEnvelope !== null) {
    return rejection(input, invalidEnvelope.code, invalidEnvelope.field);
  }
  const entry = registry.find(String(input.event_type));
  if (entry === undefined) {
    return rejection(input, "F07-ERR-004", "event_type");
  }
  const invalidEntry = registeredEntryRejection(input, entry);
  if (invalidEntry !== null) {
    return rejection(input, invalidEntry.code, invalidEntry.field);
  }
  const propertyRejection = validateProperties(input, entry, registry);
  if (propertyRejection !== null) {
    return { accepted: false, rejection: propertyRejection };
  }
  return { accepted: true, event: asEvidenceEvent(input) };
}
