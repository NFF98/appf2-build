import { describe, expect, test } from "vitest";

import { AppSession } from "../../src/app/app-surface/app-session.js";
import { canonicalBlueprintBytes } from "../../src/platform/blueprint/canonical-json.js";
import { hashCanonicalBlueprintBytes } from "../../src/platform/blueprint/content-identity.js";
import { runtimeAppHandle } from "../../src/platform/runtime/browser/runtime-app-host.js";
import { productionHarness, resultBlueprint } from "../runtime/result-fixtures.js";
import { change, snapshot } from "../runtime/runtime-fixtures.js";

describe("F00 Compare contract", () => {
  test("TEST-F00-AC-012 Keep Previous returns to the old App without mutating its Blueprint, content identity or committed state", async () => {
    const old = await productionHarness(resultBlueprint());
    expect(change(old, "node_people", 5).accepted).toBe(true);
    const candidate = await productionHarness(resultBlueprint({ total: 200, title: "聚餐分帳（新版）" }));
    const oldHash = old.admitted.admission.content_hash;
    const candidateHash = candidate.admitted.admission.content_hash;
    const blueprintBefore = structuredClone(old.runtime.blueprint);
    const stateBefore = snapshot(old, ["people", "total", "divisor", "note"]);
    const oldVersion = { contentHash: oldHash, app: runtimeAppHandle(old.runtime, oldHash) };

    const session = new AppSession(oldVersion);
    session.openCorrection();
    session.updateDraft("總額改成 200");
    session.submitCorrection();
    session.correctionReady({ contentHash: candidateHash, app: runtimeAppHandle(candidate.runtime, candidateHash) });
    session.decide("KEEP_PREVIOUS");

    expect(session.getSnapshot()).toEqual({ current: oldVersion, correction: { kind: "NONE" } });
    expect(session.getSnapshot().current).toBe(oldVersion);
    expect(old.runtime.blueprint).toEqual(blueprintBefore);
    expect(hashCanonicalBlueprintBytes(canonicalBlueprintBytes(old.runtime.blueprint))).toBe(oldHash);
    expect(hashCanonicalBlueprintBytes(new TextEncoder().encode(String(old.admitted.body)))).toBe(oldHash);
    expect(snapshot(old, ["people", "total", "divisor", "note"])).toEqual(stateBefore);
    expect(oldVersion.app.result()[0]).toMatchObject({ status: "AVAILABLE", display: "24" });
    expect(old.runtime.status).toBe("READY");
    expect(candidate.runtime.status).toBe("DISPOSED");
    expect(candidateHash).not.toBe(oldHash);
  });
});
