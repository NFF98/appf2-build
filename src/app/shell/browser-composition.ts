import { createBrowserIdentityDependencies, ensureAnonymousId } from "../../platform/identity/browser-identity.js";
import { CreationController } from "../create/creation-controller.js";
import { createF01Client } from "../create/f01-client.js";

/** Browser wiring: same-origin F01 `/api/v1/intents`, F07 anonymous identity, Web Crypto idempotency keys. */
export function createBrowserCreationController(): CreationController {
  return new CreationController({
    client: createF01Client((input, init) => globalThis.fetch(input, init)),
    anonymousId: () => ensureAnonymousId(createBrowserIdentityDependencies()),
    newIdempotencyKey: () => globalThis.crypto.randomUUID()
  });
}
