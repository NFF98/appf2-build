import { describe, expect, it } from "vitest";
import { t002BlueprintFutureDiffProof } from "../../src/platform/blueprint/t002-future-diff-proof";
import { t002CapabilityFutureDiffProof } from "../../src/platform/capabilities/t002-future-diff-proof";
import { t002GeneratedCapabilityFutureDiffProof } from "../../generated/capabilities/t002-future-diff-proof";

describe("T002 future-diff gate proof", () => {
  it("TEST-F02-004 future-diff proof only", () => {
    expect(t002BlueprintFutureDiffProof).toBe("blueprint-scope");
  });

  it("TEST-F02-005 future-diff proof only", () => {
    expect(t002CapabilityFutureDiffProof).toBe("capability-scope");
  });

  it("TEST-F02-006 future-diff proof only", () => {
    expect(t002GeneratedCapabilityFutureDiffProof).toBe("generated-validator-scope");
  });

  it("TEST-F02-007 future-diff proof only", () => {
    expect([
      t002BlueprintFutureDiffProof,
      t002CapabilityFutureDiffProof,
      t002GeneratedCapabilityFutureDiffProof
    ]).toHaveLength(3);
  });

  it("TEST-F02-AC-008 future-diff proof only", () => {
    expect(new Set([
      t002BlueprintFutureDiffProof,
      t002CapabilityFutureDiffProof,
      t002GeneratedCapabilityFutureDiffProof
    ]).size).toBe(3);
  });
});
