/**
 * First-party WebCrypto P-256 proof-of-possession for F01 intent mutations (server verifier only).
 *
 * Wire protocol v1 (frozen; the browser client must produce byte-identical transcripts):
 * - `X-Appf2-PoP-Key`: base64url (no padding) SubjectPublicKeyInfo of an uncompressed P-256 ECDSA key (91 bytes).
 * - `X-Appf2-PoP-Signature`: base64url (no padding) IEEE P1363 `r || s` ECDSA-SHA-256 signature (64 bytes).
 * - `X-Appf2-PoP-Timestamp`: client Unix epoch milliseconds as a decimal integer.
 * - Signed bytes: UTF-8 `JSON.stringify([POP_PROTOCOL_TAG, method, path, base64url(SHA-256(raw body)), Idempotency-Key, timestamp])`.
 * - CREATE with a proof must use `Idempotency-Key: appf2-create-v1.<thumbprint>` derived from the same key.
 *
 * A captured, fully signed request stays replayable inside the timestamp window; only F01 idempotency
 * bounds its side effects. This is not one-time anti-replay.
 */

export const POP_PROTOCOL_TAG = "APPF2_MUTATION_PoP_V1";
export const POP_KEY_HEADER = "X-Appf2-PoP-Key";
export const POP_SIGNATURE_HEADER = "X-Appf2-PoP-Signature";
export const POP_TIMESTAMP_HEADER = "X-Appf2-PoP-Timestamp";
export const RESERVED_CREATE_KEY_PREFIX = "appf2-create-v1.";
export const POP_MAX_CLOCK_SKEW_MS = 90_000;

const P256_SPKI_BYTES = 91;
const P1363_SIGNATURE_BYTES = 64;
const MAX_SPKI_CHARS = 128;
const MAX_SIGNATURE_CHARS = 88;
const TIMESTAMP_PATTERN = /^[1-9][0-9]{0,15}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

export interface MutationProofRequest {
  readonly method: string;
  readonly path: string;
  readonly body: Uint8Array<ArrayBuffer>;
  readonly idempotencyKey: string;
  readonly headers: Headers;
}

export interface VerifiedMutationProof {
  /** base64url SHA-256 over the exact SPKI DER bytes. */
  readonly keyThumbprint: string;
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Strict, canonical base64url: rejects padding, foreign alphabets, oversize input and non-zero trailing bits. */
export function decodeBase64Url(value: string, maxChars: number): Uint8Array<ArrayBuffer> | null {
  if (value.length === 0 || value.length > maxChars || value.length % 4 === 1 || !BASE64URL_PATTERN.test(value)) return null;
  let binary: string;
  try {
    binary = atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return encodeBase64Url(bytes) === value ? bytes : null;
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** BS-P1-025 F01-API-ID-001A item 2: `base64url(SHA256(public SPKI DER bytes))`, no domain tag. */
export async function keyThumbprint(spki: Uint8Array<ArrayBuffer>): Promise<string> {
  return encodeBase64Url(await sha256(spki));
}

export function reservedCreateIdempotencyKey(thumbprint: string): string {
  return `${RESERVED_CREATE_KEY_PREFIX}${thumbprint}`;
}

export async function mutationProofTranscript(
  request: Omit<MutationProofRequest, "headers">,
  timestampMs: number
): Promise<Uint8Array<ArrayBuffer>> {
  const bodyDigest = encodeBase64Url(await sha256(request.body));
  return new TextEncoder().encode(
    JSON.stringify([POP_PROTOCOL_TAG, request.method, request.path, bodyDigest, request.idempotencyKey, timestampMs])
  );
}

/** True when the request carries any proof header or claims the reserved CREATE key namespace. */
export function claimsMutationProof(headers: Headers, idempotencyKey: string | null): boolean {
  return (
    headers.has(POP_KEY_HEADER) ||
    headers.has(POP_SIGNATURE_HEADER) ||
    headers.has(POP_TIMESTAMP_HEADER) ||
    (idempotencyKey?.startsWith(RESERVED_CREATE_KEY_PREFIX) ?? false)
  );
}

function freshTimestamp(value: string | null, nowMs: number): number | null {
  if (value === null || !TIMESTAMP_PATTERN.test(value)) return null;
  const timestamp = Number(value);
  return Number.isSafeInteger(timestamp) && Math.abs(nowMs - timestamp) <= POP_MAX_CLOCK_SKEW_MS ? timestamp : null;
}

async function importP256(spki: Uint8Array<ArrayBuffer>): Promise<CryptoKey | null> {
  try {
    return await crypto.subtle.importKey("spki", spki, P256, false, ["verify"]);
  } catch {
    return null;
  }
}

/** Fail-closed verifier: any malformed, duplicated (comma-joined), stale or non-matching input returns null. */
export async function verifyMutationProof(request: MutationProofRequest, nowMs: number): Promise<VerifiedMutationProof | null> {
  const spki = decodeBase64Url(request.headers.get(POP_KEY_HEADER) ?? "", MAX_SPKI_CHARS);
  const signature = decodeBase64Url(request.headers.get(POP_SIGNATURE_HEADER) ?? "", MAX_SIGNATURE_CHARS);
  const timestamp = freshTimestamp(request.headers.get(POP_TIMESTAMP_HEADER), nowMs);
  if (spki?.byteLength !== P256_SPKI_BYTES || signature?.byteLength !== P1363_SIGNATURE_BYTES || timestamp === null) return null;
  const publicKey = await importP256(spki);
  if (publicKey === null) return null;
  const transcript = await mutationProofTranscript(request, timestamp);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(ECDSA_SHA256, publicKey, signature, transcript);
  } catch {
    return null;
  }
  return valid ? { keyThumbprint: await keyThumbprint(spki) } : null;
}
