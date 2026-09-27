import { describe, expect, test } from "vitest";

import {
  ensureAnonymousId,
  ensureSessionId,
  IdentityGenerationError,
  SESSION_ID_STORAGE_KEY
} from "../../src/platform/identity/browser-identity.js";
import {
  LAST_SEEN_UPDATE_INTERVAL_MS,
  shouldUpdateLastSeen
} from "../../src/platform/identity/last-seen-policy.js";
import {
  identityDependencies,
  MemoryIdentityStorage
} from "./identity-test-support.js";

const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "987fcdeb-51a2-43d7-8abc-0123456789ab";

describe("last_seen update policy", () => {
  test("TEST-F07-AC-005 bounds repeated meaningful interactions to one update per 24 hours", () => {
    const firstInteractionAt = Date.UTC(2026, 8, 27, 0, 0, 0);
    const laterInteractions = [
      firstInteractionAt + 1_000,
      firstInteractionAt + 60_000,
      firstInteractionAt + LAST_SEEN_UPDATE_INTERVAL_MS - 60_000
    ];

    expect(shouldUpdateLastSeen(null, firstInteractionAt)).toBe(true);
    expect(
      laterInteractions.map(now => shouldUpdateLastSeen(firstInteractionAt, now))
    ).toEqual([false, false, false]);
    expect(
      shouldUpdateLastSeen(
        firstInteractionAt,
        firstInteractionAt + LAST_SEEN_UPDATE_INTERVAL_MS
      )
    ).toBe(true);
    expect(
      shouldUpdateLastSeen(
        firstInteractionAt,
        firstInteractionAt + LAST_SEEN_UPDATE_INTERVAL_MS + 1
      )
    ).toBe(true);
    expect(shouldUpdateLastSeen(firstInteractionAt, firstInteractionAt - 1)).toBe(false);
  });
});

describe("browser session identity", () => {
  test("preserves session_id in one session and rotates it after session storage reset", () => {
    const sessionStorage = new MemoryIdentityStorage();
    const dependencies = identityDependencies(
      [ID_A, ID_B],
      new MemoryIdentityStorage(),
      sessionStorage
    );

    expect(ensureSessionId(dependencies)).toBe(ID_A);
    expect(ensureSessionId(dependencies)).toBe(ID_A);
    sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
    expect(ensureSessionId(dependencies)).toBe(ID_B);
  });

  test("gives independent browser sessions independent session_id values", () => {
    const firstSession = identityDependencies([ID_A]);
    const secondSession = identityDependencies([ID_B]);

    expect(ensureSessionId(firstSession)).toBe(ID_A);
    expect(ensureSessionId(secondSession)).toBe(ID_B);
  });

  test("rotates an invalid stored session_id", () => {
    const sessionStorage = new MemoryIdentityStorage();
    sessionStorage.setItem(SESSION_ID_STORAGE_KEY, "invalid-session");
    const dependencies = identityDependencies(
      [ID_A],
      new MemoryIdentityStorage(),
      sessionStorage
    );

    expect(ensureSessionId(dependencies)).toBe(ID_A);
    expect(sessionStorage.getItem(SESSION_ID_STORAGE_KEY)).toBe(ID_A);
  });

  test("rejects a malformed UUID generator result without persisting it", () => {
    const dependencies = identityDependencies(["not-a-random-uuid"]);

    expect(() => ensureAnonymousId(dependencies)).toThrowError(IdentityGenerationError);
    expect(dependencies.localStorage.getItem("appf2.anonymous_id.v1")).toBeNull();
  });
});
