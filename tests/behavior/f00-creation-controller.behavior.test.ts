import { describe, expect, test } from "vitest";

import { CreationController } from "../../src/app/create/creation-controller.js";
import type { CreationSession } from "../../src/app/create/creation-session.js";
import { createF01Client, type FetchLike } from "../../src/app/create/f01-client.js";
import type { StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { ANON, blueprintCandidate, clarifyingAnalysis, createF01Harness, failedWith, readyAnalysis, succeeded, type F01Harness } from "../api/f01-harness.js";

type Sent = { readonly path: string; readonly key: string; readonly body: Record<string, unknown> };

type Rig = {
  readonly harness: F01Harness;
  readonly controller: CreationController;
  readonly sent: Sent[];
  /** Makes the next N fetches fail at the network layer before reaching F01. */
  dropNext(count: number): void;
};

function rig(options: { readonly anonymousId?: () => string } = {}): Rig {
  const harness = createF01Harness();
  const sent: Sent[] = [];
  let drops = 0;
  let keySeq = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    const headers = init.headers as Record<string, string>;
    sent.push({ path: input, key: headers["Idempotency-Key"] ?? "", body: JSON.parse(String(init.body)) as Record<string, unknown> });
    if (drops > 0) {
      drops -= 1;
      throw new TypeError("network down");
    }
    const aborted = new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    aborted.catch(() => undefined);
    const response = await Promise.race([harness.handler({ method: "POST", path: input, headers, body: String(init.body), trustedAnonymousId: ANON }), aborted]);
    if (response === undefined) throw new Error(`unrouted ${input}`);
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { "content-type": "application/json" } });
  };
  const controller = new CreationController({
    client: createF01Client(fetchImpl),
    anonymousId: options.anonymousId ?? (() => ANON),
    newIdempotencyKey: () => `key-${++keySeq}`
  });
  return { harness, controller, sent, dropNext: (count) => (drops = count) };
}

const asJson = (envelope: StructuredIntentEnvelope): JsonValue => envelope as unknown as JsonValue;

/** Resolves once the controller is idle in a phase that waits for the User or reports an outcome. */
function settled(controller: CreationController): Promise<CreationSession> {
  return new Promise((resolve) => {
    const check = (): void => {
      const session = controller.getSnapshot();
      if (session === null || session.busy) return;
      unsubscribe();
      resolve(session);
    };
    const unsubscribe = controller.subscribe(check);
    check();
  });
}

describe("F00 creation controller: request guarding, fast path and retries over the production F01 handler", () => {
  test("blank prompts and in-flight duplicates never send a second create", async () => {
    const { controller, harness, sent } = rig();
    expect(controller.start("   ", null)).toBe("IGNORED");
    expect(controller.getSnapshot()).toBeNull();

    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    expect(controller.start("幫我做分帳工具", null)).toBe("STARTED");
    expect(controller.start("幫我做分帳工具", null)).toBe("IGNORED");
    expect(controller.start("另一個想法", null)).toBe("IGNORED");
    const session = await settled(controller);
    expect(session.phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(sent).toHaveLength(1);
  });

  test("the fast path compiles without waiting for the User and never publishes a decision phase", async () => {
    const { controller, harness, sent } = rig();
    const phases: string[] = [];
    controller.subscribe(() => phases.push(controller.getSnapshot()?.phase.kind ?? "NONE"));
    harness.gateway.queueAnalysis(succeeded(asJson(readyAnalysis())));
    harness.gateway.queueCompose(succeeded(blueprintCandidate()));
    controller.start("幫我做分帳工具", null);
    const session = await settled(controller);

    expect(session.phase).toMatchObject({ kind: "BUILD_VALIDATED" });
    expect(new Set(phases)).toEqual(new Set(["ANALYZING", "BUILDING", "BUILD_VALIDATED"]));
    expect(sent.map((call) => call.path.split("/").at(-1))).toEqual(["intents", "compile"]);
    expect(sent[0]?.key).not.toBe(sent[1]?.key);
  });

  test("a dropped request keeps the input and Retry resends the identical payload with the same key", async () => {
    const { controller, harness, sent, dropNext } = rig();
    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    dropNext(1);
    controller.start("幫我做分帳工具", null);
    const failed = await settled(controller);
    expect(failed.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", canRetry: true });
    expect(failed.rawIntent).toBe("幫我做分帳工具");

    controller.retry();
    const recovered = await settled(controller);
    expect(recovered.phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
  });

  test("a provider failure on compile is retryable and the retry stays one logical operation", async () => {
    const { controller, harness, sent } = rig();
    harness.gateway.queueAnalysis(succeeded(asJson(readyAnalysis())));
    harness.gateway.queueCompose(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    controller.start("幫我做分帳工具", null);
    const failed = await settled(controller);
    expect(failed.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", canRetry: true, step: { kind: "COMPILE" } });

    harness.clock.advance(1_000);
    harness.gateway.queueCompose(succeeded(blueprintCandidate()));
    controller.retry();
    expect((await settled(controller)).phase.kind).toBe("BUILD_VALIDATED");
    const compiles = sent.filter((call) => call.path.endsWith("/compile"));
    expect(compiles).toHaveLength(2);
    expect(compiles[1]?.key).toBe(compiles[0]?.key);
  });
});

describe("F00 creation controller: User input, identity and resume", () => {
  test("local required / type problems block the request; valid answers go to F01 with the trusted version", async () => {
    const { controller, harness, sent } = rig();
    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    controller.start("幫我做分帳工具", null);
    const asking = await settled(controller);
    const question = asking.decision?.questions[0];
    if (question === undefined) throw new Error("expected one F01 question");

    controller.submitDecisions();
    expect(controller.getSnapshot()?.problems).toEqual({ [question.question_id]: "REQUIRED" });
    controller.updateAnswer(question.question_id, { kind: "TEXT", text: "十個" });
    controller.submitDecisions();
    expect(controller.getSnapshot()?.problems).toEqual({ [question.question_id]: "TYPE_MISMATCH" });
    expect(sent).toHaveLength(1);

    harness.gateway.queueCompose(succeeded(blueprintCandidate()));
    controller.updateAnswer(question.question_id, { kind: "TEXT", text: " 12 " });
    controller.submitDecisions();
    const done = await settled(controller);
    expect(done.phase.kind).toBe("BUILD_VALIDATED");
    expect(sent[1]?.body).toEqual({ answers: [{ question_id: question.question_id, value: 12 }], assumption_decisions: [], intent_version: asking.decision?.intentVersion });
    expect(done.provided).toEqual([{ questionId: question.question_id, prompt: question.prompt, value: 12 }]);
  });

  test("an unavailable Browser identity fails recoverably without sending anything", async () => {
    const { controller, sent } = rig({
      anonymousId: () => {
        throw new Error("storage blocked");
      }
    });
    controller.start("幫我做分帳工具", null);
    const session = await settled(controller);
    expect(session.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", canRetry: true });
    expect(sent).toEqual([]);
  });

  test("leaving while waiting interrupts locally and the same prompt resumes with the same Idempotency-Key", async () => {
    const { controller, harness, sent } = rig();
    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    controller.start("幫我做分帳工具", null);
    controller.leave();
    expect((await settled(controller)).phase.kind).toBe("INTERRUPTED");

    expect(controller.start("幫我做分帳工具", null)).toBe("RESUMED");
    const racing = await settled(controller);
    expect(racing.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", canRetry: true });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.retry();
    const resumed = await settled(controller);
    expect(resumed.phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(sent).toHaveLength(3);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[2]).toEqual(sent[0]);
    expect(harness.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
    expect(harness.gateway.unscriptedCalls).toBe(0);
  });

  test("editing the intent is a new logical create; returning with the same prompt resumes the open operation", async () => {
    const { controller, harness, sent } = rig();
    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    controller.start("幫我做分帳工具", "dinner-split");
    await settled(controller);
    expect(sent[0]?.body).not.toHaveProperty("source");

    harness.gateway.queueAnalysis(succeeded(asJson(clarifyingAnalysis())));
    controller.editIntent("幫我做分帳工具，要含服務費");
    const edited = await settled(controller);
    expect(edited.rawIntent).toBe("幫我做分帳工具，要含服務費");
    expect(sent[1]?.key).not.toBe(sent[0]?.key);
    expect(sent[1]?.body.raw_intent).toBe("幫我做分帳工具，要含服務費");

    controller.leave();
    expect(controller.start("幫我做分帳工具，要含服務費", "dinner-split")).toBe("RESUMED");
    expect(controller.getSnapshot()?.phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(sent).toHaveLength(2);
  });
});
