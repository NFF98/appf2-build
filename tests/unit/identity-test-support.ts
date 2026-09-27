import type {
  BrowserIdentityDependencies,
  IdentityStorage
} from "../../src/platform/identity/browser-identity.js";

export class MemoryIdentityStorage implements IdentityStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export function identityDependencies(
  ids: readonly string[],
  localStorage = new MemoryIdentityStorage(),
  sessionStorage = new MemoryIdentityStorage()
): BrowserIdentityDependencies & { readonly generatedCount: () => number } {
  let generatedCount = 0;
  return {
    localStorage,
    sessionStorage,
    randomUUID: () => {
      const id = ids[generatedCount];
      generatedCount += 1;
      if (id === undefined) {
        throw new Error("Test UUID source exhausted.");
      }
      return id;
    },
    generatedCount: () => generatedCount
  };
}
