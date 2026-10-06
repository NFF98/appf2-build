import { test as base, expect, type Locator, type Page } from "@playwright/test";

import type { ClarificationPolicyEvaluation } from "../../src/platform/intent/clarification-policy.js";
import type { BlueprintValidationResult, ResultOutput } from "../../src/platform/blueprint/validation-types.js";
import { analysis, item, nffDefault } from "../contract/intent-envelope-fixtures.js";
import { source, validBlueprint, without } from "../contract/blueprint-validation-fixtures.js";
import { startSp2Harness } from "./support/sp2-harness-server.js";

type HarnessPanel = "f01" | "f02";

const test = base.extend<object, { harnessUrl: string }>({
  harnessUrl: [
    async ({}, use) => {
      const harness = await startSp2Harness();
      try {
        await use(harness.url);
      } finally {
        await harness.close();
      }
    },
    { scope: "worker" }
  ]
});

const PRODUCTION_ROUTES: Readonly<Record<HarnessPanel, string>> = {
  f01: "/api/f01/clarification",
  f02: "/api/f02/validation"
};

/** Drives the real browser page: the page POSTs to production via the harness server and renders the reply. */
async function submitInBrowser<T>(page: Page, panel: HarnessPanel, payload: unknown): Promise<{ status: number; body: T }> {
  await page.locator(`#${panel}-input`).fill(JSON.stringify(payload));
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === PRODUCTION_ROUTES[panel]),
    page.locator(`#${panel}-submit`).click()
  ]);
  return { status: response.status(), body: (await response.json()) as T };
}

function fieldTexts(list: Locator, field: string): Promise<string[]> {
  return list.locator(`li [data-field="${field}"]`).allTextContents();
}

test.beforeEach(async ({ page, harnessUrl }) => {
  await page.goto(harnessUrl);
});

test.describe("F01-AC-002 required missing + no safe default → NEEDS_CLARIFICATION", () => {
  test("TEST-F01-CP-001 browser renders production NEEDS_CLARIFICATION for a required missing field without a safe default", async ({ page }) => {
    const envelope = analysis({
      missing_fields: [item({ id: "event_date", required_for_execution: true, can_default: false })]
    });

    const { status, body } = await submitInBrowser<ClarificationPolicyEvaluation>(page, "f01", envelope);

    expect(status).toBe(200);
    expect(body.decision).toBe("NEEDS_CLARIFICATION");
    await expect(page.getByTestId("f01-decision")).toHaveText("NEEDS_CLARIFICATION");
    await expect(page.getByTestId("f01-triggered-rule-ids").locator("li")).toHaveText(["F01-POL-CP-001"]);
    const questions = page.getByTestId("f01-questions");
    await expect(questions.locator("li")).toHaveCount(body.questions.length);
    expect(await fieldTexts(questions, "semantic_item_ids")).toEqual(["event_date"]);
    expect(await fieldTexts(questions, "policy_rule_id")).toEqual(["F01-POL-CP-001"]);
    await expect(questions.locator("li").first()).toHaveAttribute("data-question-id", body.questions[0]!.question_id);
  });

  test("TEST-F01-CP-001 browser renders a non-clarification production decision when the required field has a safe default", async ({ page }) => {
    const envelope = analysis({
      missing_fields: [nffDefault({ id: "currency", required_for_execution: true, proposed_default: "TWD" })]
    });

    const { status, body } = await submitInBrowser<ClarificationPolicyEvaluation>(page, "f01", envelope);

    expect(status).toBe(200);
    expect(body.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    await expect(page.getByTestId("f01-decision")).toHaveText("READY_WITH_VISIBLE_ASSUMPTIONS");
    await expect(page.getByTestId("f01-triggered-rule-ids").locator("li")).toHaveText(["F01-POL-CP-004"]);
    await expect(page.getByTestId("f01-questions").locator("li")).toHaveCount(0);
  });
});

test.describe("F02-AC-017 result surface has explicit outputs; no inference from the UI tree", () => {
  test("TEST-F02-017 browser renders explicit result.outputs returned by production Blueprint validation", async ({ page }) => {
    const candidate = validBlueprint();
    const declaredOutputs = [
      { id: "per_person", label: "每人金額", value: source.state("per_person"), sensitivity: "NORMAL" },
      { id: "total_amount", label: "總金額", value: source.state("total"), sensitivity: "SENSITIVE" }
    ];
    candidate.result = { outputs: declaredOutputs };
    expect(JSON.stringify(candidate.nodes)).not.toContain("總金額");

    const { status, body } = await submitInBrowser<BlueprintValidationResult>(page, "f02", candidate);

    expect(status).toBe(200);
    expect(body.report.status).toBe("PASSED");
    const returnedOutputs: readonly ResultOutput[] = body.admissible?.blueprint.result.outputs ?? [];
    expect(returnedOutputs).toEqual(declaredOutputs);
    await expect(page.getByTestId("f02-report-status")).toHaveText("PASSED");
    await expect(page.getByTestId("f02-result-outputs-presence")).toHaveText("PRESENT");
    const rendered = page.getByTestId("f02-result-outputs");
    await expect(rendered.locator("li")).toHaveCount(returnedOutputs.length);
    expect(await fieldTexts(rendered, "id")).toEqual(returnedOutputs.map((output) => output.id));
    expect(await fieldTexts(rendered, "label")).toEqual(returnedOutputs.map((output) => output.label));
    expect(await fieldTexts(rendered, "value")).toEqual(returnedOutputs.map((output) => JSON.stringify(output.value)));
    expect(await fieldTexts(rendered, "sensitivity")).toEqual(returnedOutputs.map((output) => output.sensitivity));
  });

  test("TEST-F02-017 browser renders no result surface when production rejects a candidate omitting explicit result.outputs", async ({ page }) => {
    const { status, body } = await submitInBrowser<BlueprintValidationResult>(page, "f02", without(["result", "outputs"]));

    expect(status).toBe(200);
    expect(body.report.status).toBe("REJECTED");
    expect(body.admissible).toBeUndefined();
    await expect(page.getByTestId("f02-report-status")).toHaveText("REJECTED");
    const issues = page.getByTestId("f02-report-issues");
    expect(await fieldTexts(issues, "error_code")).toEqual(["F02-ERR-002"]);
    expect(await fieldTexts(issues, "stage")).toEqual(["V02"]);
    expect(await fieldTexts(issues, "json_path")).toEqual(["$.result.outputs"]);
    await expect(page.getByTestId("f02-result-outputs-presence")).toHaveText("ABSENT");
    await expect(page.getByTestId("f02-result-outputs").locator("li")).toHaveCount(0);
  });
});
