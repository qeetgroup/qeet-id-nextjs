# Boundaries — qeet-id-nextjs

**Level:** L2 · **Last verified:** 2026-11-05

## Owns

The server side of the session contract for Next.js: the six session routes, the encrypted session and
sign-in cookies, renewal, the proxy, the server helpers, the App Router provider wrapper, the ES module
build.

## Does not own

| Not owned | Owner |
| --- | --- |
| **The session contract** (routes, JSON, errors, CSRF header, `safeReturnTo`) | `qeet-id-react` — `docs/session-contract.md`, `src/contract.ts` |
| The provider, hooks and components | `qeet-id-react` |
| Qeet ID's API, tokens, sign-in, organisations | `qeet-id-server` |
| HTTP to Qeet ID, token verification, the management calls | `qeet-id-node` |
| The same for TanStack Start | `qeet-id-tanstack` |
| Organization / product standards | `qeet-context` (L0) / `qeet-id-context` (L1) |

**This package never adds behaviour Qeet ID lacks.** A missing parameter or flow is server work, and the
contract records it as reserved.

## Consumes

Qeet ID over HTTPS, through `@qeet-id/node`: discovery and JWKS, `/v1/oauth/token-code` (authorization code
and refresh grants, `client_secret_post`), `/oauth/revoke`, the end-session address (browser navigation), and
with an API key `GET /v1/tenants/{id}` and `GET /v1/users/{id}/tenants/{id}/permissions`. Next.js's
`next/server`, `next/headers` and `next/navigation`.

## Provides

An npm package whose exports in **`src/index.ts`** and **`src/client/index.ts`** are its contract, and the
six HTTP routes of the session contract.

## Security boundaries

| Boundary | Enforcement |
| --- | --- |
| Tokens → browser | never: `toSession` in `src/session/store.ts` builds the browser's view without them |
| Cookie → session | `src/session/crypto.ts` — AES-256-GCM, purpose as AAD; anything else is cleared |
| Callback → session | `src/routes.ts` and `src/oidc.ts` — state cookie, issuer, code with PKCE, ID token signature, audience, nonce |
| Browser POST → action | `src/routes.ts` — `X-Qeet-ID-Request: 1`, `Sec-Fetch-Site` not `cross-site` |
| `returnTo` → redirect | `safeReturnTo` on `QEET_ID_APP_URL`'s origin |
| Renewal → refresh token | `src/oidc.ts` and `src/server.ts` — only where the cookie is written; shared per token |

## Requires coordination

| Change | Why |
| --- | --- |
| **A route's shape, an error code, the CSRF header** | It is `@qeet-id/react`'s contract, shared with `@qeet-id/tanstack` |
| **Any name in `src/index.ts` or `src/client/index.ts`** | The package's public contract |
| Cookie name or format | Existing sessions end |
| Default scopes | Depends on the application's registered grants |
| The Node.js or Next.js floor | Affects who can install |

## Hard limits

1. **Never send a token to the browser**, or log one.
2. **Never renew where the cookie can't be written.**
3. **Never skip a callback check**, even in tests.
4. **Never answer the session routes with CORS headers.**
5. **Never redirect to an unchecked path.**
6. **Never change another repository** from a task scoped to this one.
