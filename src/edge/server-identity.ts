import { isUuid } from "../platform/evidence/evidence-validator.js";

export const TRUSTED_ANONYMOUS_COOKIE = "appf2.trusted_anonymous.v1";
const TOKEN_VERSION = "v1";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("Trusted identity signing secret is not configured safely.");
  return crypto.subtle.importKey("raw", utf8(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function cookieValue(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === TRUSTED_ANONYMOUS_COOKIE) return rest.join("=");
  }
  return null;
}

export async function readTrustedAnonymousId(request: Request, secret: string): Promise<string | null> {
  const token = cookieValue(request.headers.get("cookie"));
  if (token === null) return null;
  const [version, anonymousId, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !isUuid(anonymousId) || signature === undefined) return null;
  const signatureBytes = fromBase64Url(signature);
  if (signatureBytes === null) return null;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(secret), signatureBytes, utf8(`${version}.${anonymousId}`));
  return valid ? anonymousId : null;
}

export async function trustedAnonymousCookie(anonymousId: string, secret: string): Promise<string> {
  if (!isUuid(anonymousId)) throw new Error("Cannot bind an invalid anonymous identity.");
  const payload = `${TOKEN_VERSION}.${anonymousId}`;
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(secret), utf8(payload)));
  const token = `${payload}.${base64Url(signature)}`;
  return `${TRUSTED_ANONYMOUS_COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}
