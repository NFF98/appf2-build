import { describe, expect, test } from "vitest";

import { CreationController } from "../../src/app/create/creation-controller.js";
import type { CreationSession } from "../../src/app/create/creation-session.js";
import { createF01Client, type F01Call, type F01Client } from "../../src/app/create/f01-client.js";
import { readDecision, type CompileOutcome, type F01Failure, type F01Result, type IntentDecision } from "../../src/app/create/f01-wire.js";
import { OPEN_JSON_RECORD_V1 } from "../../src/platform/intent/visible-assumptions.js";

const ANONYMOUS_ID = "anon-behavior";

type Outcome = F01Result<IntentDecision | CompileOutcome>;
type Scripted = Outcome | ((call: F01Call) => Promise<Outcome>);
type RecordedCall = { readonly operation: "create" | "answers" | "compile"; readonly body: unknown; readonly key: string };

/** F01 client double: records every request and replies from a script, in order. */
class ScriptedClient implements F01Client {
  public readonly calls: RecordedCall[] = [];
  private readonly script: Scripted[] = [];

  public reply(...outcomes: Scripted[]): this {
    this.script.push(...outcomes);
    return this;
  }

  public createIntent(body: unknown, call: F01Call): Promise<F01Result<IntentDecision>> {
    return this.next("create", body, call) as Promise<F01Result<IntentDecision>>;
  }

  public submitAnswers(_intentId: string, body: unknown, call: F01Call): Promise<F01Result<IntentDecision>> {
    return this.next("answers", body, call) as Promise<F01Result<IntentDecision>>;
  }

  public compile(_intentId: string, body: unknown, call: F01Call): Promise<F01Result<CompileOutcome>> {
    return this.next("compile", body, call) as Promise<F01Result<CompileOutcome>>;
  }

  private next(operation: RecordedCall["operation"], body: unknown, call: F01Call): Promise<Outcome> {
    this.calls.push({ operation, body, key: call.idempotencyKey });
    const scripted = this.script.shift();
    if (scripted === undefined) throw new Error(`unscripted ${operation} request`);
    return typeof scripted === "function" ? scripted(call) : Promise.resolve(scripted);
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function controllerWith(client: F01Client, anonymousId: () => string = () => ANONYMOUS_ID): CreationController {
  let sequence = 0;
  return new CreationController({ client, anonymousId, newIdempotencyKey: () => `key-${++sequence}` });
}

function snapshot(controller: CreationController): CreationSession {
  const session = controller.getSnapshot();
  if (session === null) throw new Error("a creation session must exist");
  return session;
}

const question = (id: string, target: string, fields: Record<string, unknown>) => ({
  question_id: id,
  prompt: `問題 ${id}`,
  required: true,
  semantic_item_ids: [target],
  ...fields
});

const proposal = (id: string, value: unknown, fields: Record<string, unknown>) => ({
  assumption_id: id,
  classification: "PROPOSAL",
  description: `設定 ${id}`,
  proposed_default: value,
  ...fields
});

const NUMBER_FIELDS = { question_type: "NUMBER", expected_value_type: "NUMBER" };
const STRING_FIELDS = { question_type: "FREE_TEXT", expected_value_type: "STRING" };
const enumFields = (options: unknown[]) => ({ question_type: "SINGLE_CHOICE", expected_value_type: "ENUM", options });

function decision(status: string, questions: unknown[], assumptions: unknown[], version = 1): Outcome {
  const data = readDecision({ intent_id: "intent-1", intent_version: version, status, questions, visible_assumptions: assumptions });
  if (data === null) throw new Error("fixture decision must satisfy the F01 contract");
  return { ok: true, data };
}

const READY = decision("READY", [], []);
const VALIDATED: Outcome = { ok: true, data: { intentId: "intent-1", contentHash: "sha256:fixture" } };
const failure = (value: F01Failure): Outcome => ({ ok: false, failure: value });
const apiFailure = (code: string, retryable: boolean, violations: { path: string; reason: string }[] = []): Outcome =>
  failure({ kind: "API", code, retryable, httpStatus: retryable ? 502 : 409, violations });

describe("F00 creation controller over the F01 client boundary", () => {
  test("a retryable failure repeats the identical request with the same key and each new logical operation gets a new key", async () => {
    const client = new ScriptedClient().reply(failure({ kind: "NETWORK" }), decision("NEEDS_CLARIFICATION", [question("q1", "t1", NUMBER_FIELDS)], []), READY, VALIDATED);
    const controller = controllerWith(client);
    expect(controller.start("幫我做分帳", null)).toBe("STARTED");
    await flush();
    expect(snapshot(controller).phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "RETRYABLE" });

    controller.retry();
    await flush();
    const [first, second] = client.calls;
    expect(second).toEqual(first);
    expect(first?.body).toEqual({ anonymous_id: ANONYMOUS_ID, intent_kind: "CREATE", raw_intent: "幫我做分帳", source: { type: "DIRECT_PROMPT", capsule_id: null } });
    expect(snapshot(controller).phase.kind).toBe("CLARIFICATION_REQUIRED");

    controller.updateAnswer("q1", { kind: "TEXT", text: "8" });
    controller.submitDecisions();
    await flush();
    expect(client.calls.map((call) => [call.operation, call.key])).toEqual([
      ["create", "key-1"],
      ["create", "key-1"],
      ["answers", "key-2"],
      ["compile", "key-3"]
    ]);
    expect(client.calls[2]?.body).toEqual({ answers: [{ question_id: "q1", value: 8 }], assumption_decisions: [], intent_version: 1 });
    expect(snapshot(controller).phase).toEqual({ kind: "BUILD_VALIDATED", contentHash: "sha256:fixture" });
    expect(snapshot(controller).provided).toEqual([{ key: "q1", label: "問題 q1", value: 8 }]);
  });

  test("a capsule origin is never sent as a User source and blank or concurrent starts are ignored", async () => {
    const client = new ScriptedClient().reply(READY, VALIDATED);
    const controller = controllerWith(client);
    expect(controller.start("   ", null)).toBe("IGNORED");
    expect(controller.start("做旅遊行程", "capsule-travel")).toBe("STARTED");
    expect(controller.start("另一個想法", null)).toBe("IGNORED");
    await flush();
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.body).toEqual({ anonymous_id: ANONYMOUS_ID, intent_kind: "CREATE", raw_intent: "做旅遊行程" });
    expect(snapshot(controller).capsuleId).toBe("capsule-travel");
  });

  test("local validation blocks submission and F01 rejected targets map back to the item F01 named", async () => {
    const pending = proposal("a1", "TWD", STRING_FIELDS);
    const client = new ScriptedClient().reply(
      decision("NEEDS_CLARIFICATION", [question("q1", "t1", NUMBER_FIELDS)], [pending]),
      apiFailure("F01-ERR-003", false, [{ path: "$.assumption_decisions[0].edited_value", reason: "TYPE" }])
    );
    const controller = controllerWith(client);
    controller.start("幫我做分帳", null);
    await flush();

    controller.updateAnswer("q1", { kind: "TEXT", text: "abc" });
    controller.submitDecisions();
    expect(snapshot(controller).problems).toEqual({ q1: "TYPE_MISMATCH" });
    expect(client.calls).toHaveLength(1);

    controller.updateAnswer("q1", { kind: "TEXT", text: "3" });
    expect(snapshot(controller).problems).toEqual({});
    controller.updateAssumption("a1", { decision: "EDIT", value: { kind: "TEXT", text: "USD" } });
    controller.submitDecisions();
    await flush();
    expect(client.calls[1]?.body).toEqual({
      answers: [{ question_id: "q1", value: 3 }],
      assumption_decisions: [{ assumption_id: "a1", decision: "EDIT", edited_value: "USD" }],
      intent_version: 1
    });
    expect(snapshot(controller).phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(snapshot(controller).problems).toEqual({ a1: "SERVER_REJECTED" });
    expect(snapshot(controller).assumptionDrafts.a1).toEqual({ decision: "EDIT", value: { kind: "TEXT", text: "USD" } });
  });
});

describe("F00 creation controller decisions and recovery", () => {
  test("a question target is resolved only by its answer and undecided items are accepted only on review", async () => {
    const asked = proposal("a_target", 4, NUMBER_FIELDS);
    const other = proposal("a_other", "TWD", STRING_FIELDS);
    const client = new ScriptedClient().reply(
      decision("NEEDS_CLARIFICATION", [question("q1", "a_target", NUMBER_FIELDS)], [asked, other]),
      decision("READY_WITH_VISIBLE_ASSUMPTIONS", [], [other], 2),
      READY,
      VALIDATED
    );
    const controller = controllerWith(client);
    controller.start("幫我做分帳", null);
    await flush();

    controller.updateAssumption("a_target", { decision: "ACCEPT" });
    controller.updateAnswer("q1", { kind: "TEXT", text: "6" });
    controller.submitDecisions();
    await flush();
    expect(client.calls[1]?.body).toEqual({ answers: [{ question_id: "q1", value: 6 }], assumption_decisions: [], intent_version: 1 });
    expect(snapshot(controller).phase.kind).toBe("ASSUMPTION_REVIEW");

    controller.submitDecisions();
    await flush();
    expect(client.calls[2]?.body).toEqual({ answers: [], assumption_decisions: [{ assumption_id: "a_other", decision: "ACCEPT" }], intent_version: 2 });
    expect(snapshot(controller).phase.kind).toBe("BUILD_VALIDATED");
  });

  test("a stale version offers no same key retry and reanalysis keeps only drafts whose projected shape is unchanged", async () => {
    const review = (options: unknown[]) =>
      decision("READY_WITH_VISIBLE_ASSUMPTIONS", [], [proposal("a_count", 4, NUMBER_FIELDS), proposal("a_mode", 1, enumFields(options))]);
    const client = new ScriptedClient().reply(review([1, 2]), apiFailure("F01-ERR-004", false), review([1, 3]));
    const controller = controllerWith(client);
    controller.start("幫我做分帳", null);
    await flush();

    controller.updateAssumption("a_count", { decision: "EDIT", value: { kind: "TEXT", text: "5" } });
    controller.updateAssumption("a_mode", { decision: "REJECT" });
    controller.submitDecisions();
    await flush();
    expect(snapshot(controller).phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "STALE_VERSION" });
    controller.retry();
    controller.reviseRound();
    await flush();
    expect(client.calls).toHaveLength(2);

    controller.reanalyze();
    await flush();
    expect(client.calls.map((call) => [call.operation, call.key])).toEqual([
      ["create", "key-1"],
      ["answers", "key-2"],
      ["create", "key-3"]
    ]);
    expect(snapshot(controller).phase.kind).toBe("ASSUMPTION_REVIEW");
    expect(snapshot(controller).assumptionDrafts).toEqual({ a_count: { decision: "EDIT", value: { kind: "TEXT", text: "5" } } });
  });

  test("recovery reasons follow the F01 retry instruction for every failure kind", async () => {
    const cases: [Outcome, string][] = [
      [apiFailure("F01-ERR-006", true), "RETRYABLE"],
      [apiFailure("F01-ERR-015", false), "NOT_FOUND"],
      [apiFailure("F01-ERR-009", false), "REJECTED"],
      [failure({ kind: "MALFORMED_RESPONSE" }), "MALFORMED"],
      [failure({ kind: "NETWORK" }), "RETRYABLE"]
    ];
    for (const [outcome, reason] of cases) {
      const controller = controllerWith(new ScriptedClient().reply(outcome));
      controller.start("幫我做分帳", null);
      await flush();
      expect(snapshot(controller).phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason });
    }
  });

  test("unavailable Browser identity fails retryably without sending a create request", async () => {
    const client = new ScriptedClient();
    const controller = controllerWith(client, () => {
      throw new Error("storage blocked");
    });
    controller.start("幫我做分帳", null);
    await flush();
    expect(client.calls).toEqual([]);
    expect(snapshot(controller).phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "RETRYABLE" });
  });

  test("leaving while waiting keeps the logical operation open so the same prompt resumes it with the same key", async () => {
    const abortable = (call: F01Call): Promise<Outcome> =>
      new Promise((resolve) => call.signal?.addEventListener("abort", () => resolve(failure({ kind: "ABORTED" }))));
    const client = new ScriptedClient().reply(abortable, READY, VALIDATED);
    const controller = controllerWith(client);
    controller.start("幫我做分帳", null);
    controller.leave();
    await flush();
    expect(snapshot(controller).phase.kind).toBe("INTERRUPTED");

    expect(controller.start("幫我做分帳", null)).toBe("RESUMED");
    await flush();
    expect(client.calls.map((call) => call.key)).toEqual(["key-1", "key-1", "key-2"]);
    expect(snapshot(controller).phase.kind).toBe("BUILD_VALIDATED");
  });
});

describe("F00 Browser F01 client", () => {
  type Sent = { readonly path: string; readonly init: RequestInit };

  function clientReplying(reply: () => Promise<Response>): { client: F01Client; sent: Sent[] } {
    const sent: Sent[] = [];
    const client = createF01Client((path, init) => {
      sent.push({ path, init });
      return reply();
    });
    return { client, sent };
  }

  const json = (status: number, body: unknown): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }));

  test("requests carry the Idempotency-Key and a scoped path and contract violations fail closed", async () => {
    const malformed = clientReplying(() => json(200, { data: { intent_id: "intent-1", intent_version: 1, status: "MAYBE", questions: [], visible_assumptions: [] } }));
    const result = await malformed.client.submitAnswers("intent/1", { answers: [], assumption_decisions: [], intent_version: 1 }, { idempotencyKey: "key-a" });
    expect(result).toEqual({ ok: false, failure: { kind: "MALFORMED_RESPONSE" } });
    expect(malformed.sent[0]?.path).toBe("/api/v1/intents/intent%2F1/answers");
    expect(malformed.sent[0]?.init.headers).toMatchObject({ "Idempotency-Key": "key-a" });

    const envelope = clientReplying(() => json(409, { error: { code: "F01-ERR-004", retryable: false, details: { violations: [{ path: "$.intent_version", reason: "STALE" }, { path: 3 }] } } }));
    expect(await envelope.client.compile("intent-1", { intent_version: 1 }, { idempotencyKey: "key-b" })).toEqual({
      ok: false,
      failure: { kind: "API", code: "F01-ERR-004", retryable: false, httpStatus: 409, violations: [{ path: "$.intent_version", reason: "STALE" }] }
    });

    const opaque = clientReplying(() => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 })));
    expect(await opaque.client.compile("intent-1", { intent_version: 1 }, { idempotencyKey: "key-c" })).toEqual({ ok: false, failure: { kind: "MALFORMED_RESPONSE" } });
  });

  test("network failures and aborts are distinguished and a valid record shape is read as projected", async () => {
    const offline = clientReplying(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await offline.client.compile("intent-1", { intent_version: 1 }, { idempotencyKey: "key-a" })).toEqual({ ok: false, failure: { kind: "NETWORK" } });
    const aborted = clientReplying(() => Promise.reject(new DOMException("aborted", "AbortError")));
    expect(await aborted.client.compile("intent-1", { intent_version: 1 }, { idempotencyKey: "key-b" })).toEqual({ ok: false, failure: { kind: "ABORTED" } });

    const menu = { ...proposal("a_menu", { main: "火鍋" }, { question_type: "STRUCTURED_FIELDS", expected_value_type: "RECORD" }), record_edit_schema: OPEN_JSON_RECORD_V1 };
    const valid = clientReplying(() => json(201, { data: { intent_id: "intent-1", intent_version: 1, status: "READY_WITH_VISIBLE_ASSUMPTIONS", questions: [], visible_assumptions: [menu] } }));
    const result = await valid.client.createIntent({ anonymous_id: ANONYMOUS_ID, intent_kind: "CREATE", raw_intent: "菜單" }, { idempotencyKey: "key-c" });
    expect(result.ok && result.data.assumptions[0]?.shape).toEqual({ valueType: "RECORD" });
  });
});
