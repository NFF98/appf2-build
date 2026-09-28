import registryDocument from "../../../build-spec/baselines/BS-P1-003/registries/evidence-event-registry.json" with {
  type: "json"
};

export interface EvidencePropertySchema {
  readonly type: "string" | "integer" | "number" | "boolean";
  readonly enumValues?: ReadonlySet<string>;
  readonly pattern?: RegExp;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly format?: "uuid";
  readonly uuidVersion?: number;
  readonly crossFieldRule?: string;
  readonly requiredWhen?: {
    readonly property: string;
    readonly equals: string;
  };
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
  readonly propertySchemas: ReadonlyMap<string, EvidencePropertySchema>;
  readonly deprecated: boolean;
}

export interface EvidenceRegistry {
  readonly version: string;
  find(eventType: string): EvidenceRegistryEntry | undefined;
}

function collectionClassOf(
  value: string
): EvidenceRegistryEntry["collectionClass"] {
  if (
    value === "CORE_OUTCOME" ||
    value === "RELIABILITY" ||
    value === "PRODUCT_SAMPLE" ||
    value === "DEBUG_ONLY"
  ) {
    return value;
  }
  throw new Error(`Invalid locked evidence collection class: ${value}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalNumber(
  source: Record<string, unknown>,
  key: string
): number | undefined {
  const value = source[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid evidence property schema number: ${key}`);
  }
  return value;
}

function stringSet(value: unknown, label: string): ReadonlySet<string> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
    throw new Error(`Invalid evidence property schema enum: ${label}`);
  }
  return new Set(value);
}

function narrowedEnum(
  schema: Record<string, unknown>,
  functionId: string,
  constraint: Record<string, unknown> | undefined,
  label: string
): ReadonlySet<string> | undefined {
  const constrained = stringSet(constraint?.enum, label);
  if (constrained !== undefined) {
    return constrained;
  }
  const byFunction = schema["x-enum-by-function"];
  if (isRecord(byFunction)) {
    const scoped = stringSet(byFunction[functionId], label);
    if (scoped !== undefined) {
      return scoped;
    }
  }
  return stringSet(schema.enum, label);
}

function requiredWhen(
  constraint: Record<string, unknown> | undefined,
  label: string
): EvidencePropertySchema["requiredWhen"] {
  const expression = constraint?.["x-required-when"];
  if (expression === undefined) {
    return undefined;
  }
  if (typeof expression !== "string") {
    throw new Error(`Invalid evidence required condition: ${label}`);
  }
  const match = /^([a-z][a-z0-9_]*) = ([A-Z0-9-]+)$/.exec(expression);
  if (match === null) {
    throw new Error(`Unsupported evidence required condition: ${label}`);
  }
  return { property: match[1], equals: match[2] };
}

function crossFieldRule(
  source: Record<string, unknown>,
  propertyName: string
): string | undefined {
  const rule = source["x-cross-field-rule"];
  if (rule === undefined) {
    return undefined;
  }
  if (
    rule !==
    "completed_checkpoint_count <= planned_checkpoint_count when planned_checkpoint_count is present"
  ) {
    throw new Error(`Unsupported evidence cross-field rule: ${propertyName}`);
  }
  return rule;
}

function propertySchema(
  propertyName: string,
  functionId: string,
  eventType: string
): EvidencePropertySchema {
  const documents = registryDocument.property_schemas as unknown;
  if (!isRecord(documents) || !isRecord(documents[propertyName])) {
    throw new Error(`Missing evidence property schema: ${propertyName}`);
  }
  const source = documents[propertyName];
  const constraints = registryDocument.event_property_constraints as unknown;
  const eventConstraints = isRecord(constraints) && isRecord(constraints[eventType])
    ? constraints[eventType]
    : undefined;
  const constraint = eventConstraints !== undefined &&
    isRecord(eventConstraints[propertyName])
    ? eventConstraints[propertyName]
    : undefined;
  const type = source.type;
  if (
    type !== "string" &&
    type !== "integer" &&
    type !== "number" &&
    type !== "boolean"
  ) {
    throw new Error(`Unsupported evidence property type: ${propertyName}`);
  }
  const format = source.format === "uuid" ? "uuid" : undefined;
  if (source.format !== undefined && format === undefined) {
    throw new Error(`Unsupported evidence property format: ${propertyName}`);
  }
  return Object.freeze({
    type,
    enumValues: narrowedEnum(source, functionId, constraint, propertyName),
    pattern: typeof source.pattern === "string"
      ? new RegExp(source.pattern)
      : undefined,
    minimum: optionalNumber(source, "minimum"),
    maximum: optionalNumber(source, "maximum"),
    minLength: optionalNumber(source, "minLength"),
    maxLength: optionalNumber(source, "maxLength"),
    format,
    uuidVersion: optionalNumber(source, "x-uuid-version"),
    crossFieldRule: crossFieldRule(source, propertyName),
    requiredWhen: requiredWhen(constraint, propertyName)
  });
}

function buildRegistryEntry(
  source: (typeof registryDocument.entries)[number]
): EvidenceRegistryEntry {
  if (!source.event_type.startsWith(`${source.function_id}-EVT-`)) {
    throw new Error(`Invalid locked evidence registry entry: ${source.event_type}`);
  }
  const propertySchemas = new Map(
    source.allowed_properties.map(propertyName => [
      propertyName,
      propertySchema(propertyName, source.function_id, source.event_type)
    ])
  );

  return Object.freeze({
    eventType: source.event_type,
    functionId: source.function_id,
    schemaVersion: source.schema_version,
    collectionClass: collectionClassOf(source.collection_class),
    requiredContext: new Set(source.required_context),
    allowedProperties: new Set(source.allowed_properties),
    propertySchemas,
    deprecated: source.deprecated
  });
}

const entriesByType = new Map(
  registryDocument.entries.map(source => {
    const entry = buildRegistryEntry(source);
    return [entry.eventType, entry] as const;
  })
);

export const lockedEvidenceRegistry: EvidenceRegistry = Object.freeze({
  version: registryDocument.registry_version,
  find(eventType: string): EvidenceRegistryEntry | undefined {
    return entriesByType.get(eventType);
  }
});
