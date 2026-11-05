# Architecture Map — qeet-id-nextjs

**Level:** L2 · **Last verified:** 2026-11-05
**Verification scope:** every path below was confirmed to exist.

| Need | Path |
| --- | --- |
| Repository identity | [`qeet-repo.yml`](../../qeet-repo.yml) |
| Agent instructions | [`AGENTS.md`](../../AGENTS.md) |
| **Server exports — the package's contract** | `src/index.ts` |
| **Client exports** | `src/client/index.ts` (re-exports `@qeet-id/react`) |
| `createQeetID` and the `QeetIDNext` instance | `src/qeet-id.ts` |
| Settings, environment variables, `ConfigurationError` problems | `src/config.ts` |
| Error classes | `src/errors.ts` |
| Version constant | `src/version.ts` (a test keeps it equal to `package.json`) |

## Session routes and Qeet ID

| Concern | Path |
| --- | --- |
| **The six routes, CSRF, the error envelope, `Set-Cookie`** | `src/routes.ts` |
| **Discovery, the authorization URL, code exchange, ID token, renewal, revocation, end-session URL, lookups** | `src/oidc.ts` |
| The proxy and `protect` | `src/proxy.ts` |
| `getSession`, `requireSession`, `getAccessToken` | `src/server.ts` |
| The provider wrapper (`"use client"`) | `src/client/provider.tsx` |

## Session cookie

| Concern | Path |
| --- | --- |
| **AES-256-GCM seal and unseal, HKDF keys, rotation** | `src/session/crypto.ts` |
| Cookie names, attributes, chunking, `Cookie` header parsing | `src/session/cookies.ts` |
| The stored session, the pending sign-in, `toSession` | `src/session/store.ts` |

## Build, test, CI

| | |
| --- | --- |
| Scripts | `package.json` |
| Build config | `tsdown.config.ts` — ES module, one file per module, declarations, target node22 |
| Compiler config | `tsconfig.json` (`nodenext`, strict, `isolatedDeclarations`); `examples/app-router/tsconfig.json` (a Next.js app's settings) |
| Tests | `test/` — vitest |
| **Fake Qeet ID** | `test/helpers/fake-qeet-id.ts` |
| A browser's cookie jar, sign-in helper | `test/helpers/browser.ts` |
| Example app | `examples/app-router/` (type-checked) |
| CI | `.github/workflows/{ci,lint,security,codeql,release}.yml`; `.github/actions/link-qeet-id-packages/` |

## Decisions

| ADR | Decision |
| --- | --- |
| `docs/design-decisions/ADR-0001-route-handler-not-proxy-mounted.md` | The routes are a Route Handler; the proxy is optional |
| `docs/design-decisions/ADR-0002-encrypted-cookie-session.md` | A stateless session sealed with AES-256-GCM |
| `docs/design-decisions/ADR-0003-renew-where-the-cookie-can-be-written.md` | Renew only where the cookie is written, once per refresh token |
| `docs/design-decisions/ADR-0004-es-module-only.md` | ES module only |

## Upstream

The session contract lives in **`qeet-id-react`**: `docs/session-contract.md` and `src/contract.ts`.
Qeet ID's API lives in **`qeet-id-server`**: `api/openapi/*.yaml` and `internal/federation/oidc/`.
Neither is vendored here.
