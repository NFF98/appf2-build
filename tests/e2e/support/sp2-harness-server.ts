import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { validateBlueprintCandidate } from "../../../src/platform/blueprint/validate-blueprint.js";
import { evaluateClarificationPolicy } from "../../../src/platform/intent/clarification-policy.js";
import { IntentContractError } from "../../../src/platform/intent/intent-contract.js";
import { startIntentClarification } from "../../../src/platform/intent/intent-state.js";

/**
 * Test-only SP2 verification server. It forwards browser requests to the production F01 / F02 modules
 * and returns their results unchanged; it owns no Product logic of its own.
 */
const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 1_048_576;

export type Sp2Harness = {
  readonly url: string;
  close(): Promise<void>;
};

type ProductionRoute = (body: Uint8Array) => unknown;

class HarnessRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) throw new HarnessRequestError(413, "HARNESS_BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function parseJson(body: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HarnessRequestError(400, "HARNESS_INVALID_JSON");
  }
}

const productionRoutes: ReadonlyMap<string, ProductionRoute> = new Map<string, ProductionRoute>([
  /** F01: untrusted Prompt A analysis → server-owned trusted state → deterministic Clarification Policy. */
  ["/api/f01/clarification", (body) => evaluateClarificationPolicy(startIntentClarification(parseJson(body)))],
  /** F02: exact candidate payload bytes → production validation result (report + admissible Blueprint). */
  ["/api/f02/validation", (body) => validateBlueprintCandidate(body)]
]);

function send(response: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function errorReply(error: unknown): { readonly status: number; readonly body: unknown } {
  if (error instanceof HarnessRequestError) return { status: error.status, body: { error: { code: error.code } } };
  if (error instanceof IntentContractError) {
    return { status: 422, body: { error: { code: error.code, violations: error.violations } } };
  }
  console.error(error);
  return { status: 500, body: { error: { code: "HARNESS_UNEXPECTED_ERROR" } } };
}

async function handle(request: IncomingMessage, response: ServerResponse, page: Buffer): Promise<void> {
  const { pathname } = new URL(request.url ?? "/", `http://${HOST}`);
  if (request.method === "GET" && pathname === "/") return send(response, 200, "text/html; charset=utf-8", page);
  const route = productionRoutes.get(pathname);
  if (request.method !== "POST" || route === undefined) return sendJson(response, 404, { error: { code: "HARNESS_NOT_FOUND" } });
  try {
    sendJson(response, 200, route(await readBody(request)));
  } catch (error: unknown) {
    const { status, body } = errorReply(error);
    sendJson(response, status, body);
  }
}

/** Starts an isolated harness on an ephemeral loopback port so parallel Playwright workers never collide. */
export async function startSp2Harness(): Promise<Sp2Harness> {
  const page = await readFile(new URL("./sp2-harness.html", import.meta.url));
  const server = createServer((request, response) => {
    void handle(request, response, page);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${HOST}:${port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
