# Engineering practices

The practices this package follows, and where each comes from. Researched on 5 November 2026, against
Next.js 16.4 and React 19.3. When a practice changes, change it here first and record why.

## The model

| Practice | How this package applies it | Source |
| --- | --- | --- |
| Backend for frontend | The app's server is a **confidential** OAuth client: it exchanges the code, keeps the tokens in an encrypted, HttpOnly cookie and tells the browser only who is signed in. The browser never holds a token and never calls Qeet ID | [RFC 10017 (BCP 212) §6.1](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1), OAuth 2.0 for Browser-Based Applications |
| One contract with the browser SDK | The six routes, their JSON, errors, CSRF header and return-path rule are `@qeet-id/react`'s `docs/session-contract.md` and `@qeet-id/react/contract`, imported, not copied | `qeet-id-react` `docs/session-contract.md` |
| Authorization code with PKCE S256, `state` and `nonce` | A fresh 256-bit `state`, `nonce` and verifier per sign-in; the challenge is S256 | [RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700#section-2.1.1) (OAuth 2.0 Security BCP); [RFC 7636](https://www.rfc-editor.org/rfc/rfc7636); the server requires S256 (`internal/federation/oidc/pkce.go`) |
| Mix-up defence | The callback's `iss` must equal the discovery document's `issuer`, and is required because Qeet ID advertises `authorization_response_iss_parameter_supported` | [RFC 9207 §2.4](https://www.rfc-editor.org/rfc/rfc9207#section-2.4) |
| ID token validation | At sign-in: ES256 signature against the JWKS, `iss`, `aud` (and `azp` with several audiences), `exp`, `iat`, then `nonce`, with `@qeet-id/node`'s `TokenVerifier`. On renewal the ID token comes straight from the token endpoint over TLS, so its claims are read without fetching keys, and must name the same `sub` and audience | [OpenID Connect Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation), [§12.2](https://openid.net/specs/openid-connect-core-1_0.html#RefreshTokenResponse) |
| Sign-out ends Qeet ID's session too | Revoke the refresh token, clear the cookie, then send the browser to `end_session_endpoint` with `id_token_hint`, `client_id` and the registered `post_logout_redirect_uri` | [RFC 7009](https://www.rfc-editor.org/rfc/rfc7009); [OpenID Connect RP-Initiated Logout](https://openid.net/specs/openid-connect-rpinitiated-1_0.html) |
| Never add behaviour the server lacks | `organization` and `loginHint` are accepted and not sent; sign-up starts the same request as sign-in; switching organisation answers `501` | the contract's "What Qeet ID provides"; the server's authorize handler takes no such parameters |

## Next.js

| Practice | How | Source |
| --- | --- | --- |
| App Router only | A catch-all Route Handler serves the routes; Server Components, Server Actions and Route Handlers read the session. No Pages Router: every helper here is App Router API | [Next.js: Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route); [Authentication guide](https://nextjs.org/docs/app/guides/authentication) |
| `proxy.ts`, optional | `qeetId.proxy()` renews sessions and does the optimistic redirect; it is a first check, and `requireSession()` is the one next to the data. Proxy defaults to the Node.js runtime, which `@qeet-id/node` needs | [Next.js: proxy.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) (middleware renamed in 16.0; "Always verify authentication and authorization inside each Server Function rather than relying on Proxy alone") |
| Cookies are written only where Next.js allows | `cookies().set` works in Server Functions and Route Handlers and throws in Server Components; renewal, which rotates the refresh token, happens only where the new cookie can be stored | [Next.js: cookies](https://nextjs.org/docs/app/api-reference/functions/cookies) |
| Forward renewed cookies to the render | The proxy passes the new `Cookie` header with `NextResponse.next({ request: { headers } })`, so the same request's Server Components see the renewed session | [Next.js: proxy.js, setting headers](https://nextjs.org/docs/app/api-reference/file-conventions/proxy#setting-headers) |
| A data access layer | `getSession()` is memoised per render with React's `cache`; `requireSession()` is meant for each page, Server Action and Route Handler. Layouts don't re-render on navigation, so they aren't the place for the check | [Next.js: Authentication, DAL](https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal) |
| Cache Components | Reading the session reads `cookies()`: a request-time read that belongs behind `<Suspense>` (or `"use cache: private"`), never in a plain `"use cache"` scope | [Next.js: Authentication with Cache Components](https://nextjs.org/docs/app/guides/authentication-with-cache-components) |
| `server-only` and `"use client"` | The server entry imports `server-only`; only the provider wrapper is `"use client"`. The client entry stays plain, as `@qeet-id/react`'s does, so `QeetIDError`, `VERSION` and the types import into Server Components | [Next.js: Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) ("Advice for library authors"; "Preventing environment poisoning") |
| `initialSession` from the server | The root layout passes `await qeetId.getSession()` to the provider: no flash, no request on load. `router.refresh()` after a session change re-renders Server Components | `@qeet-id/react`'s `QeetIDProviderProps`; WorkOS AuthKit's `initialAuth` |

## Shapes of comparable SDKs

| SDK | What we took | What we didn't |
| --- | --- | --- |
| [`@auth0/nextjs-auth0`](https://github.com/auth0/nextjs-auth0) v4 | An instance made once (`new Auth0Client()` → `createQeetID()`), env vars with option overrides, routes under `/auth`, encrypted cookie sessions with a secret | Mounting the routes in middleware: ours are a Route Handler, so the proxy stays optional |
| [`@workos-inc/authkit-nextjs`](https://github.com/workos/authkit-nextjs) | Proactive renewal in the proxy about a minute before expiry; a request that can't renew proceeds while the token lasts; `initialAuth` for the provider; `no-store` on authenticated responses | `getSignInUrl()` in render; organisation switching (Qeet ID can't) |
| [Clerk `@clerk/nextjs`](https://clerk.com/docs/reference/nextjs/clerk-middleware) | A protect option in the proxy; redirect for page requests, an error for other methods | Route matchers as a separate helper (Clerk deprecated `createRouteMatcher`) |

## Cookies and sessions

| Practice | How | Source |
| --- | --- | --- |
| `Secure`, `HttpOnly`, `Path=/`, no `Domain`, a prefix | `__Host-Http-qeet-id-session` over https (Chrome 140+ and Firefox 143+ enforce `__Host-Http-`; others still enforce `__Host-`); no prefix on plain-http localhost, where browsers can't use one | [RFC 10017 §6.1.3.2](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.2); [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); [caniuse: `__Http-` prefixes](https://caniuse.com/mdn-http_headers_set-cookie_http_host-http_prefixes) |
| `SameSite=Lax`, not `Strict` | The callback and the page it redirects to are a navigation that started on Qeet ID's site, which a `Strict` cookie doesn't reach. CSRF is covered by the custom header instead (below) | the contract's security rules; RFC 10017 §6.1.3.3.2 |
| Authenticated encryption | AES-256-GCM, a fresh 96-bit IV per value, 128-bit tag; keys from each secret with HKDF-SHA-256; the cookie's purpose as additional data | [NIST SP 800-38D](https://csrc.nist.gov/pubs/sp/800/38/d/final); [RFC 5869](https://www.rfc-editor.org/rfc/rfc5869) |
| Secret rotation | `QEET_ID_SECRET` takes a list: the first encrypts, all decrypt | the same pattern as `@qeet-id/node`'s webhook secrets |
| Stay under browser limits | Values over 3800 characters are split into `name.0`, `name.1`, …; stale chunks are deleted on every write | [RFC 6265 §6.1](https://www.rfc-editor.org/rfc/rfc6265#section-6.1) (at least 4096 bytes per cookie) |
| Bounded lifetime | 7 days without renewal by default, at most 400 days | [draft-ietf-httpbis-rfc6265bis §5.5](https://datatracker.ietf.org/doc/draft-ietf-httpbis-rfc6265bis/) (lifetimes capped at 400 days) |
| One pending sign-in per cookie | Each sign-in's `state`, `nonce` and verifier live in a cookie named by its `state`, sent only to the callback, for 10 minutes; sign-ins in two tabs don't collide | [RFC 9700 §4.7](https://www.rfc-editor.org/rfc/rfc9700#section-4.7) (CSRF on the redirect URI) |
| Rotated refresh tokens are used once | Qeet ID ends the grant when a refresh token is used twice. Renewals carrying the same refresh token share one call in a process, and its answer is reused for 30 s | [RFC 9700 §4.14.2](https://www.rfc-editor.org/rfc/rfc9700#section-4.14.2); the server's `RefreshToken` (`internal/federation/oidc/token.go`) |

## Requests from the browser

| Practice | How | Source |
| --- | --- | --- |
| CSRF on every POST | `X-Qeet-ID-Request: 1` is required (a custom header forces a CORS preflight, which these routes never answer), and `Sec-Fetch-Site: cross-site` is refused | [RFC 10017 §6.1.3.3.2](https://www.rfc-editor.org/rfc/rfc10017.html#section-6.1.3.3.2); [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) (custom request headers; Fetch Metadata) |
| No state change on GET | Sign-out and switching organisation are POST only | OWASP CSRF Prevention ("Do not use GET requests for state changing operations") |
| No open redirects | Every `returnTo` goes through the contract's `safeReturnTo`; redirects use its result on the configured origin, never the input or the request's `Host` | [OWASP Unvalidated Redirects and Forwards](https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html) |
| `Cache-Control: no-store` | On every session-route answer, redirects included, and `private, no-store` on a proxy response that sets a cookie | the contract; WorkOS AuthKit (`no-store` and `Vary: Cookie` on authenticated responses) |
| Errors never leak causes | `500 internal_error` with a fixed message; Qeet ID's OAuth `error` is passed on only when it is a plain code | the contract's error shape |

## Configuration and errors

| Practice | How | Source |
| --- | --- | --- |
| Environment first, options override | `QEET_ID_*` variables; every one also an option of `createQeetID()` | Auth0 and WorkOS Next.js SDKs |
| Every problem at once | `ConfigurationError` lists every missing or invalid setting, naming the variable and the option. During `next build` (`NEXT_PHASE`) it waits for the first request, so builds without secrets work | [Azure SDK general guidelines](https://azure.github.io/azure-sdk/general_design.html) ("enough information … to take appropriate corrective action") |
| One error tree with `@qeet-id/node` | `ConfigurationError` and `AccessTokenError` extend its `QeetIDError`, with a stable `code` | `@qeet-id/node` ADR-0003 |
| https only, except this machine | Every URL setting must be https; plain http only for `localhost`, `*.localhost`, `127.0.0.1` and `[::1]` | `@qeet-id/node`'s `baseUrl` rule |

## Packaging

| Practice | How | Source |
| --- | --- | --- |
| ES module only | Next.js compiles ES modules natively, `@auth0/nextjs-auth0` and `@workos-inc/authkit-nextjs` ship ES modules only, and Node.js 22.12+ can `require()` one. See ADR-0004 | [Node.js: modules](https://nodejs.org/api/modules.html#loading-ecmascript-modules-using-require) |
| `next` and `react` as peers | `next ^16`, `react ^19`; `@qeet-id/node`, `@qeet-id/react` and `server-only` as dependencies | [npm: peerDependencies](https://docs.npmjs.com/cli/configuring-npm/package-json#peerdependencies) |
| Unflattened output, `sideEffects: false` | tsdown, one file per module, so each directive stays at the top of its own file | [tsdown](https://tsdown.dev/guide/); [rolldown: directives](https://rolldown.rs/in-depth/directives) |
| Strict compiler settings | `strict`, `module: nodenext`, `isolatedDeclarations`, `verbatimModuleSyntax`; `next/server.js` style imports, since `next` has no `exports` map | [TypeScript: choosing compiler options](https://www.typescriptlang.org/docs/handbook/modules/guides/choosing-compiler-options.html) |
| Package checks before publishing | `publint --strict` and `attw --pack . --profile esm-only` in `bun run verify` | [publint rules](https://publint.dev/rules); [Are the Types Wrong?](https://github.com/arethetypeswrong/arethetypeswrong.github.io) |
| Supported runtimes | `engines.node >=22.12.0` (as `@qeet-id/node`); CI on 22, 24 and 26 | [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) |
| Provenance, SemVer, a changelog | `publishConfig.provenance`; a Keep a Changelog `CHANGELOG.md` | [npm provenance](https://docs.npmjs.com/generating-provenance-statements); [semver.org](https://semver.org/spec/v2.0.0.html); [keepachangelog.com](https://keepachangelog.com/en/1.1.0/) |
