import { isUuid } from "../platform/evidence/evidence-validator.js";
import { decodeBase64Url, encodeBase64Url } from "./create-proof.js";

/**
 * F01-API-ID-001 trusted request context: one HttpOnly cookie per intent, bound to the intent ID, the
 * anonymous continuity correlation and the PoP key thumbprint that created it. anonymous_id stays a
 * continuity correlation (F07), never an authentication or ownership claim.
 */
export const INTENT_CONTINUITY_COOKIE = "__Secure-appf2.intent.v1";
export const INTENT_CONTINUITY_MAX_AGE_SECONDS = 60 * 60 * 24;

const TOKEN_VERSION = "v1";
const PURPOSE = "F01_INTENT_CONTINUITY";
const MAC_DOMAIN = "APPF2_INTENT_COOKIE_V1.";
const MIN_SECRET_LENGTH = 32;
const MAX_TOKEN_CHARS = 1024;
const MAX_PAYLOAD_CHARS = 640;
const HMAC_SHA256_BYTES = 32;
const MAX_ISSUE_SKEW_SECONDS = 90;
const THUMBPRINT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

export interface IntentContinuityClaims {
  readonly intentId: string;
  readonly anonymousId: string;
  readonly keyThumbprint: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Fails before any F01 side effect so a misconfigured Worker never commits a CREATE it cannot bind. */
export function assertContinuitySecret(secret: unknown): asserts secret is string {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("Trusted identity signing secret is not configured safely.");
  }
}

async function macKey(secret: string): Promise<CryptoKey> {
  assertContinuitySecret(secret);
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function macInput(payload: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${MAC_DOMAIN}${payload}`);
}

export function intentContinuityCookiePath(intentId: string): string {
  return `/api/v1/intents/${intentId}/`;
}

/** Exactly one cookie with our name; duplicates (e.g. tossed from a sibling host) are treated as no context. */
function singleCookieValue(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  let found: string | null = null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== INTENT_CONTINUITY_COOKIE) continue;
    if (found !== null) return null;
    found = part.slice(separator + 1).trim();
  }
  return found;
}

function parseClaims(payload: Uint8Array<ArrayBuffer>): IntentContinuityClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 7) return null;
  const [version, purpose, intentId, anonymousId, thumbprint, issuedAt, expiresAt] = parsed as unknown[];
  if (
    version !== TOKEN_VERSION ||
    purpose !== PURPOSE ||
    !isUuid(intentId) ||
    !isUuid(anonymousId) ||
    typeof thumbprint !== "string" ||
    !THUMBPRINT_PATTERN.test(thumbprint) ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt)
  ) {
    return null;
  }
  return { intentId, anonymousId, keyThumbprint: thumbprint, issuedAt: issuedAt as number, expiresAt: expiresAt as number };
}

/** Verifies MAC before parsing, then purpose / exact intent / lifetime. Any deviation is "no trusted context". */
export async function readIntentContinuity(
  cookieHeader: string | null,
  intentId: string,
  secret: string,
  nowMs: number
): Promise<IntentContinuityClaims | null> {
  const token = singleCookieValue(cookieHeader);
  if (token === null || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, mac] = parts as [string, string];
  const macBytes = decodeBase64Url(mac, 64);
  const payloadBytes = decodeBase64Url(payload, MAX_PAYLOAD_CHARS);
  if (macBytes?.byteLength !== HMAC_SHA256_BYTES || payloadBytes === null) return null;
  if (!(await crypto.subtle.verify("HMAC", await macKey(secret), macBytes, macInput(payload)))) return null;
  const claims = parseClaims(payloadBytes);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    claims === null ||
    claims.intentId !== intentId ||
    claims.expiresAt <= nowSeconds ||
    claims.issuedAt > nowSeconds + MAX_ISSUE_SKEW_SECONDS ||
    claims.expiresAt - claims.issuedAt > INTENT_CONTINUITY_MAX_AGE_SECONDS
  ) {
    return null;
  }
  return claims;
}

export async function intentContinuityCookie(
  binding: Pick<IntentContinuityClaims, "intentId" | "anonymousId" | "keyThumbprint">,
  secret: string,
  nowMs: number
): Promise<string> {
  if (!isUuid(binding.intentId) || !isUuid(binding.anonymousId) || !THUMBPRINT_PATTERN.test(binding.keyThumbprint)) {
    throw new Error("Cannot bind an invalid intent continuity context.");
  }
  const issuedAt = Math.floor(nowMs / 1000);
  const claims = [TOKEN_VERSION, PURPOSE, binding.intentId, binding.anonymousId, binding.keyThumbprint, issuedAt, issuedAt + INTENT_CONTINUITY_MAX_AGE_SECONDS];
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await macKey(secret), macInput(payload)));
  return [
    `${INTENT_CONTINUITY_COOKIE}=${payload}.${encodeBase64Url(mac)}`,
    `Path=${intentContinuityCookiePath(binding.intentId)}`,
    `Max-Age=${INTENT_CONTINUITY_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax"
  ].join("; ");
}
