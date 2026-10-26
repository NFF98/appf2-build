import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreateWorkspace } from "../../src/app/create/CreateWorkspace.js";
import type { CreationController } from "../../src/app/create/creation-controller.js";
import { newSession, type CreationSession } from "../../src/app/create/creation-session.js";
import { readFailure } from "../../src/app/create/f01-wire.js";

function recoveryPage(status: number): string {
  const session: CreationSession = {
    ...newSession("Build LifePilot with tasks", null),
    phase: {
      kind: "RECOVERABLE_FAILURE", reason: "RETRYABLE",
      step: { kind: "CREATE", body: { intent_kind: "CREATE", raw_intent: "Build LifePilot with tasks" } },
      code: "F01-ERR-005", httpStatus: status
    }
  };
  return renderToStaticMarkup(createElement(CreateWorkspace, {
    session, controller: {} as CreationController, onBack: () => {}
  }));
}

describe("Sprint 3.5 honest rate-limit recovery UI", () => {
  it("keeps 429 distinguishable from a generic retryable API response", () => {
    expect(readFailure(429, { error: { code: "F01-ERR-005", retryable: true } }))
      .toMatchObject({ kind: "API", code: "F01-ERR-005", httpStatus: 429 });
  });

  it("explains AI throttling without deleting the user's original App prompt", () => {
    const html = recoveryPage(429);
    expect(html).toContain("AI 供應商目前限制請求次數");
    expect(html).toContain("內容已保留");
    expect(html).toContain("稍後再試一次");
    expect(html).toContain("修改需求");
  });

  it("never mislabels a provider 503 as 429", () => {
    const html = recoveryPage(503);
    expect(html).toContain("連線或服務暫時沒有回應");
    expect(html).not.toContain("AI 供應商目前限制請求次數");
  });
});
