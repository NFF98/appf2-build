import { describe, expect, test } from "vitest";

import { clarifyingAnalysis, readyAnalysis } from "../api/f01-harness.js";
import { InProcessF01, isAnswers, isCompile, isCreate } from "./support/in-process-f01.js";

const PROMPT = "幫我做一個公司聚餐分帳工具";

describe("F00 duplicate submit guard over the real F01 API", () => {
  test("TEST-F00-019 repeated taps, submits and retries never create or compile a second logical operation", async () => {
    // Create: repeated taps while the create is in flight are ignored; one Intent, one compile.
    const f01 = new InProcessF01();
    f01.queueAnalysis(readyAnalysis()).queueValidBlueprint();
    const releaseCreate = f01.holdNext(isCreate);
    const releaseCompile = f01.holdNext(isCompile);
    expect([f01.controller.start(PROMPT, null), f01.controller.start(PROMPT, null), f01.controller.start(PROMPT, null)]).toEqual(["STARTED", "IGNORED", "IGNORED"]);
    f01.controller.retry();
    f01.controller.reanalyze();
    releaseCreate();
    await expect.poll(() => f01.session().phase.kind).toBe("BUILDING");
    expect(f01.controller.start(PROMPT, null)).toBe("IGNORED");
    f01.controller.retry();
    releaseCompile();
    expect((await f01.settle()).phase.kind).toBe("BUILD_VALIDATED");
    expect(f01.controller.start(PROMPT, null)).toBe("RESUMED");
    f01.controller.retry();
    await f01.settle();
    expect(f01.calls.map((call) => [call.path.split("/").at(-1), call.status])).toEqual([
      ["intents", 200],
      ["compile", 200]
    ]);
    expect(f01.harness.db.intents.size).toBe(1);
    expect(f01.harness.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
    expect(f01.harness.gateway.calls("BLUEPRINT_COMPOSE")).toHaveLength(1);

    // Answers: a double-click on 「繼續」 while the answers request is in flight sends one request.
    const clarify = new InProcessF01();
    clarify.queueAnalysis(clarifyingAnalysis()).queueValidBlueprint();
    clarify.controller.start(PROMPT, null);
    const round = await clarify.settle();
    clarify.controller.updateAnswer(round.decision?.questions[0]?.questionId ?? "", { kind: "TEXT", text: "8" });
    const releaseAnswers = clarify.holdNext(isAnswers);
    clarify.controller.submitDecisions();
    clarify.controller.submitDecisions();
    clarify.controller.submitDecisions();
    releaseAnswers();
    expect((await clarify.settle()).phase.kind).toBe("BUILD_VALIDATED");
    expect(clarify.callsTo("/answers")).toHaveLength(1);
    expect(clarify.callsTo("/compile")).toHaveLength(1);

    // Retry after a lost create: the identical request with the same Idempotency-Key reaches F01 once.
    const lost = new InProcessF01();
    lost.queueAnalysis(readyAnalysis()).queueValidBlueprint();
    lost.dropNext(isCreate);
    lost.controller.start(PROMPT, null);
    const failed = await lost.settle();
    expect(failed.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "RETRYABLE" });
    lost.controller.retry();
    lost.controller.retry();
    expect(lost.controller.start(PROMPT, null)).toBe("IGNORED");
    expect((await lost.settle()).phase.kind).toBe("BUILD_VALIDATED");
    const creates = lost.callsTo("/api/v1/intents");
    expect(creates.map((call) => call.status)).toEqual([null, 200]);
    expect(creates[1]?.idempotencyKey).toBe(creates[0]?.idempotencyKey);
    expect(creates[1]?.body).toBe(creates[0]?.body);
    expect(lost.harness.db.intents.size).toBe(1);

    // Leaving while waiting and coming back resumes the same open logical operation instead of duplicating it.
    const left = new InProcessF01();
    left.queueAnalysis(readyAnalysis()).queueValidBlueprint();
    const releaseLeft = left.holdNext(isCreate);
    left.controller.start(PROMPT, null);
    left.controller.leave();
    releaseLeft();
    expect((await left.settle()).phase.kind).toBe("INTERRUPTED");
    expect(left.controller.start(PROMPT, null)).toBe("RESUMED");
    expect((await left.settle()).phase.kind).toBe("BUILD_VALIDATED");
    const leftCreates = left.callsTo("/api/v1/intents");
    expect(leftCreates.map((call) => call.status)).toEqual([200]);
    expect(left.harness.db.intents.size).toBe(1);
  });
});
