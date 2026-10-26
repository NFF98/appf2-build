import { describe, expect, it } from "vitest";
import { recoveryDetail } from "../../src/app/create/recovery-message.js";

describe("Sprint 3.5 truthful failure messages", () => {
  it("does not misidentify AI analysis schema rejection as a network problem", () => {
    const detail = recoveryDetail("RETRYABLE", "F01-ERR-002");
    expect(detail).toContain("格式驗證");
    expect(detail).toContain("沒有建立 App");
    expect(detail).toContain("修改需求");
    expect(detail).not.toContain("連線或服務暫時沒有回應");
  });

  it("explains actual model timeout and preserves user agency", () => {
    const detail = recoveryDetail("RETRYABLE", "F01-ERR-009");
    expect(detail).toContain("逾時");
    expect(detail).toContain("原始內容還在");
    expect(detail).toContain("修改需求");
  });

  it("distinguishes Blueprint validation and unsupported capability", () => {
    expect(recoveryDetail("RETRYABLE", "F01-ERR-011")).toContain("藍圖");
    expect(recoveryDetail("REJECTED", "F01-ERR-008")).toContain("尚無對應元件");
  });

  it("does not trust unknown provider/server codes for specific claims", () => {
    expect(recoveryDetail("RETRYABLE", "UNTRUSTED-CODE")).toBe(
      recoveryDetail("RETRYABLE")
    );
    expect(recoveryDetail("STALE_VERSION", "F01-ERR-004")).toContain("更新過");
    expect(recoveryDetail("MALFORMED")).toContain("不完整");
  });
});
