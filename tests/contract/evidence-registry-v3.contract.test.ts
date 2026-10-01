import { describe, expect, test } from "vitest";

import registryDocument from "../../build-spec/baselines/BS-P1-004/registries/evidence-event-registry.json" with {
  type: "json"
};
import { EvidenceRegistryDefinitionError } from "../../src/platform/evidence/evidence-field-schema.js";
import {
  createEvidenceRegistry,
  lockedEvidenceRegistry
} from "../../src/platform/evidence/evidence-registry.js";

interface MutableRegistryDocument {
  registry_version: string;
  reserved_envelope_fields: string[];
  envelope_field_schemas: Record<string, Record<string, unknown>>;
  property_schemas: Record<string, Record<string, unknown>>;
  event_property_constraints: Record<string, Record<string, unknown>>;
  entries: {
    event_type: string;
    function_id: string;
    schema_version: string;
    collection_class: string;
    required_context: string[];
    allowed_properties: string[];
    deprecated: boolean;
  }[];
}

function lockedCopy(): MutableRegistryDocument {
  return structuredClone(registryDocument);
}

function entryOf(document: MutableRegistryDocument, eventType: string) {
  const entry = document.entries.find(({ event_type }) => event_type === eventType);
  if (entry === undefined) {
    throw new Error(`Locked registry fixture is missing ${eventType}.`);
  }
  return entry;
}

function expectFailClosed(mutate: (document: MutableRegistryDocument) => void): void {
  const document = lockedCopy();
  mutate(document);
  expect(() => createEvidenceRegistry(document)).toThrow(EvidenceRegistryDefinitionError);
}

describe("Evidence Registry v3 loader", () => {
  test("binds the locked BS-P1-004 registry with field-specific envelope UUID versions", () => {
    const envelope = lockedEvidenceRegistry.clientEnvelopeSchemas;

    expect(lockedEvidenceRegistry.version).toBe("3.0.0");
    for (const field of ["event_id", "anonymous_id", "session_id", "share_id"]) {
      expect(envelope.get(field)).toMatchObject({ format: "uuid", uuidVersion: 4 });
    }
    expect(envelope.get("intent_id")).toMatchObject({ format: "uuid" });
    expect(envelope.get("intent_id")?.uuidVersion).toBeUndefined();
    expect(envelope.has("received_at")).toBe(false);
    expect(lockedEvidenceRegistry.reservedEnvelopeFields.has("received_at")).toBe(true);
    expect(lockedEvidenceRegistry.find("F05-EVT-007")?.schemaVersion).toBe("2.0.0");
    expect(lockedEvidenceRegistry.find("F03-EVT-010")?.schemaVersion).toBe("3.0.0");
    for (const eventType of ["F04-EVT-001", "F04-EVT-002", "F04-EVT-006", "F04-EVT-007"]) {
      expect(lockedEvidenceRegistry.find(eventType)).toMatchObject({
        functionId: "F04",
        schemaVersion: "2.0.0",
        allowedProperties: new Set([
          "capability_version",
          "coverage_status",
          "registry_version",
          "registry_digest"
        ])
      });
    }
    expect(
      lockedEvidenceRegistry.find("F03-EVT-010")?.propertySchemas.get("integrity_status")
        ?.requiredWhenEnvelope
    ).toEqual({ field: "error_code", equals: "F03-ERR-018" });
  });

  test("fails closed when ownership between envelope and properties is violated", () => {
    expectFailClosed(document => {
      entryOf(document, "F03-EVT-010").allowed_properties.push("error_code");
    });
    expectFailClosed(document => {
      document.reserved_envelope_fields.push("share_mode");
    });
    expectFailClosed(document => {
      delete document.envelope_field_schemas.trace_id;
    });
    expectFailClosed(document => {
      document.envelope_field_schemas.share_mode = { type: "string" };
    });
    expectFailClosed(document => {
      entryOf(document, "F05-EVT-007").required_context.push("received_at");
    });
  });

  test("fails closed on missing or unsupported schema definitions", () => {
    expectFailClosed(document => {
      delete document.property_schemas.share_mode;
    });
    expectFailClosed(document => {
      document.property_schemas.share_mode = { ...document.property_schemas.share_mode, "x-unknown": true };
    });
    expectFailClosed(document => {
      document.property_schemas.share_mode = { ...document.property_schemas.share_mode, type: "object" };
    });
    expectFailClosed(document => {
      document.envelope_field_schemas.event_id = { type: "string", "x-uuid-version": 4 };
    });
    expectFailClosed(document => {
      document.envelope_field_schemas.trace_id = { type: "string", pattern: "(" };
    });
    expectFailClosed(document => {
      entryOf(document, "F05-EVT-007").schema_version = "2.0";
    });
    expectFailClosed(document => {
      document.entries.push({ ...entryOf(document, "F05-EVT-007") });
    });
  });

  test("fails closed on constraints that widen, use legacy conditions or reference unknown envelope fields", () => {
    const integrity = (constraint: Record<string, unknown>) => (document: MutableRegistryDocument) => {
      document.event_property_constraints["F03-EVT-010"] = { integrity_status: constraint };
    };

    expectFailClosed(integrity({ enum: ["NOT_A_REGISTERED_STATUS"] }));
    expectFailClosed(integrity({ "x-required-when": "error_code = F03-ERR-018" }));
    expectFailClosed(integrity({ "x-required-when-envelope": "missing_field = F03-ERR-018" }));
    expectFailClosed(integrity({ "x-required-when-envelope": "error_code = e" }));
    expectFailClosed(document => {
      document.event_property_constraints["F03-EVT-010"] = { not_allowed_property: { enum: ["X"] } };
    });
  });
});
