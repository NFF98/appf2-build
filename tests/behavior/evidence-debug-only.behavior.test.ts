import { describe, expect, test } from "vitest";

import lockedRegistryDocument from "../../build-spec/baselines/BS-P1-017/registries/evidence-event-registry.json" with {
  type: "json"
};
import {
  admitEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import { isProductionDeliverable } from "../../src/platform/evidence/evidence-queue-policy.js";
import {
  createEvidenceRegistry,
  lockedEvidenceRegistry,
  type EvidenceRegistryDocument
} from "../../src/platform/evidence/evidence-registry.js";
import { coreOutcomeEvent, productSampleEvent } from "../unit/evidence-queue-test-support.js";

function registryWithDebugOnly(eventType: string): EvidenceRegistryDocument {
  const document: EvidenceRegistryDocument = lockedRegistryDocument;
  return {
    ...document,
    entries: document.entries.map(entry =>
      entry.event_type === eventType ? { ...entry, collection_class: "DEBUG_ONLY" } : entry
    )
  };
}

describe("F07 DEBUG_ONLY production default", () => {
  test("TEST-F07-029 DEBUG_ONLY evidence is never admitted for durable production delivery by default", () => {
    const sample = productSampleEvent(1);
    const debugRegistry = createEvidenceRegistry(registryWithDebugOnly(sample.event_type));
    expect(debugRegistry.find(sample.event_type)?.collectionClass).toBe("DEBUG_ONLY");

    expect(admitEvidenceEvent(sample, debugRegistry)).toBeNull();
    expect(admitEvidenceEvent(sample)?.collectionClass).toBe("PRODUCT_SAMPLE");
    expect(admitEvidenceEvent(coreOutcomeEvent(1), debugRegistry)?.collectionClass).toBe("CORE_OUTCOME");

    expect(isProductionDeliverable("DEBUG_ONLY")).toBe(false);
    const deliverable: readonly EvidenceCollectionClass[] = ["CORE_OUTCOME", "RELIABILITY", "PRODUCT_SAMPLE"];
    expect(deliverable.every(isProductionDeliverable)).toBe(true);

    const lockedClasses = lockedRegistryDocument.entries.map(entry => entry.collection_class);
    expect(lockedClasses).not.toContain("DEBUG_ONLY");
    expect(lockedRegistryDocument.entries.every(entry =>
      lockedEvidenceRegistry.find(entry.event_type)?.collectionClass === entry.collection_class
    )).toBe(true);
  });
});
