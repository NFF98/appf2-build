declare const anonymousIdBrand: unique symbol;
declare const sessionIdBrand: unique symbol;

export type AnonymousId = string & { readonly [anonymousIdBrand]: true };
export type SessionId = string & { readonly [sessionIdBrand]: true };

export interface AnonymousCorrelationContext {
  readonly kind: "ANONYMOUS_CORRELATION";
  readonly anonymousId: AnonymousId;
  readonly securityAuthority: "NONE";
}

export interface BrowserSessionContext {
  readonly kind: "BROWSER_SESSION";
  readonly sessionId: SessionId;
  readonly securityAuthority: "NONE";
}

export function anonymousCorrelationContext(
  anonymousId: AnonymousId
): AnonymousCorrelationContext {
  return Object.freeze({
    kind: "ANONYMOUS_CORRELATION",
    anonymousId,
    securityAuthority: "NONE"
  });
}

export function browserSessionContext(sessionId: SessionId): BrowserSessionContext {
  return Object.freeze({
    kind: "BROWSER_SESSION",
    sessionId,
    securityAuthority: "NONE"
  });
}
