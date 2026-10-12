import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { createBrowserRuntime } from "../../src/platform/runtime/browser/browser-runtime.js";
import { encodeBase64Url, POP_KEY_HEADER, POP_SIGNATURE_HEADER, POP_TIMESTAMP_HEADER, readProofTranscript } from "../../src/edge/create-proof.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import type { ExecutionAdmission } from "../../src/platform/blueprint/execution-admission.js";
import { singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { evaluateResult } from "../../src/platform/runtime/result-evaluation.js";
import { adminUrl, ORIGIN, realPgHarness, type Session } from "./pg001-real-pg-harness.js";

/**
 * S03 delivery on a disposable loopback PostgreSQL (all migrations, PG-001 RLS, NOBYPASSRLS logins): production
 * Worker fetch + real `pg` executor for create / compile / grant / `/b` / admission, then a Node F03 Instance from
 * the production browser runtime factory (production handler catalog). Model = local deterministic fixture.
 */
const harness = realPgHarness("s03");
const send = createWorkerFetch();

async function readProof(session: Session, path: string, contentHash: string): Promise<Record<string, string>> {
  const timestamp = Date.now();
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, session.key.privateKey, readProofTranscript(path, contentHash, timestamp))
  );
  return { [POP_KEY_HEADER]: session.key.spki, [POP_SIGNATURE_HEADER]: encodeBase64Url(signature), [POP_TIMESTAMP_HEADER]: String(timestamp) };
}

const get = (path: string, headers: Record<string, string>): Promise<Response> =>
  send(new Request(`${ORIGIN}${path}`, { headers: { "Sec-Fetch-Site": "same-origin", ...headers } }), harness.env());

describe.skipIf(adminUrl === undefined)("S03 delivery on real PostgreSQL", () => {
  test("validated Blueprint is delivered to the original holder only, hydrates with production handlers and commits locally", async () => {
    const session = await harness.createIntent("幫我做一個聚餐分帳工具");
    const compiled = await harness.compile(session, "s03-compile-1");
    expect(compiled.status).toBe(200);
    const contentHash = compiled.hash as string;

    const grantPath = `/api/v1/intents/${session.intentId}/blueprint-access-grant`;
    const grantUrl = `${grantPath}?content_hash=${contentHash}`;
    const issued = await get(grantUrl, { Cookie: session.cookie, ...(await readProof(session, grantPath, contentHash)) });
    expect(issued.status).toBe(200);
    const token = ((await issued.json()) as { data: { intent_blueprint_access_grant: string } }).data.intent_blueprint_access_grant;

    const stranger = await harness.createIntent("另一個人的需求");
    const foreign = await get(grantUrl, { Cookie: stranger.cookie, ...(await readProof(stranger, grantPath, contentHash)) });
    expect(foreign.status).toBe(404);
    const strangerGrantPath = `/api/v1/intents/${stranger.intentId}/blueprint-access-grant`;
    const unowned = await get(`${strangerGrantPath}?content_hash=${contentHash}`, {
      Cookie: stranger.cookie,
      ...(await readProof(stranger, strangerGrantPath, contentHash))
    });
    expect(unowned.status).toBe(404);

    const bodyResponse = await get(`/b/${contentHash}`, { Authorization: `Bearer ${token}` });
    expect(bodyResponse.status).toBe(200);
    const body = await bodyResponse.text();
    expect(`sha256:${createHash("sha256").update(body, "utf8").digest("hex")}`).toBe(contentHash);
    const admissionResponse = await get(`/api/v1/blueprints/${contentHash}/execution-admission`, { Authorization: `Bearer ${token}` });
    expect(admissionResponse.status).toBe(200);
    const admission = ((await admissionResponse.json()) as { data: ExecutionAdmission }).data;
    expect(admission).toMatchObject({ executable: true, content_hash: contentHash, trust_status: "VALIDATED" });

    const runtime = createBrowserRuntime({ admission, body });
    await runtime.hydrate();
    expect(runtime.status).toBe("READY");
    const rowsBefore = await harness.sql<{ n: number }>("SELECT count(*)::int AS n FROM public.validation_run");
    expect(evaluateResult(runtime)?.outputs).toEqual([
      expect.objectContaining({ id: "per_person", label: "每人金額", status: "AVAILABLE", value: 30, sensitivity: "NORMAL" })
    ]);
    const receipt = runtime.dispatch({ source_node_instance_key: singletonKey("node_people"), event_name: "change", payload: { value: 6 }, origin: "USER" });
    expect(receipt.accepted).toBe(true);
    expect(runtime.readState("people")).toBe(6);
    expect(evaluateResult(runtime)?.outputs[0]).toMatchObject({ status: "AVAILABLE", value: 20 });
    expect(await harness.sql<{ n: number }>("SELECT count(*)::int AS n FROM public.validation_run")).toEqual(rowsBefore);
    runtime.dispose();
    console.info(JSON.stringify({ provenance: "REAL_DISPOSABLE_PG + DETERMINISTIC_MODEL_FIXTURE", content_hash: contentHash, per_person: [30, 20] }));
  });
});
