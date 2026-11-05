# AGENTS.md — qeet-id-nextjs

**The model-neutral instruction file for coding agents.** [CLAUDE.md](CLAUDE.md),
[GEMINI.md](GEMINI.md) and [.github/copilot-instructions.md](.github/copilot-instructions.md) point
here and add nothing architectural.

## What this repository is

**Qeet ID for Next.js**, `@qeet-id/nextjs`: the server side of the session contract for a Next.js 16 App
Router app (the session routes, an encrypted cookie session, renewal, the proxy, server helpers) and a
client entry re-exporting `@qeet-id/react`. Node.js 22.12 or later, bun and Biome, TypeScript 7, an ES
module package built by tsdown. Depends on `@qeet-id/node` and `@qeet-id/react`; `next` and `react` are
peers.

It implements two contracts it does not own:

- **The session contract**: `@qeet-id/react`'s `docs/session-contract.md` and `src/contract.ts`
  (`@qeet-id/react/contract`), imported here, never copied.
- **Qeet ID's API**: `qeet-id-server`'s `api/openapi/{federation,auth,management}.yaml`, with its handlers
  (`internal/federation/oidc/`) as the tiebreaker. Never send a parameter the server doesn't take.

## Read before changing code

| File | For |
| --- | --- |
| [qeet-repo.yml](qeet-repo.yml) | Machine-readable identity |
| [docs/llm/architecture-map.md](docs/llm/architecture-map.md) | "Where is X?" |
| [docs/llm/context.md](docs/llm/context.md) | How this package works |
| [docs/llm/boundaries.md](docs/llm/boundaries.md) | What it owns, and what it must not touch |
| [docs/llm/workflows.md](docs/llm/workflows.md) | Common changes; releasing |
| [docs/engineering-practices.md](docs/engineering-practices.md) | The practices followed, with sources |

Decisions: `docs/design-decisions/` (ADR-0001 to ADR-0004), all binding.

## Rules

1. **Tokens never reach the browser**: not in the session JSON, an error, a log or a redirect URL (the ID
   token in the end-session address is the one exception the protocol needs).
2. **Renew only where the cookie can be written** (ADR-0003): the proxy, `GET {base}/session`, and
   `getAccessToken()` when Next.js lets it set cookies. Never in `getSession()` or a Server Component render.
   Qeet ID ends the grant when a refresh token is used twice.
3. **Every POST checks CSRF** (`X-Qeet-ID-Request: 1`, `Sec-Fetch-Site` not `cross-site`). No state change on
   GET. Never answer the session routes with CORS headers.
4. **Every return path goes through `safeReturnTo`**; redirects are built on `QEET_ID_APP_URL`, never on the
   request's `Host`.
5. **Never weaken** `src/session/crypto.ts` (AES-256-GCM, HKDF, purpose as AAD), the callback's checks in
   `src/oidc.ts` (state, issuer, signature, audience, nonce) or the cookie attributes in `src/session/`.
6. **The server entry imports `server-only`; only `src/client/provider.tsx` is `"use client"`.** The client
   entry stays a plain re-export.
7. **Errors** extend `QeetIDError` from `@qeet-id/node` with a stable `code`; the routes answer the
   contract's `{ "error": { "code", "message" } }` and never leak a cause.
8. **New exports** go through `src/index.ts` or `src/client/index.ts`, and `test/package.test.ts` lists them.

## Commands

```bash
bun install
bun run verify          # typecheck (the example too) + Biome + tests + build + publint + attw — the gate
bun run build           # tsdown
bun run test            # vitest run
bun run typecheck       # tsc --noEmit, then the example with a Next.js app's settings
bun run check           # Biome lint and format check
bun run check:package   # publint --strict && attw --pack . --profile esm-only
```

Also `bun run dev`, `bun run test:watch`, `bun run test:coverage`, `bun run lint`, `bun run lint:fix`,
`bun run format`.

Until `@qeet-id/node` and `@qeet-id/react` are on npm, `package.json`'s `resolutions` link them by name:
build and `bun link` each first (see CONTRIBUTING.md).

## What CI enforces

`ci.yml` on Node.js 22, 24 and 26: install, typecheck, build, tests with coverage, package checks.
`lint.yml`: `bun run check`. `security.yml`: `bun audit --audit-level=high` and gitleaks. `codeql.yml`.
Each builds and links the two Qeet ID packages first (`.github/actions/link-qeet-id-packages`).
`version.yml` bumps the patch in `package.json` on every pull request into `main` (raise minor or major by
hand). `release.yml` runs on every push to `main`: when that version is not on npm yet, it runs the gate,
publishes with provenance, then tags `vX.Y.Z` and opens a GitHub Release; otherwise it does nothing.
`rollback.yml` points the npm `latest` dist-tag back at an earlier version.
While the two packages are linked, `release.yml` waits and publishes nothing.

## Branches

Two long-lived branches: `develop`, where work lands, and `main`, what is released. Changes reach
`main` only by a pull request from `develop`. There are no release branches: a version is a
`vX.Y.Z` tag, made by `release.yml` when a pull request is merged into `main`.

## Before you finish

```bash
bun run verify
git diff
```

## Escalate rather than proceed

A change to the session contract (it is `@qeet-id/react`'s) · weakening a check or a cookie attribute ·
renewing somewhere new · a new runtime dependency · renaming or removing an export · anything requiring
another repository · the package name, licence or first published version.
