import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  CREATE_CHECKPOINT_IDS as BROWSER_CHECKPOINT_IDS,
  CREATE_PROGRESS_PLAN_VERSION as BROWSER_PLAN_VERSION,
  COMPOSITE_CHECKPOINT_COUNT,
  compositePercent,
  createProgressView,
  type CreateProgressView
} from "../../src/app/create/create-progress.js";
import type { CreationSession } from "../../src/app/create/creation-session.js";
import { CreateWorkspace } from "../../src/app/create/CreateWorkspace.js";
import { StageProgress } from "../../src/app/create/StageProgress.js";
import { CREATE_CHECKPOINT_IDS, CREATE_PROGRESS_PLAN_VERSION } from "../../src/platform/compiler/create-progress.js";
import type { RuntimeStatus } from "../../src/platform/runtime/runtime-evidence.js";
import { clarifyingAnalysis, readyAnalysis } from "../api/f01-harness.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { validBlueprint } from "../contract/blueprint-validation-fixtures.js";
import { nffDefault } from "../contract/intent-envelope-fixtures.js";
import { runtimeHarness } from "../runtime/runtime-fixtures.js";
import { InProcessF01, isAnswers, isCompile, isCreate, type InProcessCall } from "./support/in-process-f01.js";

const PROMPT = "幫我做一個公司聚餐分帳工具";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type S02 = { readonly view: CreateProgressView; readonly markup: string; readonly stages: string[] };

/** The S02 progress region exactly as rendered from the session (and, after VALIDATED, the F03 status). */
function s02(session: CreationSession, runtimeStatus: RuntimeStatus | null = null): S02 {
  const view = createProgressView(session.phase, session.checkpoints, runtimeStatus);
  const markup = renderToStaticMarkup(createElement(StageProgress, { view }));
  return { view, markup, stages: [...markup.matchAll(/class="stage stage-(\w+)"/g)].map((match) => match[1] ?? "") };
}

/** F01-API-005 snapshot exactly as the Browser received it. */
function f01Progress(call: InProcessCall | undefined): { completed_checkpoint_ids: string[]; planned_checkpoint_ids: string[]; waiting_for_user: boolean } {
  const data = (call?.response as { data?: { progress?: unknown } } | undefined)?.data;
  if (data?.progress === undefined) throw new Error(`no F01 progress in ${JSON.stringify(call?.response)}`);
  return data.progress as ReturnType<typeof f01Progress>;
}

const tamperProgress =
  (change: (progress: Record<string, unknown>) => void) =>
  (body: Record<string, unknown>): Record<string, unknown> => {
    change((body.data as { progress: Record<string, unknown> }).progress);
    return body;
  };

async function validatedSession(): Promise<{ readonly f01: InProcessF01; readonly session: CreationSession }> {
  const f01 = new InProcessF01();
  f01.queueAnalysis(readyAnalysis()).queueValidBlueprint();
  f01.controller.start(PROMPT, null);
  const session = await f01.settle();
  expect(session.phase.kind).toBe("BUILD_VALIDATED");
  return { f01, session };
}

/** A snapshot that is not the locked plan is not reliable truth: the response is malformed and no % is shown. */
async function expectUnreliableSnapshotsRejected(): Promise<void> {
  const tampers: ((progress: Record<string, unknown>) => void)[] = [
    (progress) => (progress.completed_checkpoint_ids = ["F01-CREATE-CP-02"]),
    (progress) => (progress.plan_version = "f01-create-v2"),
    (progress) => (progress.planned_checkpoint_ids = [...CREATE_CHECKPOINT_IDS, "F01-CREATE-CP-07"]),
    (progress) => (progress.waiting_for_user = true)
  ];
  for (const change of tampers) {
    const tampered = new InProcessF01();
    tampered.queueAnalysis(readyAnalysis());
    tampered.tamperNext(isCreate, tamperProgress(change));
    tampered.controller.start(PROMPT, null);
    const failed = await tampered.settle();
    expect(failed.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "MALFORMED" });
    expect(s02(failed).view.percent).toBeNull();
    expect(tampered.callsTo("/compile")).toEqual([]);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("F00 S02 / O05 composite Create progress", () => {
  test("TEST-F00-PROG-001 S02 progress is floor(completed of six F01 CREATE checkpoints plus F03 APP_READY × 100 / 7)", async () => {
    expect([BROWSER_PLAN_VERSION, BROWSER_CHECKPOINT_IDS]).toEqual([CREATE_PROGRESS_PLAN_VERSION, CREATE_CHECKPOINT_IDS]);
    expect(COMPOSITE_CHECKPOINT_COUNT).toBe(CREATE_CHECKPOINT_IDS.length + 1);
    expect(Array.from({ length: COMPOSITE_CHECKPOINT_COUNT + 1 }, (_, completed) => compositePercent(completed))).toEqual([0, 14, 28, 42, 57, 71, 85, 100]);

    const f01 = new InProcessF01();
    f01.queueAnalysis(readyAnalysis()).queueValidBlueprint();
    const releaseCompile = f01.holdNext(isCompile);
    f01.controller.start(PROMPT, null);
    const analyzing = s02(f01.session());
    expect(analyzing.view.percent).toBeNull();
    expect(analyzing.markup).not.toContain("progressbar");
    expect(analyzing.markup).toContain("activity-pulse");

    // READY with CP-01/02/03 → 3/7 = 42%, held there while the compile request is in flight.
    await expect.poll(() => f01.session().phase.kind).toBe("BUILDING");
    const createProgress = f01Progress(f01.callsTo("/api/v1/intents")[0]);
    expect(createProgress.planned_checkpoint_ids).toEqual([...CREATE_CHECKPOINT_IDS]);
    expect(createProgress.completed_checkpoint_ids).toEqual(CREATE_CHECKPOINT_IDS.slice(0, 3));
    const building = s02(f01.session());
    expect(building.view).toEqual({ completedStages: 1, currentStage: 1, active: true, percent: 42 });
    expect(building.markup).toContain('aria-valuenow="42"');
    expect(building.markup).toContain(">42%<");
    expect(building.markup).not.toContain("activity-pulse");
    expect(building.stages).toEqual(["done", "current", "future", "future"]);

    // VALIDATED completes all six F01 checkpoints → 6/7 = 85%; 準備 App waits for F03.
    releaseCompile();
    const validated = await f01.settle();
    expect(f01Progress(f01.callsTo("/compile")[0]).completed_checkpoint_ids).toEqual([...CREATE_CHECKPOINT_IDS]);
    const done = s02(validated);
    expect(done.view).toEqual({ completedStages: 3, currentStage: null, active: false, percent: 85 });
    expect(done.markup).toContain('aria-valuenow="85"');
    expect(done.markup).not.toContain("100%");
    expect(done.stages).toEqual(["done", "done", "done", "future"]);

    await expectUnreliableSnapshotsRejected();
  });

  test("TEST-F00-PROG-002 waiting for the User freezes the percentage and motion; elapsed time never moves it", async () => {
    const f01 = new InProcessF01();
    f01.queueAnalysis(clarifyingAnalysis()).queueValidBlueprint();
    f01.controller.start(PROMPT, null);
    const asking = await f01.settle();
    expect(asking.phase.kind).toBe("CLARIFICATION_REQUIRED");
    expect(f01Progress(f01.callsTo("/api/v1/intents")[0])).toMatchObject({ waiting_for_user: true, completed_checkpoint_ids: CREATE_CHECKPOINT_IDS.slice(0, 2) });
    const waiting = s02(asking);
    expect(waiting.view).toEqual({ completedStages: 0, currentStage: 0, active: false, percent: 28 });
    expect(waiting.markup).not.toContain("activity-pulse");

    vi.useFakeTimers();
    f01.harness.clock.advance(SIX_HOURS_MS);
    vi.advanceTimersByTime(SIX_HOURS_MS);
    expect(s02(f01.session()).markup).toBe(waiting.markup);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();

    // While the answers request is in flight the last known truth stays; only F01's response moves it.
    const releaseAnswers = f01.holdNext(isAnswers);
    f01.controller.updateAnswer(asking.decision?.questions[0]?.questionId ?? "", { kind: "TEXT", text: "8" });
    f01.controller.submitDecisions();
    const sending = s02(f01.session());
    expect(f01.session().busy).toBe(true);
    expect(sending.view.percent).toBe(28);
    expect(sending.markup).not.toContain("activity-pulse");
    releaseAnswers();
    const validated = await f01.settle();
    expect(s02(validated).view.percent).toBe(85);

    // ASSUMPTION_REVIEW is waiting too: frozen, no motion.
    const review = new InProcessF01();
    review.queueAnalysis({ ...readyAnalysis(), assumptions: [nffDefault({ id: "currency", description: "幣別", proposed_default: "TWD" })] });
    review.controller.start(PROMPT, null);
    const reviewing = await review.settle();
    expect(reviewing.phase.kind).toBe("ASSUMPTION_REVIEW");
    const reviewProgress = f01Progress(review.callsTo("/api/v1/intents")[0]);
    expect(reviewProgress.waiting_for_user).toBe(true);
    expect(s02(reviewing).view).toMatchObject({ active: false, percent: compositePercent(reviewProgress.completed_checkpoint_ids.length) });

    // A failure freezes the last real value; a User retry is a new progress operation with no inherited %.
    const retried = new InProcessF01();
    retried.queueAnalysis(clarifyingAnalysis()).queueValidBlueprint();
    retried.controller.start(PROMPT, null);
    const round = await retried.settle();
    retried.controller.updateAnswer(round.decision?.questions[0]?.questionId ?? "", { kind: "TEXT", text: "8" });
    retried.dropNext(isAnswers);
    retried.controller.submitDecisions();
    const failed = await retried.settle();
    expect(failed.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "RETRYABLE" });
    expect(s02(failed).view).toMatchObject({ active: false, percent: 28 });
    const releaseRetry = retried.holdNext(isAnswers);
    retried.controller.retry();
    const resumed = s02(retried.session());
    expect(resumed.view.percent).toBeNull();
    expect(resumed.markup).not.toContain("progressbar");
    releaseRetry();
    expect(s02(await retried.settle()).view.percent).toBe(85);
  });

  test("TEST-F00-PROG-003 F01 VALIDATED stops at 85%; only the real F03 READY of the validated App reaches 100%", async () => {
    const { f01, session } = await validatedSession();
    for (const status of [null, "UNINITIALIZED", "HYDRATING", "RECOVERABLE_ERROR", "FATAL_ERROR", "DISPOSED"] as const) {
      const view = s02(session, status);
      expect(view.view.percent, String(status)).toBe(85);
      expect(view.markup, String(status)).not.toContain("100%");
    }

    // The real F03 Runtime Instance for the very Blueprint F01 validated.
    const compiled = (f01.callsTo("/compile")[0]?.response as { data: { content_hash: string } }).data.content_hash;
    const runtime = await runtimeHarness(validBlueprint() as JsonRecord);
    expect(runtime.admitted.admission.content_hash).toBe(compiled);
    expect(s02(session, runtime.runtime.status).view).toEqual({ completedStages: 3, currentStage: null, active: false, percent: 85 });

    const hydration = runtime.runtime.hydrate();
    expect(runtime.runtime.status).toBe("HYDRATING");
    const hydrating = s02(session, runtime.runtime.status);
    expect(hydrating.view).toEqual({ completedStages: 3, currentStage: 3, active: true, percent: 85 });
    expect(hydrating.stages).toEqual(["done", "done", "done", "current"]);

    expect(await hydration).toEqual({ status: "READY" });
    const ready = s02(session, runtime.runtime.status);
    expect(ready.view).toEqual({ completedStages: 4, currentStage: null, active: false, percent: 100 });
    expect(ready.markup).toContain('aria-valuenow="100"');
    expect(ready.stages).toEqual(["done", "done", "done", "done"]);

    // The S02 surface itself: 100% appears only with the F03 READY status, never from F01 alone.
    const workspace = (runtimeStatus?: RuntimeStatus): string =>
      renderToStaticMarkup(createElement(CreateWorkspace, { session, controller: f01.controller, onBack: () => undefined, ...(runtimeStatus === undefined ? {} : { runtimeStatus }) }));
    expect(workspace()).toContain(">85%<");
    expect(workspace()).not.toContain("100%");
    expect(workspace(runtime.runtime.status)).toContain(">100%<");

    // F03 truth never counts before F01 VALIDATED.
    const early = new InProcessF01();
    early.queueAnalysis(clarifyingAnalysis());
    early.controller.start(PROMPT, null);
    expect(s02(await early.settle(), "READY").view).toMatchObject({ percent: 28, completedStages: 0 });
  });
});
