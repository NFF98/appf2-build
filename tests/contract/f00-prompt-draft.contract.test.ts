import { describe, expect, test } from "vitest";

import { findCapsule } from "../../src/app/discover/capsules.js";
import type { ComposerDraft } from "../../src/app/discover/DiscoverScreen.js";
import {
  PROMPT_DRAFT_SCHEMA,
  PROMPT_DRAFT_STORAGE_KEY,
  PROMPT_DRAFT_TTL_MS,
  PROMPT_DRAFT_VERSION,
  PromptDraftStore,
  type DraftStorage
} from "../../src/app/discover/prompt-draft-store.js";
import { clarifyingAnalysis, DNP_SECRET, dnpReadyAnalysis } from "../api/f01-harness.js";
import { InProcessF01 } from "../behavior/support/in-process-f01.js";

const SAVED_AT = Date.parse("2026-10-09T00:00:00.000Z");
const ANSWER_MARKER = 4_111_111_111;

/** In-memory Web Storage that records every write, so anything that ever reached storage is observable. */
class RecordingStorage implements DraftStorage {
  public readonly writes: string[] = [];
  private readonly items = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.writes.push(`${key}=${value}`);
    this.items.set(key, value);
  }

  public removeItem(key: string): void {
    this.items.delete(key);
  }

  public keys(): string[] {
    return [...this.items.keys()];
  }
}

function draftStore(storage: () => DraftStorage, clock: { now: number }): PromptDraftStore {
  return new PromptDraftStore({ storage, now: () => clock.now, isKnownCapsule: (id) => findCapsule(id) !== undefined });
}

const record = (fields: Record<string, unknown>): string =>
  JSON.stringify({ schema: PROMPT_DRAFT_SCHEMA, version: PROMPT_DRAFT_VERSION, text: "幫我做分帳工具", capsule_id: null, saved_at: SAVED_AT, ...fields });

describe("F00 browser prompt-draft persistence", () => {
  test("TEST-F00-AC-018 local draft storage holds only the closed, versioned prompt draft; DO_NOT_PERSIST values, answers and F01 output never reach it", async () => {
    const storage = new RecordingStorage();
    const clock = { now: SAVED_AT };
    const drafts = draftStore(() => storage, clock);

    // Closed allowlist: whatever object the caller hands over, only the five record fields are written.
    const polluted = { text: "幫我做一個聚餐分帳工具", capsuleId: "not-a-capsule", answerDrafts: { q1: DNP_SECRET }, decision: { secret: DNP_SECRET } } as ComposerDraft;
    drafts.save(polluted);
    expect(JSON.parse(storage.getItem(PROMPT_DRAFT_STORAGE_KEY) ?? "null")).toStrictEqual({
      schema: PROMPT_DRAFT_SCHEMA,
      version: PROMPT_DRAFT_VERSION,
      text: "幫我做一個聚餐分帳工具",
      capsule_id: null,
      saved_at: SAVED_AT
    });
    expect(PROMPT_DRAFT_STORAGE_KEY).toBe("appf2.f00.prompt_draft.v1");
    expect(storage.writes.join("\n")).not.toContain(DNP_SECRET);

    // A whole creation through the real F01 API: a DO_NOT_PERSIST KnownInput, a clarification answer and every F01
    // response pass through the Shell, but only User edits of the Composer are ever written to draft storage.
    const prompt = "幫我做一個刷卡聚餐分帳工具";
    drafts.save({ text: prompt, capsuleId: "dinner-split" });
    const clarified = new InProcessF01();
    clarified.queueAnalysis(clarifyingAnalysis()).queueValidBlueprint();
    expect(clarified.controller.start(prompt, "dinner-split")).toBe("STARTED");
    const clarifying = await clarified.settle();
    expect(clarifying.phase.kind).toBe("CLARIFICATION_REQUIRED");
    clarified.controller.updateAnswer(clarifying.decision?.questions[0]?.questionId ?? "", { kind: "TEXT", text: String(ANSWER_MARKER) });
    clarified.controller.submitDecisions();
    expect((await clarified.settle()).phase.kind).toBe("BUILD_VALIDATED");
    expect(clarified.callsTo("/answers")[0]?.body).toContain(String(ANSWER_MARKER));

    const sensitive = new InProcessF01();
    sensitive.queueAnalysis(dnpReadyAnalysis()).queueValidBlueprint();
    sensitive.controller.start(prompt, null);
    await sensitive.settle();
    expect(sensitive.harness.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
    const written = storage.writes.join("\n");
    for (const forbidden of [DNP_SECRET, String(ANSWER_MARKER), "intent_id", "visible_assumptions", "progress", "content_hash"]) expect(written).not.toContain(forbidden);
    expect(storage.keys()).toEqual([PROMPT_DRAFT_STORAGE_KEY]);
    expect(drafts.load()).toEqual({ text: prompt, capsuleId: "dinner-split" });

    // Successful submit ends exactly the submitted draft; a newer unsent draft survives it.
    drafts.save({ text: "另一個還沒送出的想法", capsuleId: null });
    drafts.clearSubmitted(prompt);
    expect(drafts.load()).toEqual({ text: "另一個還沒送出的想法", capsuleId: null });
    drafts.clearSubmitted("另一個還沒送出的想法");
    expect(storage.keys()).toEqual([]);

    // Cancel: an emptied Composer removes the record instead of storing a blank draft.
    drafts.save({ text: prompt, capsuleId: null });
    drafts.save({ text: "   ", capsuleId: null });
    expect(storage.keys()).toEqual([]);

    // Expiry (7 days) and every malformed / unknown-version shape fail closed: nothing restored, record deleted.
    const rejected: readonly [string, string][] = [
      ["expired", record({ saved_at: SAVED_AT - PROMPT_DRAFT_TTL_MS })],
      ["future", record({ saved_at: SAVED_AT + 1 })],
      ["version 2", record({ version: 2 })],
      ["other schema", record({ schema: "appf2.f00.other" })],
      ["extra field", record({ answers: { q1: 8 } })],
      ["unknown capsule", record({ capsule_id: "evil-capsule" })],
      ["blank text", record({ text: "  " })],
      ["non-integer time", record({ saved_at: "2026-10-09" })],
      ["not an object", JSON.stringify([record({})])],
      ["not JSON", "{draft"]
    ];
    for (const [label, raw] of rejected) {
      storage.setItem(PROMPT_DRAFT_STORAGE_KEY, raw);
      expect(drafts.load(), label).toBeNull();
      expect(storage.keys(), label).toEqual([]);
    }
    storage.setItem(PROMPT_DRAFT_STORAGE_KEY, record({ saved_at: SAVED_AT - PROMPT_DRAFT_TTL_MS + 1, capsule_id: "dinner-split" }));
    expect(drafts.load()).toEqual({ text: "幫我做分帳工具", capsuleId: "dinner-split" });

    // F00-ERR-002: blocked or failing storage means continuing without persistence, never a crash.
    const failing: DraftStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      }
    };
    for (const unavailable of [draftStore(() => failing, clock), draftStore(() => { throw new Error("storage blocked"); }, clock)]) {
      expect(() => unavailable.save({ text: prompt, capsuleId: null })).not.toThrow();
      expect(unavailable.load()).toBeNull();
      expect(() => unavailable.clearSubmitted(prompt)).not.toThrow();
    }
  });
});
