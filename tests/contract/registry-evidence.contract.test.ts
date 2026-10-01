import { describe, expect, test } from "vitest";

import recoveryRegistry from "../../build-spec/baselines/BS-P1-004/registries/recovery-registry.json" with {
  type: "json"
};
import {
  canonicalCoverageContext,
  resolveCapabilityCoverage,
  resolveCapabilityCoverageOutcome,
  type CapabilityRequirement,
  type CoverageResolutionContext,
  type CoverageResolutionOutcome,
  type CoverageResolutionRequest
} from "../../src/platform/capabilities/coverage.js";
import { computeRegistryDigest } from "../../src/platform/capabilities/generate-registry.js";
import {
  F04_ADMISSION_ERROR_IDS,
  REGISTRY_EVIDENCE_EVENT_TYPES,
  RegistryEvidenceError,
  buildRegistryEvidence,
  evidenceRegistryDigest
} from "../../src/platform/capabilities/registry-evidence.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";

const OCCURRED_AT = new Date("2026-09-27T01:23:45.000Z");
const INTENT_ID_V1 = "123e4567-e89b-12d3-a456-426614174000";
const ALLOWED_F04_PROPERTIES = [
  "capability_version",
  "coverage_status",
  "registry_version",
  "registry_digest"
];
const RAW_INTENT = "Build my private diabetes tracker for Grandma";

function requirement(
  requirementId: string,
  semanticNeed: string,
  required = true
): CapabilityRequirement {
  return {
    requirement_id: requirementId,
    semantic_need: semanticNeed,
    required,
    impact_level: required ? "HIGH" : "LOW",
    input_types: [],
    output_types: [],
    interaction_class: "PRESENTATION",
    constraints: []
  };
}

function contextFor(
  extraCapabilities: readonly CapabilityDefinition[],
  compatibilityOutcomes?: CoverageResolutionContext["compatibilityOutcomes"]
): CoverageResolutionContext {
  const source: RegistrySource = {
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities: [...CAPABILITY_REGISTRY_SOURCE.capabilities, ...extraCapabilities]
  };
  return {
    source,
    trustedRuntimeRegistrationKeys: new Set(
      source.capabilities.map(({ runtime }) => runtime.registrationKey)
    ),
    compatibilityOutcomes,
    mode: "PRODUCTION"
  };
}

function disabledRichText(): CapabilityDefinition {
  const base = CAPABILITY_REGISTRY_SOURCE.capabilities.find(({ id }) => id === "content.card");
  if (base === undefined) {
    throw new Error("content.card fixture capability is missing.");
  }
  return {
    ...base,
    id: "test.rich_text",
    runtime: { ...base.runtime, registrationKey: "test/rich-text" },
    semantic: { ...base.semantic, meaning: "Present unavailable rich text.", intentClasses: ["rich_text"] },
    lifecycle: { ...base.lifecycle, availability: "DISABLED" },
    degradation: {
      allowed: true,
      alternatives: [{ id: "content.text", version: "1.0.0" }],
      preservesSemanticCore: true
    }
  };
}

function mixedRequest(): CoverageResolutionRequest {
  return {
    requirements: [
      requirement("covered", "text"),
      requirement("degraded", "rich_text"),
      requirement("unsupported", "not_registered")
    ],
    suggestedCapabilities: {
      unsupported: [{ id: "content.closest_looking", version: "1.0.0" }]
    }
  };
}

function eventIds(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  };
}

function evidenceFor(
  outcome: CoverageResolutionOutcome,
  context: Parameters<typeof buildRegistryEvidence>[2] = {}
): readonly EvidenceEventInput[] {
  return buildRegistryEvidence(outcome, { createEventId: eventIds(), now: () => OCCURRED_AT }, context);
}

function expectAllAccepted(events: readonly EvidenceEventInput[]): void {
  for (const event of events) {
    expect(validateEvidenceEvent(event, JSON.stringify(event))).toMatchObject({ accepted: true });
  }
}

function byType(events: readonly EvidenceEventInput[], eventType: string): readonly EvidenceEventInput[] {
  return events.filter((event) => event.event_type === eventType);
}

function f04Event(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    event_id: "00000000-0000-4000-8000-000000000001",
    event_type: REGISTRY_EVIDENCE_EVENT_TYPES.selected,
    schema_version: "2.0.0",
    occurred_at: OCCURRED_AT.toISOString(),
    function_id: "F04",
    capability_id: "content.text",
    properties: {
      capability_version: "1.0.0",
      coverage_status: "FULLY_SUPPORTED",
      registry_version: CAPABILITY_REGISTRY_SOURCE.registryVersion,
      registry_digest: `sha256:${"a".repeat(64)}`,
      ...properties
    }
  };
}

function expectMalformedSnapshotIdentityRejected(bareDigest: string): void {
  for (const malformed of [
    "",
    "abc",
    bareDigest.toUpperCase(),
    `${bareDigest}0`,
    `sha256:sha256:${bareDigest}`,
    `sha512:${bareDigest}`
  ]) {
    expect(() => evidenceRegistryDigest(malformed)).toThrow(RegistryEvidenceError);
  }
  for (const [field, value] of [
    ["registry_digest", bareDigest],
    ["registry_digest", `sha256:sha256:${bareDigest}`],
    ["registry_version", "v1"],
    ["capability_version", "latest"],
    ["coverage_status", "MOSTLY_SUPPORTED"]
  ] as const) {
    expect(validateEvidenceEvent(f04Event({ [field]: value }), "{}")).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field }
    });
  }
}

function expectDisguisedRawContentRejected(): void {
  for (const disguised of [
    { raw_intent: RAW_INTENT },
    { coverage_status: { prompt: RAW_INTENT } },
    { registry_version: { nested: { intent: RAW_INTENT } } }
  ]) {
    expect(validateEvidenceEvent(f04Event(disguised), "{}")).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-005" }
    });
  }
}

const CONTEXT_FIELD_NAMES = [
  "anonymous_id",
  "session_id",
  "intent_id",
  "blueprint_hash",
  "trace_id"
] as const;

function expectContextSchemaSanitized(outcome: CoverageResolutionOutcome): void {
  const rawUnderAllowedNames = Object.fromEntries(
    CONTEXT_FIELD_NAMES.map((field) => [field, field === "blueprint_hash" ? `sha256:${RAW_INTENT}` : RAW_INTENT])
  );
  const nonConforming = {
    anonymous_id: INTENT_ID_V1,
    session_id: "123e4567-e89b-52d3-a456-426614174000",
    intent_id: "not-a-uuid",
    blueprint_hash: `sha256:${"A".repeat(64)}`,
    trace_id: "0".repeat(32)
  };
  for (const context of [rawUnderAllowedNames, nonConforming]) {
    const events = evidenceFor(outcome, context);
    expectAllAccepted(events);
    expect(JSON.stringify(events)).not.toContain(RAW_INTENT);
    for (const event of events) {
      for (const field of CONTEXT_FIELD_NAMES) {
        expect(event).not.toHaveProperty(field);
      }
    }
  }

  const valid = {
    anonymous_id: "323e4567-e89b-42d3-a456-426614174000",
    session_id: "423e4567-e89b-42d3-a456-426614174000",
    intent_id: INTENT_ID_V1,
    blueprint_hash: `sha256:${"b".repeat(64)}`,
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736"
  };
  const validEvents = evidenceFor(outcome, valid);
  expectAllAccepted(validEvents);
  for (const event of validEvents) {
    expect(event).toMatchObject(valid);
  }
  for (const event of evidenceFor(outcome, { anonymous_id: null, intent_id: undefined })) {
    expect(event).not.toHaveProperty("anonymous_id");
    expect(event).not.toHaveProperty("intent_id");
  }
}

describe("F04 registry evidence contract", () => {
  test("TEST-F04-AC-017 makes capability selected, rejected, gap and mismatch outcomes traceable", () => {
    const mixed = resolveCapabilityCoverageOutcome(mixedRequest(), contextFor([disabledRichText()]));
    const mismatchContext = contextFor([], new Map([["content.text@1.0.0", "INCOMPATIBLE"]]));
    const mismatch = resolveCapabilityCoverageOutcome(
      { requirements: [requirement("covered", "text")] },
      mismatchContext
    );
    const events = [...evidenceFor(mixed), ...evidenceFor(mismatch)];

    expectAllAccepted(events);
    expect(new Set(events.map(({ event_type }) => event_type))).toEqual(
      new Set(Object.values(REGISTRY_EVIDENCE_EVENT_TYPES))
    );
    expect(events.every(({ function_id, schema_version }) =>
      function_id === "F04" && schema_version === "2.0.0"
    )).toBe(true);
    expect(byType(events, "F04-EVT-001").map(({ capability_id }) => capability_id)).toEqual([
      "content.text"
    ]);
    expect(byType(events, "F04-EVT-002").map(({ capability_id, error_code }) => [capability_id, error_code]))
      .toEqual([["test.rich_text", "F04-ERR-003"], ["content.closest_looking", "F04-ERR-001"]]);
    expect(byType(events, "F04-EVT-006").map(({ capability_id }) => capability_id ?? null)).toEqual([
      "test.rich_text",
      null,
      null
    ]);
    expect(byType(events, "F04-EVT-007")).toEqual([
      expect.objectContaining({ capability_id: "content.text", error_code: "F04-ERR-005" })
    ]);
    expect(events.every(({ properties }) => properties?.coverage_status !== undefined)).toBe(true);
    expect(mixed.result).toEqual(resolveCapabilityCoverage(mixedRequest(), contextFor([disabledRichText()])));
    expect(mismatch.result.status).toBe("UNSUPPORTED");

    const revoked = resolveCapabilityCoverageOutcome(
      { requirements: [requirement("covered", "text")] },
      contextFor([], new Map([["content.text@1.0.0", "REVOKED"]]))
    );
    const revokedEvents = evidenceFor(revoked);
    expectAllAccepted(revokedEvents);
    expect(byType(revokedEvents, "F04-EVT-002")).toEqual([
      expect.not.objectContaining({ error_code: expect.anything() })
    ]);
    for (const [admissionCode, errorId] of Object.entries(F04_ADMISSION_ERROR_IDS)) {
      expect(recoveryRegistry.entries.find(({ error_id }) => error_id === errorId)).toMatchObject({
        function_id: "F04",
        error_name: admissionCode
      });
    }
  });

  test("TEST-F04-AC-018 binds capability version, registry version and canonical registry digest identity", () => {
    const canonical = resolveCapabilityCoverageOutcome(
      { requirements: [requirement("covered", "text")] },
      canonicalCoverageContext()
    );
    const variant = resolveCapabilityCoverageOutcome(mixedRequest(), contextFor([disabledRichText()]));
    const bareDigest = computeRegistryDigest(CAPABILITY_REGISTRY_SOURCE);
    const [selected] = evidenceFor(canonical);

    expect(canonical.result.registryDigest).toBe(bareDigest);
    expect(canonical.result.registryDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(selected?.properties).toEqual({
      capability_version: "1.0.0",
      coverage_status: canonical.result.status,
      registry_version: CAPABILITY_REGISTRY_SOURCE.registryVersion,
      registry_digest: `sha256:${bareDigest}`
    });
    expect(new Set(evidenceFor(variant).map(({ properties }) => properties?.registry_digest))).toEqual(
      new Set([`sha256:${computeRegistryDigest(contextFor([disabledRichText()]).source)}`])
    );
    expect(evidenceRegistryDigest(evidenceRegistryDigest(bareDigest))).toBe(`sha256:${bareDigest}`);
    expect(JSON.stringify(evidenceFor(canonical))).not.toContain("sha256:sha256:");
    expect(() =>
      evidenceFor({ ...canonical, result: { ...canonical.result, registryDigest: "not-a-digest" } })
    ).toThrow(RegistryEvidenceError);
    expectMalformedSnapshotIdentityRejected(bareDigest);
  });

  test("TEST-F04-AC-019 records registry evidence without requiring or copying raw intent", () => {
    const request: CoverageResolutionRequest = {
      requirements: [requirement(RAW_INTENT, RAW_INTENT), requirement("covered", "text")],
      suggestedCapabilities: {
        [RAW_INTENT]: [{ id: RAW_INTENT, version: RAW_INTENT }]
      }
    };
    const outcome = resolveCapabilityCoverageOutcome(request, canonicalCoverageContext());
    const disguisedContext = {
      intent_id: INTENT_ID_V1,
      raw_intent: RAW_INTENT,
      prompt: RAW_INTENT,
      properties: { result: RAW_INTENT },
      nested: { intent: { text: RAW_INTENT } }
    };

    const withoutContext = evidenceFor(outcome);
    const withContext = evidenceFor(outcome, disguisedContext);

    expectAllAccepted([...withoutContext, ...withContext]);
    expect(withoutContext.length).toBeGreaterThan(0);
    expect(withoutContext.every((event) => event.intent_id === undefined)).toBe(true);
    expect(withContext.every((event) => event.intent_id === INTENT_ID_V1)).toBe(true);
    expect(JSON.stringify([withoutContext, withContext])).not.toContain(RAW_INTENT);
    for (const event of withContext) {
      expect(Object.keys(event.properties ?? {}).every((key) => ALLOWED_F04_PROPERTIES.includes(key)))
        .toBe(true);
      expect(event).not.toHaveProperty("raw_intent");
      expect(event).not.toHaveProperty("prompt");
      expect(event).not.toHaveProperty("nested");
    }
    const [unknownSuggestion, ...otherRejections] = byType(withContext, "F04-EVT-002");
    expect(otherRejections).toEqual([]);
    expect(unknownSuggestion?.error_code).toBe("F04-ERR-001");
    expect(unknownSuggestion).not.toHaveProperty("capability_id");
    expect(unknownSuggestion?.properties).not.toHaveProperty("capability_version");
    expectDisguisedRawContentRejected();
    expectContextSchemaSanitized(outcome);
  });
});
