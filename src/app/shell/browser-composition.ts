import { createBrowserIdentityDependencies, ensureAnonymousId } from "../../platform/identity/browser-identity.js";
import type { RuntimeAppHost } from "../../platform/runtime/runtime-operation.js";
import { CreationController } from "../create/creation-controller.js";
import { createF01Client } from "../create/f01-client.js";
import { PopKeyring } from "../create/pop-keyring.js";
import { createBrowserPopKeyPersistence } from "./tab-app-recovery.js";
import { findCapsule } from "../discover/capsules.js";
import { PromptDraftStore } from "../discover/prompt-draft-store.js";
import { createAppDeliveryClient } from "../runtime/app-delivery.js";
import { AppLauncher } from "../runtime/app-launcher.js";
import { createPublishedShareDeliveryClient } from "../runtime/app-delivery.js";

export interface BrowserComposition {
  readonly controller: CreationController;
  readonly launcher: AppLauncher;
}

const browserFetch = (input: string, init?: RequestInit): Promise<Response> => globalThis.fetch(input, init);

/** The slot the F03 page entry publishes its browser host in; the Shell never imports F03 code. */
const RUNTIME_APP_HOST_SLOT = Symbol.for("appf2.f03.runtime-app-host");

function registeredAppHost(): RuntimeAppHost | null {
  const host: unknown = Reflect.get(globalThis, RUNTIME_APP_HOST_SLOT);
  return typeof host === "object" && host !== null && typeof (host as Partial<RuntimeAppHost>).launch === "function" ? (host as RuntimeAppHost) : null;
}

/**
 * Browser wiring: same-origin F01 `/api/v1/intents`, F07 anonymous identity, Web Crypto idempotency keys, and the
 * secure Blueprint delivery path. One in-memory P-256 keyring signs CREATE / answers / compile and the content read,
 * so the Intent Continuity cookie is always paired with proof from the same browser key.
 */
export function createBrowserComposition(): BrowserComposition {
  const keyring = new PopKeyring({
    subtle: globalThis.crypto.subtle, now: () => Date.now(),
    persistence: createBrowserPopKeyPersistence()
  });
  const controller = new CreationController({
    client: createF01Client(browserFetch, keyring),
    anonymousId: () => ensureAnonymousId(createBrowserIdentityDependencies()),
    newIdempotencyKey: () => globalThis.crypto.randomUUID()
  });
  const launcher = new AppLauncher({ delivery: createAppDeliveryClient(browserFetch,keyring),published:createPublishedShareDeliveryClient(browserFetch),host:registeredAppHost() });
  return { controller, launcher };
}

/** F00 §26 prompt draft in first-party `localStorage`; reading the property itself may throw when storage is blocked. */
export function createBrowserPromptDraftStore(): PromptDraftStore {
  return new PromptDraftStore({
    storage: () => globalThis.localStorage,
    now: () => Date.now(),
    isKnownCapsule: (capsuleId) => findCapsule(capsuleId) !== undefined
  });
}
