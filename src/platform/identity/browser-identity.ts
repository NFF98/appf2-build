import type { AnonymousId, SessionId } from "./identity-types.js";

export const ANONYMOUS_ID_STORAGE_KEY = "appf2.anonymous_id.v1";
export const SESSION_ID_STORAGE_KEY = "appf2.session_id.v1";

export interface IdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserIdentityDependencies {
  readonly localStorage: IdentityStorage;
  readonly sessionStorage: IdentityStorage;
  readonly randomUUID: () => string;
}

export class IdentityGenerationError extends Error {
  readonly code = "INVALID_RANDOM_UUID";

  constructor() {
    super("The identity UUID source did not return a valid UUID v4.");
    this.name = "IdentityGenerationError";
  }
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRandomIdentityId(value: string): boolean {
  return UUID_V4_PATTERN.test(value);
}

function generateId(randomUUID: () => string): string {
  const id = randomUUID();
  if (!isRandomIdentityId(id)) {
    throw new IdentityGenerationError();
  }
  return id;
}

function ensureStoredId(
  storage: IdentityStorage,
  key: string,
  randomUUID: () => string
): string {
  const storedId = storage.getItem(key);
  if (storedId !== null && isRandomIdentityId(storedId)) {
    return storedId;
  }
  if (storedId !== null) {
    storage.removeItem(key);
  }
  const newId = generateId(randomUUID);
  storage.setItem(key, newId);
  return newId;
}

export function ensureAnonymousId(
  dependencies: BrowserIdentityDependencies
): AnonymousId {
  return ensureStoredId(
    dependencies.localStorage,
    ANONYMOUS_ID_STORAGE_KEY,
    dependencies.randomUUID
  ) as AnonymousId;
}

export function ensureSessionId(
  dependencies: BrowserIdentityDependencies
): SessionId {
  return ensureStoredId(
    dependencies.sessionStorage,
    SESSION_ID_STORAGE_KEY,
    dependencies.randomUUID
  ) as SessionId;
}

export function createBrowserIdentityDependencies(): BrowserIdentityDependencies {
  return {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    randomUUID: () => globalThis.crypto.randomUUID()
  };
}
