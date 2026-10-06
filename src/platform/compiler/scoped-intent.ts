import { isUuid } from "../evidence/evidence-validator.js";
import { invalidRequest } from "../intent/request-boundary.js";
import type { IntentRecord } from "./compiler-records.js";
import { IntentApiError } from "./f01-errors.js";
import type { ResolvedServiceDependencies } from "./intent-operation.js";

export type ScopedIntentCommand = {
  readonly intentId: string;
  readonly body: unknown;
  readonly idempotencyKey: string;
  /** F01-API-ID-001: answers / compile identity comes only from the server-owned trusted request context. */
  readonly trustedAnonymousId: string | null;
};

export type ScopedIntent = {
  readonly anonymousId: string;
  /** The ownership-check read; pre-claim request validation only, every attempt still reloads. */
  readonly initial: IntentRecord;
  readonly reload: () => Promise<IntentRecord>;
};

/** Missing and foreign intents are the same 404 / F01-ERR-015 with empty details (no ownership disclosure). */
const notFound = (): IntentApiError => new IntentApiError("F01-ERR-015");

export async function requireScopedIntent(dependencies: ResolvedServiceDependencies, command: ScopedIntentCommand): Promise<ScopedIntent> {
  const anonymousId = command.trustedAnonymousId;
  if (anonymousId === null || !isUuid(anonymousId)) invalidRequest([{ path: "$context.anonymous_id", reason: "TRUSTED_IDENTITY_REQUIRED" }]);
  if (!isUuid(command.intentId)) throw notFound();
  const reload = async (): Promise<IntentRecord> => {
    const record = await dependencies.intents.findScopedIntent(command.intentId, anonymousId);
    if (record === undefined) throw notFound();
    return record;
  };
  return { anonymousId, initial: await reload(), reload };
}
