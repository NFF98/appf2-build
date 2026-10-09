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

async function post<T>(fetchImpl: FetchLike, path: string, body: unknown, call: F01Call, read: (data: unknown) => T | null): Promise<F01Result<T>> {
  let response: Response;
  try {
    response = await fetchImpl(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": call.idempotencyKey },
      body: JSON.stringify(body),
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

export function createF01Client(fetchImpl: FetchLike): F01Client {
  const scoped = (intentId: string, action: "answers" | "compile"): string => `${INTENTS_PATH}/${encodeURIComponent(intentId)}/${action}`;
  return {
    createIntent: (body, call) => post(fetchImpl, INTENTS_PATH, body, call, readDecision),
    submitAnswers: (intentId, body, call) => post(fetchImpl, scoped(intentId, "answers"), body, call, readDecision),
    compile: (intentId, body, call) => post(fetchImpl, scoped(intentId, "compile"), body, call, readCompileOutcome)
  };
}
