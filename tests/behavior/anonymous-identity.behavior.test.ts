import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ANONYMOUS_ID_STORAGE_KEY,
  createBrowserIdentityDependencies,
  ensureAnonymousId
} from "../../src/platform/identity/browser-identity.js";
import {
  identityDependencies,
  MemoryIdentityStorage
} from "../unit/identity-test-support.js";

const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "987fcdeb-51a2-43d7-8abc-0123456789ab";

describe("anonymous browser identity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("TEST-F07-AC-001 establishes identity before First Value without account, login, user_id, or network", () => {
    const dependencies = identityDependencies([ID_A]);

    const identity = ensureAnonymousId(dependencies);

    expect(identity).toBe(ID_A);
    expect(dependencies.localStorage.getItem(ANONYMOUS_ID_STORAGE_KEY)).toBe(ID_A);
    expect(Object.keys(dependencies).sort()).toEqual([
      "generatedCount",
      "localStorage",
      "randomUUID",
      "sessionStorage"
    ]);
  });

  test("TEST-F07-002 creates first-party random identity and reuses valid stored identity", () => {
    const storage = new MemoryIdentityStorage();
    const dependencies = identityDependencies([ID_A, ID_B], storage);

    expect(ensureAnonymousId(dependencies)).toBe(ID_A);
    expect(ensureAnonymousId(dependencies)).toBe(ID_A);
    expect(storage.getItem(ANONYMOUS_ID_STORAGE_KEY)).toBe(ID_A);
    expect(dependencies.generatedCount()).toBe(1);
  });

  test("composes production identity from first-party storage and Web Crypto randomUUID", () => {
    const localStorage = new MemoryIdentityStorage();
    const sessionStorage = new MemoryIdentityStorage();
    const randomUUID = vi.fn(() => ID_A);
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("crypto", { randomUUID });

    const dependencies = createBrowserIdentityDependencies();

    expect(dependencies.localStorage).toBe(localStorage);
    expect(dependencies.sessionStorage).toBe(sessionStorage);
    expect(ensureAnonymousId(dependencies)).toBe(ID_A);
    expect(randomUUID).toHaveBeenCalledOnce();
  });
});
