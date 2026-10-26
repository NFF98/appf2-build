import { describe, expect, it } from "vitest";
import { recoveryReason } from "../../src/app/create/creation-controller.js";
import type { F01Failure } from "../../src/app/create/f01-wire.js";

const api = (code: string, retryable = true): F01Failure => ({
  kind: "API", code, retryable, httpStatus: 502, violations: []
});

describe("Sprint 3.5 recovery for complex real AI creation", () => {
  it("reports invalid AI output separately instead of claiming a network failure", () => {
    expect(recoveryReason(api("F01-ERR-002"))).toBe("MODEL_INVALID");
    expect(recoveryReason(api("F01-ERR-007"))).toBe("MODEL_INVALID");
    expect(recoveryReason(api("F01-ERR-010"))).toBe("MODEL_INVALID");
  });
  it("reports an AI deadline separately from a disconnected browser", () => {
    expect(recoveryReason(api("F01-ERR-009"))).toBe("MODEL_TIMEOUT");
    expect(recoveryReason({ kind: "NETWORK" })).toBe("RETRYABLE");
    expect(recoveryReason({ kind: "ABORTED" })).toBe("RETRYABLE");
  });
  it("preserves existing non-model recovery and never mislabels policy rejection", () => {
    expect(recoveryReason(api("F01-ERR-004"))).toBe("STALE_VERSION");
    expect(recoveryReason(api("F01-ERR-015", false))).toBe("NOT_FOUND");
    expect(recoveryReason(api("F01-ERR-012", false))).toBe("REJECTED");
  });
});
