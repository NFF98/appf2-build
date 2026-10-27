import { readProofTranscript } from "../../edge/create-proof.js";
import type { ExecutionAdmission } from "../../platform/blueprint/execution-admission.js";
import type { RuntimeAppDelivery } from "../../platform/runtime/runtime-operation.js";
import type { FetchLike } from "../create/f01-client.js";
import type { PopKeyring } from "../create/pop-keyring.js";

/** Why a validated Blueprint could not be delivered; the shell maps each to an F12-safe next action. */
export type DeliveryFailure = "KEY_UNAVAILABLE" | "NOT_FOUND" | "NOT_EXECUTABLE" | "TEMPORARILY_UNAVAILABLE" | "NETWORK" | "MALFORMED";

export type DeliveryResult = { readonly ok: true; readonly admitted: RuntimeAppDelivery } | { readonly ok: false; readonly failure: DeliveryFailure };

export interface AppDeliveryClient {
  deliver(intentId: string, contentHash: string): Promise<DeliveryResult>;
}

class DeliveryStop extends Error {
  public constructor(public readonly failure: DeliveryFailure) {
    super(failure);
  }
}

function statusFailure(status: number): DeliveryFailure {
  if (status === 404) return "NOT_FOUND";
  if (status === 502 || status === 503 || status === 504) return "TEMPORARILY_UNAVAILABLE";
  return status === 410 || status === 422 || status === 500 ? "NOT_EXECUTABLE" : "MALFORMED";
}

/** Transient GET-only retry: grants, Blueprint body and admission are read-only;
 * POST mutations are never replayed here. Do not retry 401/403/404, revoked or
 * non-executable responses; any last failure still fails closed. */
async function getOk(fetchImpl: FetchLike, path: string, headers: Record<string, string>): Promise<Response> {
  const init: RequestInit = { method: "GET", headers, credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(path, init);
    } catch {
      if (attempt === 3) throw new DeliveryStop("NETWORK");
      continue;
    }
    if (response.ok) return response;
    if (![502, 503, 504].includes(response.status) || attempt === 3) {
      throw new DeliveryStop(statusFailure(response.status));
    }
    await response.body?.cancel().catch(() => {});
  }
  throw new DeliveryStop("NETWORK");
}

async function dataOf(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DeliveryStop("MALFORMED");
  }
  const data = typeof payload === "object" && payload !== null ? (payload as { data?: unknown }).data : undefined;
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new DeliveryStop("MALFORMED");
  return data as Record<string, unknown>;
}

/** Shape check only; F03 H01–H02 still re-verifies freshness, hash, schema and pinned release identity. */
function readAdmission(data: Record<string, unknown>, contentHash: string): ExecutionAdmission {
  if (data.executable !== true || data.content_hash !== contentHash || typeof data.expires_at !== "string") throw new DeliveryStop("MALFORMED");
  return data as unknown as ExecutionAdmission;
}

/**
 * EXECUTION-ADMISSION §8.1 original-holder path: the intent's own PoP key signs a fresh read proof for a ≤60 s grant,
 * which stays in this closure only (never URL / storage / telemetry) and authorizes `/b` plus a fresh admission.
 */
export function createAppDeliveryClient(fetchImpl: FetchLike, keyring: PopKeyring): AppDeliveryClient {
  const deliver = async (intentId: string, contentHash: string): Promise<RuntimeAppDelivery> => {
    const key = keyring.keyForIntent(intentId) ?? await keyring.recoverForIntent(intentId);
    if (key === undefined) throw new DeliveryStop("KEY_UNAVAILABLE");
    const grantPath = `/api/v1/intents/${encodeURIComponent(intentId)}/blueprint-access-grant`;
    const proof = await key.proofHeaders((timestampMs) => readProofTranscript(grantPath, contentHash, timestampMs));
    const grant = (await dataOf(await getOk(fetchImpl, `${grantPath}?content_hash=${encodeURIComponent(contentHash)}`, proof)))
      .intent_blueprint_access_grant;
    if (typeof grant !== "string") throw new DeliveryStop("MALFORMED");
    const authorization = { Authorization: `Bearer ${grant}` };
    const bodyResponse = await getOk(fetchImpl, `/b/${contentHash}`, authorization);
    const body = await bodyResponse.text();
    const admission = readAdmission(
      await dataOf(await getOk(fetchImpl, `/api/v1/blueprints/${contentHash}/execution-admission`, authorization)),
      contentHash
    );
    return { admission, body };
  };
  return {
    deliver: async (intentId, contentHash) => {
      try {
        return { ok: true, admitted: await deliver(intentId, contentHash) };
      } catch (error: unknown) {
        return { ok: false, failure: error instanceof DeliveryStop ? error.failure : "NETWORK" };
      }
    }
  };
}
