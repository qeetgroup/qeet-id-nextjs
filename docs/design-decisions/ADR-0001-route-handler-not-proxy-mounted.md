# ADR-0001: The session routes are a Route Handler, and the proxy is optional

**Status:** Accepted

## Context

The session routes (`sign-in`, `sign-up`, `callback`, `session`, `sign-out`, `switch-organization`)
must be served somewhere. `@auth0/nextjs-auth0` mounts its routes inside middleware, so an app without
middleware has none. Next.js 16 renamed middleware to `proxy` and asks apps to use it as a last resort;
a proxy also runs before every matched request, Server Functions included.

## Decision

One catch-all Route Handler serves every route: `app/auth/[...qeetid]/route.ts` exports
`qeetId.handlers`' `GET` and `POST`, which dispatch on the request's path under `basePath` (and on the
redirect URI's path, should a rewrite put the callback elsewhere). The routes work with no `proxy.ts`.

`qeetId.proxy()` is optional and does two things only: renew sessions ahead of expiry, and send
signed-out visitors of `protect`ed paths to sign in. It never serves the session routes and leaves
their paths alone. The secure check is `requireSession()` in the page, Server Action or Route Handler.

## Consequences

- An app adds one file to get the routes, and one more to get the proxy.
- Without the proxy, sessions are renewed by `GET {base}/session` (the provider asks on focus, on
  reconnect and at `expiresAt`) and by `getAccessToken()` in Server Actions and Route Handlers.
