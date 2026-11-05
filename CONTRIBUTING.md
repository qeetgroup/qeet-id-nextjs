# Contributing

## Setup

```bash
git clone https://github.com/qeetgroup/qeet-id-nextjs
cd qeet-id-nextjs
bun install
bun run verify   # typecheck (the example too) + Biome + tests + build + publint + attw
```

Requires Node.js 22.12 or later and bun (`packageManager` in `package.json`).

## Conventions

- **The contract is `@qeet-id/react`'s** (`docs/session-contract.md`, `@qeet-id/react/contract`). Import its
  types and helpers; never copy them. A change to a route's shape starts there.
- **Qeet ID decides what's possible.** Check `qeet-id-server`'s OpenAPI documents and handlers before relying
  on a parameter or claim; never send one it doesn't take.
- **Renew only where the cookie can be written** (ADR-0003); never in `getSession()`.
- **No token in anything the browser sees**, in an error, or in a log.
- Names, errors and style follow `@qeet-id/node`: named exports, errors extending `QeetIDError` with a stable
  `code`, argument mistakes as `TypeError`.

## Tests

```bash
bun run test           # vitest run
bun run test:coverage
```

`test/helpers/fake-qeet-id.ts` stands in for Qeet ID (discovery, JWKS, the token endpoint with PKCE and
refresh rotation with reuse detection, revocation, the management lookups); `test/helpers/browser.ts` keeps
a browser's cookies. Nothing calls a real server.

## Reporting bugs

Open an issue with the Next.js version, what you expected, what happened, and the route or helper involved.
