import { isUuid } from "../platform/evidence/evidence-validator.js";
import { decodeBase64Url, encodeBase64Url } from "./create-proof.js";
import { macKey } from "./server-identity.js";

/**
 * F01-API-ID-001B `intent_blueprint_access_grant`: server-signed, ≤60 s, bound to one intent, one content hash and the
 * PoP key thumbprint that proved original-holder authority. It is read / share-create authority only, never F03
 * execution admission. The anonymous continuity correlation travels inside so every read re-applies the same RLS
 * context; it carries no key, cookie or User content.
 */
export const BLUEPRINT_ACCESS_GRANT_TTL_SECONDS = 60;
export const BLUEPRINT_READ_AUDIENCE = "blueprint:read";
export const SHARE_CREATE_AUDIENCE = "share:create";
export const BLUEPRINT_GRANT_AUDIENCE = [BLUEPRINT_READ_AUDIENCE, SHARE_CREATE_AUDIENCE] as const;

const TOKEN_VERSION = "v1";
const PURPOSE = "F01_INTENT_BLUEPRINT_ACCESS_GRANT";
const MAC_DOMAIN = "APPF2_BLUEPRINT_ACCESS_GRANT_V1.";
const MAX_TOKEN_CHARS = 1024;
const MAX_PAYLOAD_CHARS = 720;
const HMAC_SHA256_BYTES = 32;
const MAX_ISSUE_SKEW_SECONDS = 90;
const THUMBPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_.-]+)$/u;
export const CONTENT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export interface BlueprintAccessGrantClaims {
  readonly intentId: string;
  readonly anonymousId: string;
  readonly contentHash: string;
  readonly keyThumbprint: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface IssuedBlueprintAccessGrant {
  readonly token: string;
  readonly claims: BlueprintAccessGrantClaims;
}

function macInput(payload: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${MAC_DOMAIN}${payload}`);
}

function sameAudience(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === BLUEPRINT_GRANT_AUDIENCE.length &&
    BLUEPRINT_GRANT_AUDIENCE.every((audience, index) => value[index] === audience)
  );
}

function parseClaims(payload: Uint8Array<ArrayBuffer>): BlueprintAccessGrantClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 9) return null;
  const [version, purpose, intentId, anonymousId, contentHash, thumbprint, audience, issuedAt, expiresAt] = parsed as unknown[];
  if (
    version !== TOKEN_VERSION ||
    purpose !== PURPOSE ||
    !isUuid(intentId) ||
    !isUuid(anonymousId) ||
    typeof contentHash !== "string" ||
    !CONTENT_HASH_PATTERN.test(contentHash) ||
    typeof thumbprint !== "string" ||
    !THUMBPRINT_PATTERN.test(thumbprint) ||
    !sameAudience(audience) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return null;
  }
  return { intentId, anonymousId, contentHash, keyThumbprint: thumbprint, issuedAt: issuedAt as number, expiresAt: expiresAt as number };
}

export async function issueBlueprintAccessGrant(
  binding: Pick<BlueprintAccessGrantClaims, "intentId" | "anonymousId" | "contentHash" | "keyThumbprint">,
  secret: string,
  nowMs: number
): Promise<IssuedBlueprintAccessGrant> {
  if (
    !isUuid(binding.intentId) ||
    !isUuid(binding.anonymousId) ||
    !CONTENT_HASH_PATTERN.test(binding.contentHash) ||
    !THUMBPRINT_PATTERN.test(binding.keyThumbprint)
  ) {
    throw new Error("Cannot issue a Blueprint access grant for an invalid binding.");
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const claims: BlueprintAccessGrantClaims = { ...binding, issuedAt, expiresAt: issuedAt + BLUEPRINT_ACCESS_GRANT_TTL_SECONDS };
  const wire = [
    TOKEN_VERSION,
    PURPOSE,
    claims.intentId,
    claims.anonymousId,
    claims.contentHash,
    claims.keyThumbprint,
    BLUEPRINT_GRANT_AUDIENCE,
    claims.issuedAt,
    claims.expiresAt
  ];
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(wire)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(secret), macInput(payload)));
  return { token: `${payload}.${encodeBase64Url(mac)}`, claims };
}

/**
 * Verifies MAC before parsing, then exact hash, audience and short lifetime on every use. A missing, malformed,
 * foreign-hash or expired grant is "no authority"; it never falls back to a client UUID.
 */
export async function readBlueprintAccessGrant(
  authorization: string | null,
  contentHash: string,
  secret: string,
  nowMs: number
): Promise<BlueprintAccessGrantClaims | null> {
  const token = splitBearerToken(authorization);
  if (token === null) return null;
  const macBytes = decodeBase64Url(token.mac, 64);
  const payloadBytes = decodeBase64Url(token.payload, MAX_PAYLOAD_CHARS);
  if (macBytes?.byteLength !== HMAC_SHA256_BYTES || payloadBytes === null) return null;
  if (!(await crypto.subtle.verify("HMAC", await macKey(secret), macBytes, macInput(token.payload)))) return null;
  const claims = parseClaims(payloadBytes);
  return claims !== null && claims.contentHash === contentHash && withinLifetime(claims, Math.floor(nowMs / 1000)) ? claims : null;
}

function splitBearerToken(authorization: string | null): { readonly payload: string; readonly mac: string } | null {
  const token = authorization === null || authorization.length > MAX_TOKEN_CHARS + 7 ? undefined : BEARER_PATTERN.exec(authorization)?.[1];
  const parts = token?.split(".") ?? [];
  return parts.length === 2 ? { payload: parts[0] as string, mac: parts[1] as string } : null;
}

function withinLifetime(claims: BlueprintAccessGrantClaims, nowSeconds: number): boolean {
  return (
    claims.expiresAt > nowSeconds &&
    claims.issuedAt <= nowSeconds + MAX_ISSUE_SKEW_SECONDS &&
    claims.expiresAt - claims.issuedAt <= BLUEPRINT_ACCESS_GRANT_TTL_SECONDS
  );
}
