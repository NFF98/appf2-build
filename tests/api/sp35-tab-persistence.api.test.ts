import { afterEach, describe, expect, it, vi } from "vitest";
import { persistBrowserTabState, savedTabState } from "../../src/platform/runtime/browser/browser-runtime.js";
import type { RuntimeInstance } from "../../src/platform/runtime/runtime-instance.js";

const ID = "12345678-1234-4234-8234-123456789abc";
const OTHER = "ffffffff-1234-4234-8234-123456789abc";
const HASH = "sha256:" + "b".repeat(64);
const OTHER_HASH = "sha256:" + "c".repeat(64);

function fakeStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value); }
  });
  return items;
}
const fakeRuntime = (status: "READY" | "DISPOSED" = "READY"): RuntimeInstance => ({
  status, snapshotMutableState: () => ({ tasks: ["Buy milk", "Call dentist"], budget: 15 })
} as unknown as RuntimeInstance);

afterEach(() => vi.unstubAllGlobals());

describe("Sprint 3.5 private per-tab refresh persistence", () => {
  it("restores committed local task state for the same intent and exact Blueprint hash", () => {
    fakeStorage();
    persistBrowserTabState(fakeRuntime(), ID, HASH);
    expect(savedTabState(ID, HASH)).toEqual({ tasks: ["Buy milk", "Call dentist"], budget: 15 });
    expect(savedTabState(OTHER, HASH)).toBeUndefined();
    expect(savedTabState(ID, OTHER_HASH)).toBeUndefined();
  });

  it("never stores failed runtime state or unrelated invalid identities", () => {
    const data = fakeStorage();
    persistBrowserTabState(fakeRuntime("DISPOSED"), ID, HASH);
    persistBrowserTabState(fakeRuntime(), "not-a-verified-intent", HASH);
    expect(data.size).toBe(0);
  });

  it("ignores corrupted JSON and rejects out-of-budget restoration", () => {
    const data = fakeStorage();
    persistBrowserTabState(fakeRuntime(), ID, HASH);
    const key = [...data.keys()][0]!;
    data.set(key, "{not json");
    expect(savedTabState(ID, HASH)).toBeUndefined();
    data.set(key, "x".repeat(129 * 1024));
    expect(savedTabState(ID, HASH)).toBeUndefined();
  });

  it("gracefully handles browser sessionStorage being unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); }
    });
    expect(() => persistBrowserTabState(fakeRuntime(), ID, HASH)).not.toThrow();
    expect(savedTabState(ID, HASH)).toBeUndefined();
  });
});
