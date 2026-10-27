import { describe, expect, it } from "vitest";
import { feedbackForOperation, feedbackForRejection } from "../../src/platform/runtime/browser/runtime-action-feedback.js";

describe("Sprint 3.5 generated App truthful interaction feedback", () => {
  it("never treats started or processing actions as saved", () => {
    expect(feedbackForOperation("STARTED")).toBeUndefined();
    expect(feedbackForOperation("PROCESSING")).toBeUndefined();
    expect(feedbackForOperation("COMMITTED")).toBeNull();
  });
  it("surfaces failed, timed out, and cancelled actions instead of silent buttons", () => {
    for (const status of ["FAILED", "TIMED_OUT", "CANCELLED"] as const) {
      expect(feedbackForOperation(status)).toContain("未保存");
    }
  });
  it("shows rejected user input and queue saturation as NOT applied", () => {
    for (const reason of ["PAYLOAD_SCHEMA_MISMATCH", "EVENT_QUEUE_LIMIT", "STALE_LIFECYCLE_GENERATION"] as const) {
      expect(feedbackForRejection(reason)).toContain("未套用");
    }
  });
});
