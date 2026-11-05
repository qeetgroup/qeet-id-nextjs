# ADR-0003: Renew only where the cookie can be written, once per refresh token

**Status:** Accepted

## Context

Qeet ID rotates refresh tokens and treats a second use of one as theft: it refuses it and ends every
refresh token of that application for the person (`internal/federation/oidc/token.go`,
`RefreshToken` → `handleRefreshReuse`). There is no grace period.

A renewal that can't store the new refresh token leaves the old one in the cookie, so the next renewal
uses it twice and signs the person out. Next.js lets Route Handlers, Server Functions and the proxy
write cookies; Server Components can't. And browsers send requests in parallel (tabs, prefetches,
the provider's checks), each carrying the same cookie.

## Decision

1. Renewal (when the access token has less than 60 seconds left) happens only in `GET {base}/session`,
   the proxy, and `getAccessToken()` when Next.js lets it set cookies there. `getSession()` never
   renews. `getAccessToken()` in a Server Component hands out a still-valid token, and otherwise throws
   `AccessTokenError` `cookies_read_only`; it learns where it runs by setting the session cookie to the
   value it already has.
2. In a process, renewals carrying the same refresh token share one call, and its answer is reused for
   30 seconds (keyed by the token's SHA-256, never the token), so a late request with the old cookie
   gets the same new tokens. A refusal is shared too; an outage isn't, so the next request tries again.
3. The proxy hands the renewed cookie to the same request's render (`NextResponse.next({ request })`),
   so a page never renews again what its proxy just renewed.

## Consequences

- Requests that renew the same session at the same moment in **different** server instances can still
  trip Qeet ID's reuse detection. Qeet ID's server would fix that for every client with a short reuse
  interval (as RFC 9700 §4.14.2 discusses); this package can't without a shared store.
