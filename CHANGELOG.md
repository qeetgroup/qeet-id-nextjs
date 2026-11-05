# Changelog

All notable changes to Qeet ID for Next.js are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`createQeetID(options?)`**: Qeet ID for the app, from `QEET_ID_*` environment variables with options
  overriding them. A missing or invalid setting throws one `ConfigurationError` listing every problem; during
  `next build` it waits for the first request.
- **The session routes**, as `@qeet-id/react`'s session contract defines them, in one Route Handler
  (`export const { GET, POST } = qeetId.handlers`) under `basePath` (default `/auth`):
  - `GET sign-in` and `sign-up`: the authorization code request with PKCE S256, `state` and `nonce`;
    `returnTo` checked with `safeReturnTo`. `organization` and `loginHint` are accepted and not sent: Qeet ID's
    authorization endpoint has no such parameters.
  - `GET callback`: the `state` against its own sign-in cookie, the issuer (RFC 9207), the code exchange, and
    the ID token's ES256 signature, issuer, audience, expiry and nonce. A failure comes back as `?authError=`.
  - `GET session`: `{ session }`, renewing the access token a minute before it expires; `{ session: null }`
    when Qeet ID refuses; `503 session_unavailable` only when the token has expired and Qeet ID can't be reached.
  - `POST sign-out`: revokes the refresh token, clears the cookie and answers Qeet ID's end-session address
    with `id_token_hint`; an optional `returnTo` rides in `state`.
  - `POST switch-organization`: the session when it is already in that organisation, otherwise
    `501 organization_switch_unavailable`, since Qeet ID can't move an application's session.
  - The CSRF header `X-Qeet-ID-Request: 1` on every POST, `Sec-Fetch-Site: cross-site` refused,
    `Cache-Control: no-store` on every answer, the contract's error envelope, `405` with `Allow`.
- **The session cookie**: AES-256-GCM through Web Crypto with HKDF-derived keys, `__Host-Http-` prefixed,
  `Secure`, `HttpOnly`, `SameSite=Lax`; split into chunks only when large; a list of secrets for rotation;
  rolling for `sessionMaxAgeSeconds` (7 days) from each renewal.
- **Renewal** only where the cookie can be written (the proxy, the session route, Server Actions and Route
  Handlers), shared by requests carrying the same refresh token, so Qeet ID's refresh-token reuse detection
  never signs people out.
- **`qeetId.proxy({ protect })`** for `proxy.ts`: renews ahead of expiry and hands the new cookie to the same
  request's render; sends signed-out visitors of protected paths to sign in and back (`401` for other methods).
- **Server helpers:** `getSession()`, `requireSession({ returnTo? })` and `getAccessToken()` with
  `AccessTokenError` (`not_signed_in`, `session_ended`, `cookies_read_only`, `session_unavailable`).
- **The session's organisation name, roles and permissions** with `QEET_ID_API_KEY`, through `@qeet-id/node`.
- **`@qeet-id/nextjs/client`**: `@qeet-id/react` re-exported, with a `QeetIDProvider` that calls
  `router.refresh()` when the session changes.
- An App Router example, type-checked with the package.
