import registryDocument from "../../../build-spec/baselines/BS-P1-013/registries/evidence-event-registry.json" with {
  type: "json"
};
import {
  EvidenceRegistryDefinitionError,
  evidenceFieldFault,
  isRecord,
  narrowEvidenceFieldSchema,
  parseEvidenceFieldSchema,
  type EvidenceFieldSchema
} from "./evidence-field-schema.js";

export interface EvidenceRegistryEntryDocument {
  readonly event_type: string;
  readonly function_id: string;
  readonly schema_version: string;
  readonly collection_class: string;
  readonly required_context: readonly string[];
  readonly allowed_properties: readonly string[];
  readonly deprecated: boolean;
}

export interface EvidenceRegistryDocument {
  readonly registry_version: string;
  readonly reserved_envelope_fields: readonly string[];
  readonly envelope_field_schemas: Readonly<Record<string, unknown>>;
  readonly property_schemas: Readonly<Record<string, unknown>>;
  readonly event_property_constraints: Readonly<Record<string, unknown>>;
  readonly entries: readonly EvidenceRegistryEntryDocument[];
}

export interface EvidenceRegistryEntry {
  readonly eventType: string;
  readonly functionId: string;
  readonly schemaVersion: string;
  readonly collectionClass:
    | "CORE_OUTCOME"
    | "RELIABILITY"
    | "PRODUCT_SAMPLE"
    | "DEBUG_ONLY";
  readonly requiredContext: ReadonlySet<string>;
  readonly allowedProperties: ReadonlySet<string>;
  readonly propertySchemas: ReadonlyMap<string, EvidenceFieldSchema>;
  readonly deprecated: boolean;
}

export interface EvidenceRegistry {
  readonly version: string;
  readonly reservedEnvelopeFields: ReadonlySet<string>;
  readonly clientEnvelopeSchemas: ReadonlyMap<string, EvidenceFieldSchema>;
  find(eventType: string): EvidenceRegistryEntry | undefined;
}

interface EnvelopeDefinitions {
  readonly reserved: ReadonlySet<string>;
  readonly schemas: ReadonlyMap<string, EvidenceFieldSchema>;
  readonly clientSchemas: ReadonlyMap<string, EvidenceFieldSchema>;
}

const ENTRY_IDENTITY_FIELDS = ["event_type", "function_id", "schema_version"] as const;

function fail(label: string, reason: string): never {
  throw new EvidenceRegistryDefinitionError(`Invalid evidence registry definition ${label}: ${reason}`);
}

function collectionClassOf(
  value: string,
  label: string
): EvidenceRegistryEntry["collectionClass"] {
  if (
    value === "CORE_OUTCOME" ||
    value === "RELIABILITY" ||
    value === "PRODUCT_SAMPLE" ||
    value === "DEBUG_ONLY"
  ) {
    return value;
  }
  return fail(label, `unsupported collection class ${value}`);
}

function uniqueSet(values: readonly string[], label: string): ReadonlySet<string> {
  const unique = new Set(values);
  if (unique.size !== values.length) {
    fail(label, "contains duplicate names");
  }
  return unique;
}

function buildEnvelope(document: EvidenceRegistryDocument): EnvelopeDefinitions {
  const reserved = uniqueSet(document.reserved_envelope_fields, "reserved_envelope_fields");
  for (const field of Object.keys(document.envelope_field_schemas)) {
    if (!reserved.has(field)) {
      fail(`envelope_field_schemas.${field}`, "is not a reserved envelope field");
    }
  }
  const schemas = new Map<string, EvidenceFieldSchema>();
  const clientSchemas = new Map<string, EvidenceFieldSchema>();
  for (const field of reserved) {
    const schema = parseEvidenceFieldSchema(
      document.envelope_field_schemas[field],
      `envelope_field_schemas.${field}`
    );
    schemas.set(field, schema);
    if (!schema.serverAdded) {
      clientSchemas.set(field, schema);
    }
  }
  return { reserved, schemas, clientSchemas };
}

function assertEntryIdentity(
  source: EvidenceRegistryEntryDocument,
  envelope: EnvelopeDefinitions
): void {
  for (const field of ENTRY_IDENTITY_FIELDS) {
    const schema = envelope.schemas.get(field);
    if (schema === undefined || evidenceFieldFault(source[field], schema) !== null) {
      fail(source.event_type, `${field} does not satisfy its envelope schema`);
    }
  }
  if (!source.event_type.startsWith(`${source.function_id}-EVT-`)) {
    fail(source.event_type, "event_type is not owned by function_id");
  }
}

function assertOwnership(
  source: EvidenceRegistryEntryDocument,
  envelope: EnvelopeDefinitions
): void {
  for (const field of source.required_context) {
    if (!envelope.clientSchemas.has(field)) {
      fail(source.event_type, `required_context ${field} is not a client envelope field`);
    }
  }
  for (const property of source.allowed_properties) {
    if (envelope.reserved.has(property)) {
      fail(source.event_type, `reserved envelope field ${property} is in allowed_properties`);
    }
  }
}

function eventConstraints(
  document: EvidenceRegistryDocument,
  source: EvidenceRegistryEntryDocument,
  allowedProperties: ReadonlySet<string>
): Readonly<Record<string, unknown>> {
  const constraints = document.event_property_constraints[source.event_type];
  if (constraints === undefined) {
    return {};
  }
  if (!isRecord(constraints)) {
    return fail(source.event_type, "event_property_constraints must be an object");
  }
  for (const key of Object.keys(constraints)) {
    if (!key.startsWith("x-") && !allowedProperties.has(key)) {
      fail(source.event_type, `constraint ${key} is not an allowed property`);
    }
  }
  return constraints;
}

function propertySchemasFor(
  document: EvidenceRegistryDocument,
  source: EvidenceRegistryEntryDocument,
  allowedProperties: ReadonlySet<string>,
  envelope: EnvelopeDefinitions
): ReadonlyMap<string, EvidenceFieldSchema> {
  const constraints = eventConstraints(document, source, allowedProperties);
  const schemas = new Map<string, EvidenceFieldSchema>();
  for (const property of allowedProperties) {
    const label = `${source.event_type}.${property}`;
    const base = parseEvidenceFieldSchema(
      document.property_schemas[property],
      label,
      source.function_id
    );
    const constraint = constraints[property];
    schemas.set(
      property,
      constraint === undefined
        ? base
        : narrowEvidenceFieldSchema(base, constraint, envelope.clientSchemas, label)
    );
  }
  return schemas;
}

function buildEntry(
  document: EvidenceRegistryDocument,
  source: EvidenceRegistryEntryDocument,
  envelope: EnvelopeDefinitions
): EvidenceRegistryEntry {
  assertEntryIdentity(source, envelope);
  assertOwnership(source, envelope);
  const allowedProperties = uniqueSet(
    source.allowed_properties,
    `${source.event_type}.allowed_properties`
  );
  return Object.freeze({
    eventType: source.event_type,
    functionId: source.function_id,
    schemaVersion: source.schema_version,
    collectionClass: collectionClassOf(source.collection_class, source.event_type),
    requiredContext: uniqueSet(source.required_context, `${source.event_type}.required_context`),
    allowedProperties,
    propertySchemas: propertySchemasFor(document, source, allowedProperties, envelope),
    deprecated: source.deprecated
  });
}

export function createEvidenceRegistry(document: EvidenceRegistryDocument): EvidenceRegistry {
  const envelope = buildEnvelope(document);
  const entriesByType = new Map<string, EvidenceRegistryEntry>();
  for (const source of document.entries) {
    if (entriesByType.has(source.event_type)) {
      fail(source.event_type, "event_type is registered more than once");
    }
    entriesByType.set(source.event_type, buildEntry(document, source, envelope));
  }
  return Object.freeze({
    version: document.registry_version,
    reservedEnvelopeFields: envelope.reserved,
    clientEnvelopeSchemas: envelope.clientSchemas,
    find(eventType: string): EvidenceRegistryEntry | undefined {
      return entriesByType.get(eventType);
    }
  });
}

export const lockedEvidenceRegistry: EvidenceRegistry = createEvidenceRegistry(registryDocument);
