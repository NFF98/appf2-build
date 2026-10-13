import { mutationProofTranscript, reservedCreateIdempotencyKey } from "../../edge/create-proof.js";
import {
  readCompileOutcome,
  readDecision,
  readFailure,
  type AnswerSubmissionRequest,
  type CompileOutcome,
  type CompileRequest,
  type CreateIntentRequest,
  type F01Result,
  type IntentDecision
} from "./f01-wire.js";
import type { PopKey, PopKeyring } from "./pop-keyring.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type F01Call = {
  readonly idempotencyKey: string;
  readonly signal?: AbortSignal;
};

/** Browser side of the existing F01 `/api/v1/intents` boundary; it adds no endpoint and no server state. */
export interface F01Client {
  createIntent(body: CreateIntentRequest, call: F01Call): Promise<F01Result<IntentDecision>>;
  submitAnswers(intentId: string, body: AnswerSubmissionRequest, call: F01Call): Promise<F01Result<IntentDecision>>;
  compile(intentId: string, body: CompileRequest, call: F01Call): Promise<F01Result<CompileOutcome>>;
}

export const INTENTS_PATH = "/api/v1/intents";

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

interface Signed {
  readonly key: PopKey;
  readonly idempotencyKey: string;
}

/** F01-API-ID-001A: the exact bytes sent are the bytes signed, with the Idempotency-Key actually sent. */
async function proofHeaders(path: string, body: string, signed: Signed | null): Promise<Record<string, string>> {
  if (signed === null) return {};
  const bytes = new TextEncoder().encode(body);
  return signed.key.proofHeaders((timestampMs) =>
    mutationProofTranscript({ method: "POST", path, body: bytes, idempotencyKey: signed.idempotencyKey }, timestampMs)
  );
}

interface PostRequest {
  readonly path: string;
  readonly body: unknown;
  readonly call: F01Call;
  readonly signed?: Signed | null;
}

async function post<T>(fetchImpl: FetchLike, { path, body, call, signed = null }: PostRequest, read: (data: unknown) => T | null): Promise<F01Result<T>> {
  let response: Response;
  try {
    const text = JSON.stringify(body);
    const idempotencyKey = signed?.idempotencyKey ?? call.idempotencyKey;
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey, ...(await proofHeaders(path, text, signed)) },
      body: text,
      credentials: "same-origin",
      ...(call.signal === undefined ? {} : { signal: call.signal })
    });
  } catch (error: unknown) {
    return { ok: false, failure: isAbort(error) ? { kind: "ABORTED" } : { kind: "NETWORK" } };
  }
  const payload = await readJson(response);
  if (!response.ok) return { ok: false, failure: readFailure(response.status, payload) };
  const data = typeof payload === "object" && payload !== null && "data" in payload ? read((payload as { data: unknown }).data) : null;
  return data === null ? { ok: false, failure: { kind: "MALFORMED_RESPONSE" } } : { ok: true, data };
}

/**
 * With a keyring, every F01 mutation carries a P-256 PoP: CREATE uses the reserved `appf2-create-v1.<thumbprint>` key
 * of its logical-operation key, answers / compile are signed by the key bound to that intent at CREATE.
 */
export function createF01Client(fetchImpl: FetchLike, keyring?: PopKeyring): F01Client {
  const scoped = (intentId: string, action: "answers" | "compile"): string => `${INTENTS_PATH}/${encodeURIComponent(intentId)}/${action}`;
  const intentSigner = (intentId: string, call: F01Call): Signed | null => {
    const key = keyring?.keyForIntent(intentId);
    return key === undefined ? null : { key, idempotencyKey: call.idempotencyKey };
  };
  return {
    createIntent: async (body, call) => {
      if (keyring === undefined) return post(fetchImpl, { path: INTENTS_PATH, body, call }, readDecision);
      let key: PopKey;
      try {
        key = await keyring.keyForCreate(call.idempotencyKey);
      } catch {
        return { ok: false, failure: { kind: "IDENTITY_UNAVAILABLE" } };
      }
      const signed = { key, idempotencyKey: reservedCreateIdempotencyKey(key.thumbprint) };
      const result = await post(fetchImpl, { path: INTENTS_PATH, body, call, signed }, readDecision);
      if (result.ok) keyring.bindIntent(call.idempotencyKey, result.data.intentId, key);
      return result;
    },
    submitAnswers: (intentId, body, call) =>
      post(fetchImpl, { path: scoped(intentId, "answers"), body, call, signed: intentSigner(intentId, call) }, readDecision),
    compile: (intentId, body, call) =>
      post(fetchImpl, { path: scoped(intentId, "compile"), body, call, signed: intentSigner(intentId, call) }, readCompileOutcome)
  };
}
