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
import {
  createBody,
  createOriginalHolderWorld,
  dataOfRaw,
  denial,
  firstPartyPost,
  grantUrl,
  issuedCookie,
  readProofBy,
  signedCreate,
  signedMutationHeaders,
  UNIFORM_NOT_FOUND,
  type RawResponse
} from "../api/original-holder-world.js";
import { grantPathOf } from "../api/s03-first-party-client.js";
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

/** F01-API-ID-001A item 7: scoped-authority failures keep the malformed / security / indistinguishable-404 routes. */
const SCOPED_MUTATION_REFUSALS = [[400, "F01-ERR-001"], [422, "F01-ERR-012"], [404, "F01-ERR-015"]].map((pair) => JSON.stringify(pair));
const LEGACY_GLOBAL_COOKIE = "appf2.trusted_anonymous.v1";

describe("F07-AC-004 BS-P1-025 anonymous_id is continuity only, never owner authority", () => {
  test("TEST-F07-004 a known victim anonymous_id grants no owner mutation, private Intent read or read grant, and no global cookie replaces per-intent cookie + PoP", async () => {
    const world = createOriginalHolderWorld();
    const { db } = world.backend.harness;
    const victim = await world.validatedHolder();
    const victimAnonymousId = world.anonymousIdOf(victim.intentId);
    const victimBefore = structuredClone(db.intents.get(victim.intentId));
    const attacker = await world.key();

    world.queueReadyAnalysis();
    const created = await world.handle(await signedCreate(attacker, createBody(victimAnonymousId, "attacker request")));
    expect(created.status).toBe(200);
    const attackerIntentId = String(dataOfRaw(created).intent_id);
    expect(attackerIntentId).not.toBe(victim.intentId);
    expect(world.anonymousIdOf(attackerIntentId)).toBe(victimAnonymousId);
    expect(created.headers.getSetCookie()[0]).toContain(`Path=/api/v1/intents/${attackerIntentId}/`);
    const attackerCookie = issuedCookie(created);
    const globalCookie = `${LEGACY_GLOBAL_COOKIE}=v1.${victimAnonymousId}.forged`;

    const compilePath = `/api/v1/intents/${victim.intentId}/compile`;
    const compileBody = JSON.stringify({ intent_version: victimBefore?.intent_version });
    const statementsBefore = db.statements.length;
    const mutations: Record<string, Request> = {
      "attacker scoped cookie + attacker key": firstPartyPost(compilePath, compileBody, {
        Cookie: attackerCookie,
        ...(await signedMutationHeaders(attacker, compilePath, compileBody, "attack-compile-1"))
      }),
      "global anonymous cookie + attacker key": firstPartyPost(compilePath, compileBody, {
        Cookie: globalCookie,
        ...(await signedMutationHeaders(attacker, compilePath, compileBody, "attack-compile-2"))
      }),
      "victim anonymous_id in the body only": firstPartyPost(compilePath, JSON.stringify({ intent_version: victimBefore?.intent_version, anonymous_id: victimAnonymousId }), {
        "Idempotency-Key": "attack-compile-3"
      })
    };
    for (const [name, request] of Object.entries(mutations)) {
      const response = await world.handle(request);
      expect(SCOPED_MUTATION_REFUSALS, name).toContain(JSON.stringify([response.status, (denial(response).error as { code: string }).code]));
      expect(response.headers.getSetCookie(), name).toEqual([]);
    }
    expect(db.statements).toHaveLength(statementsBefore);
    expect(db.intents.get(victim.intentId)).toEqual(victimBefore);

    const attackerProof = await readProofBy(attacker, victim.intentId, victim.contentHash);
    const victimGrantPath = grantUrl(victim.intentId, victim.contentHash);
    const reads: Record<string, () => Promise<RawResponse>> = {
      "grant with attacker scoped cookie + attacker key": () => world.get(victimGrantPath, { "Sec-Fetch-Site": "same-origin", Cookie: attackerCookie, ...attackerProof }),
      "grant with global anonymous cookie + attacker key": () => world.get(victimGrantPath, { "Sec-Fetch-Site": "same-origin", Cookie: globalCookie, ...attackerProof }),
      "body with the victim's own continuity cookie instead of a grant": () =>
        world.get(`/b/${victim.contentHash}`, { "Sec-Fetch-Site": "same-origin", Cookie: victim.browser.cookieFor(grantPathOf(victim.intentId)) })
    };
    for (const [name, read] of Object.entries(reads)) {
      expect({ name, ...denial(await read()) }).toEqual({ name, ...UNIFORM_NOT_FOUND });
    }
    expect((await world.get(victimGrantPath, await world.grantHeaders(victim))).status).toBe(200);
  });
});
