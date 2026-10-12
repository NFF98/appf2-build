import { describe, expect, test } from "vitest";

import { AppSession, type AppVersion } from "../../src/app/app-surface/app-session.js";
import { runtimeAppHandle } from "../../src/platform/runtime/browser/runtime-app-host.js";
import { productionHarness, resultBlueprint } from "../runtime/result-fixtures.js";
import { change, type RuntimeHarness } from "../runtime/runtime-fixtures.js";

const perPerson = (version: AppVersion) => version.app.result()[0];

function versionOf(harness: RuntimeHarness): AppVersion {
  const contentHash = harness.admitted.admission.content_hash;
  return { contentHash, app: runtimeAppHandle(harness.runtime, contentHash) };
}

interface CompareFixture {
  readonly session: AppSession;
  readonly current: AppVersion;
  readonly candidate: AppVersion;
  readonly currentRuntime: RuntimeHarness["runtime"];
  readonly candidateRuntime: RuntimeHarness["runtime"];
}

async function sessionInCompare(): Promise<CompareFixture> {
  const old = await productionHarness(resultBlueprint());
  const next = await productionHarness(resultBlueprint({ total: 200, title: "聚餐分帳（新版）" }));
  const current = versionOf(old);
  const candidate = versionOf(next);
  const session = new AppSession(current);
  session.openCorrection();
  session.updateDraft("總額改成 200");
  expect(session.submitCorrection()).toBe("總額改成 200");
  session.correctionReady(candidate);
  expect(session.getSnapshot().correction).toEqual({ kind: "COMPARE", draft: "總額改成 200", candidate });
  return { session, current, candidate, currentRuntime: old.runtime, candidateRuntime: next.runtime };
}

describe("F00 APP surface session", () => {
  test("TEST-F00-010 a correction failure leaves the current App, its Blueprint and committed state untouched and usable", async () => {
    const harness = await productionHarness(resultBlueprint());
    const current = versionOf(harness);
    const session = new AppSession(current);
    expect(change(harness, "node_people", 6).accepted).toBe(true);
    const blueprintBefore = JSON.stringify(harness.runtime.blueprint);

    session.openCorrection();
    session.updateDraft("每人金額改成四捨五入");
    expect(session.submitCorrection()).toBe("每人金額改成四捨五入");
    expect(session.getSnapshot().correction).toEqual({ kind: "CORRECTING", draft: "每人金額改成四捨五入" });
    session.correctionFailed();

    const after = session.getSnapshot();
    expect(after.correction).toEqual({ kind: "FAILED", draft: "每人金額改成四捨五入" });
    expect(after.current).toBe(current);
    expect(harness.runtime.status).toBe("READY");
    expect(JSON.stringify(harness.runtime.blueprint)).toBe(blueprintBefore);
    expect(harness.runtime.readState("people")).toBe(6);
    expect(perPerson(after.current)).toMatchObject({ status: "AVAILABLE", display: "20" });

    // Still the live App: it keeps accepting local actions, and the failed draft is offered again.
    expect(change(harness, "node_people", 8).accepted).toBe(true);
    expect(perPerson(after.current)).toMatchObject({ display: "15" });
    session.openCorrection();
    expect(session.getSnapshot().correction).toEqual({ kind: "COMPOSING", draft: "每人金額改成四捨五入" });
  });

  test("TEST-F00-011 Compare offers Accept New, Keep Previous and Adjust Again with their distinct outcomes", async () => {
    const accept = await sessionInCompare();
    accept.session.decide("ACCEPT_NEW");
    expect(accept.session.getSnapshot()).toEqual({ current: accept.candidate, correction: { kind: "NONE" } });
    expect(perPerson(accept.candidate)).toMatchObject({ display: "50" });
    expect(accept.currentRuntime.status).toBe("DISPOSED");
    expect(accept.candidateRuntime.status).toBe("READY");

    const keep = await sessionInCompare();
    keep.session.decide("KEEP_PREVIOUS");
    expect(keep.session.getSnapshot()).toEqual({ current: keep.current, correction: { kind: "NONE" } });
    expect(perPerson(keep.current)).toMatchObject({ display: "30" });
    expect(keep.currentRuntime.status).toBe("READY");
    expect(keep.candidateRuntime.status).toBe("DISPOSED");

    const adjust = await sessionInCompare();
    adjust.session.decide("ADJUST_AGAIN");
    expect(adjust.session.getSnapshot()).toEqual({ current: adjust.current, correction: { kind: "COMPOSING", draft: "總額改成 200" } });
    expect(adjust.currentRuntime.status).toBe("READY");
    expect(adjust.candidateRuntime.status).toBe("DISPOSED");

    // Outside Compare a decision is meaningless and changes nothing.
    const idle = new AppSession(versionOf(await productionHarness(resultBlueprint())));
    const before = idle.getSnapshot();
    idle.decide("ACCEPT_NEW");
    expect(idle.getSnapshot()).toBe(before);
  });
});
