// Fail closed on an absent, malformed, or insecure Worker origin.
// A real Cloudflare staging origin must use HTTPS; HTTP is permitted only for
// Wrangler running on this computer. This value is never shipped to Browser.
export function parseWorkerOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APPF2_STAGING_WORKER_ORIGIN must be an absolute URL");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("APPF2_STAGING_WORKER_ORIGIN must use HTTPS or local Wrangler HTTP");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("APPF2_STAGING_WORKER_ORIGIN must contain an origin only (no credentials/path/query)");
  }
  return url.origin;
}
