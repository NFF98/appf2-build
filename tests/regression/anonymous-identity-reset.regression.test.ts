import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  ANONYMOUS_ID_STORAGE_KEY,
  ensureAnonymousId
} from "../../src/platform/identity/browser-identity.js";
import {
  identityDependencies,
  MemoryIdentityStorage
} from "../unit/identity-test-support.js";

const ID_A = "123e4567-e89b-42d3-a456-426614174000";
const ID_B = "987fcdeb-51a2-43d7-8abc-0123456789ab";

describe("anonymous identity reset privacy", () => {
  test("TEST-F07-003 creates a distinct identity after site identity storage is cleared", () => {
    const storage = new MemoryIdentityStorage();
    const dependencies = identityDependencies([ID_A, ID_B], storage);

    const beforeReset = ensureAnonymousId(dependencies);
    storage.removeItem(ANONYMOUS_ID_STORAGE_KEY);
    const afterReset = ensureAnonymousId(dependencies);

    expect(beforeReset).toBe(ID_A);
    expect(afterReset).toBe(ID_B);
    expect(afterReset).not.toBe(beforeReset);
    expect(storage.getItem(ANONYMOUS_ID_STORAGE_KEY)).toBe(ID_B);
    expect(dependencies.generatedCount()).toBe(2);
  });

  test("TEST-F07-022 does not stitch a rotated identity using browser or device traits", () => {
    const storage = new MemoryIdentityStorage();
    const dependencies = identityDependencies([ID_A, ID_B], storage);

    const beforeReset = ensureAnonymousId(dependencies);
    storage.removeItem(ANONYMOUS_ID_STORAGE_KEY);
    const afterReset = ensureAnonymousId(dependencies);
    const identityDirectory = new URL("../../src/platform/identity/", import.meta.url);
    const productionSource = readdirSync(identityDirectory)
      .filter(file => file.endsWith(".ts"))
      .map(file => readFileSync(new URL(file, identityDirectory), "utf8"))
      .join("\n");
    const fingerprintInputs = [
      "navigator",
      "userAgent",
      "hardwareConcurrency",
      "deviceMemory",
      "screen.",
      "timezone",
      "timeZone",
      "Intl.DateTimeFormat",
      "canvas",
      "WebGL",
      "AudioContext",
      "font",
      "ipAddress",
      "remoteAddress",
      "crossSite",
      "cross-site",
      "document.cookie",
      "fingerprint",
      "device_hash",
      "browser_hash",
      "deviceHash",
      "browserHash"
    ];

    expect(fingerprintInputs.filter(input => productionSource.includes(input))).toEqual([]);
    expect(afterReset).toBe(ID_B);
    expect(afterReset).not.toBe(beforeReset);
  });

  test("rotates a malformed anonymous_id instead of repairing or hashing it", () => {
    const storage = new MemoryIdentityStorage();
    storage.setItem(ANONYMOUS_ID_STORAGE_KEY, "malformed-device-derived-value");
    const dependencies = identityDependencies([ID_A], storage);

    expect(ensureAnonymousId(dependencies)).toBe(ID_A);
    expect(storage.getItem(ANONYMOUS_ID_STORAGE_KEY)).toBe(ID_A);
    expect(dependencies.generatedCount()).toBe(1);
  });
});
