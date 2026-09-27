import { describe, expect, test } from "vitest";

import {
  ensureAnonymousId,
  ensureSessionId
} from "../../src/platform/identity/browser-identity.js";
import {
  anonymousCorrelationContext,
  browserSessionContext,
  type AnonymousCorrelationContext
} from "../../src/platform/identity/identity-types.js";
import { identityDependencies } from "../unit/identity-test-support.js";

const ANONYMOUS_ID = "123e4567-e89b-42d3-a456-426614174000";
const SESSION_ID = "987fcdeb-51a2-43d7-8abc-0123456789ab";

describe("anonymous identity trust boundary", () => {
  test("TEST-F07-004 represents anonymous identity only as correlation with no ownership authority", () => {
    const dependencies = identityDependencies([ANONYMOUS_ID]);
    const context: AnonymousCorrelationContext = anonymousCorrelationContext(
      ensureAnonymousId(dependencies)
    );

    expect(context).toEqual({
      kind: "ANONYMOUS_CORRELATION",
      anonymousId: ANONYMOUS_ID,
      securityAuthority: "NONE"
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.keys(context).sort()).toEqual([
      "anonymousId",
      "kind",
      "securityAuthority"
    ]);
  });

  test("keeps session identity outside the correlation authorization representation", () => {
    const dependencies = identityDependencies([SESSION_ID]);
    const context = browserSessionContext(ensureSessionId(dependencies));

    expect(context).toEqual({
      kind: "BROWSER_SESSION",
      sessionId: SESSION_ID,
      securityAuthority: "NONE"
    });
    expect(Object.keys(context).sort()).toEqual([
      "kind",
      "securityAuthority",
      "sessionId"
    ]);
  });
});
