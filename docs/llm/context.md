# Repository Context — qeet-id-nextjs

**Level:** L2 · **Status:** active · **Evidence state:** verified · **Last verified:** 2026-11-05
**Verification scope:** exports, routes, cookies, renewal and CI read from source; Qeet ID's behaviour
checked against `qeet-id-server` (`fix/server-release-1.0`).

## Identity

`@qeet-id/nextjs` — Qeet ID for Next.js 16 App Router apps. Node.js 22.12 or later, bun, Biome,
TypeScript 7; an ES module package (`.mjs`, `.d.mts`) built by tsdown, one file per source module.

## Architecture

```text
browser (@qeet-id/react)          GET/POST {basePath}/*  ──►  qeetId.handlers (src/routes.ts)
                                                                  │
page / Server Action / Route Handler  ──►  getSession · requireSession · getAccessToken (src/server.ts)
proxy.ts  ──►  qeetId.proxy (src/proxy.ts): renew ahead of expiry, protect paths
                                                                  │
                          src/session/ (sealed cookies)   src/oidc.ts ──► @qeet-id/node ──► Qeet ID
```

`createQeetID(options)` (`src/qeet-id.ts`) reads the configuration (`src/config.ts`) and wires one
`SessionStore`, one `Oidc` and the handlers. During `next build` a configuration error waits for the first
request.

## The routes

`sign-in`/`sign-up` → authorize with PKCE S256, `state`, `nonce` (pending sign-in in its own cookie,
`Path` = the callback) · `callback` → state, issuer (RFC 9207), code exchange, ID token, session cookie,
redirect (`?authError=` on failure) · `session` → `{ session }`, renewing near expiry ·
`sign-out` → revoke, clear, end-session address · `switch-organization` → `501` unless already there.
POSTs need `X-Qeet-ID-Request: 1`. Errors are `{ error: { code, message } }`, `no-store`.

## The session

The cookie holds the access, refresh and ID tokens, the user's claims, the organisation, roles and
permissions, the access token's expiry and the session's `expiresAt`, sealed with AES-256-GCM. It rolls on
for `sessionMaxAgeSeconds` from each renewal; without a refresh token it ends with the access token.
Renewal: a minute before the access token expires, only where the cookie is written, one call per refresh
token per process (answers reused for 30 s).

## Qeet ID facts relied on

An application's tokens are always for its own organisation; its access token is accepted only by
`/v1/oauth/userinfo`; the authorize endpoint takes no organisation, login hint or sign-up hint; refresh
tokens rotate and a reuse ends the grant; the end-session endpoint takes `id_token_hint`. Details and file
references are in the session contract's "What Qeet ID provides".

## Testing

`test/` with vitest, against `test/helpers/fake-qeet-id.ts` (no network): session crypto and cookies,
configuration, every route (CSRF, return paths, errors), renewal (single-flight, reuse, outage, refusal),
the proxy (with `NextRequest`), the server helpers (with `next/headers` mocked), the provider wrapper, and
the package's exports and boundaries.

## Known constraints

- Concurrent renewals of one session in separate server instances can still trip Qeet ID's reuse detection
  (ADR-0003).
- Back-channel logout isn't handled: there is no server-side session store.

## Documentation authority

Source > tests > README > this file. The **session contract** is owned by `qeet-id-react`; the **API** by
`qeet-id-server`.
