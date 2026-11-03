import { describe, expect, it } from "vitest";
import { SYSTEM_POLICY } from "../../src/platform/compiler/prompts.js";

describe("Sprint 3.5 F02 list CRUD and completion progress prompt", () => {
  it("teaches editable source indices without treating filtered views as editable positions", () => {
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("NEVER hardcode zero");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("Never mutate a source list using an index_alias from a filtered/reordered view");
  });
  it("explains truthful completed count and guarded percentage, not total count masquerading as completion", () => {
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("COUNT(LIST_FILTER_EQ(");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("guarding zero total with IF");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).not.toContain("do not claim it computes completion percentages or filtered counts");
  });
});
