import { describe, expect, test } from "vitest";
import { parseWorkerOrigin } from "../../tooling/web/worker-origin.js";

describe("Sprint 3.5: real staging Worker target", () => {
  test("missing target remains explicitly unconfigured, not silently mocked", () => {
    expect(parseWorkerOrigin(undefined)).toBeNull();
    expect(parseWorkerOrigin("")).toBeNull();
  });

  test("accepts secure staging and local Wrangler only", () => {
    expect(parseWorkerOrigin("https://appf2-staging.example.com")).toBe("https://appf2-staging.example.com");
    expect(parseWorkerOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  test.each(["http://api.example.com", "javascript:alert(1)", "https://user:pass@api.example.com", "https://api.example.com/secret", "https://api.example.com/?token=abc", "not-an-origin"])(
    "rejects unsafe or invalid target %s",
    (input) => expect(() => parseWorkerOrigin(input)).toThrow()
  );
});
