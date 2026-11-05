# GitHub Copilot — qeet-id-nextjs

**Canonical instructions: [`AGENTS.md`](../AGENTS.md).** This file is a summary; it adds no
architecture.

## Repository

**Qeet ID for Next.js** — `@qeet-id/nextjs`: the session routes, an encrypted cookie session, renewal, the
proxy and server helpers for a Next.js 16 App Router app, and a client entry re-exporting `@qeet-id/react`.
Node.js 22.12+, bun, Biome, an ES module package via tsdown.

## Structure

`src/qeet-id.ts` (`createQeetID`) · `src/config.ts` · `src/routes.ts` (the session routes) ·
`src/oidc.ts` (Qeet ID through `@qeet-id/node`) · `src/proxy.ts` · `src/server.ts` (server helpers) ·
`src/session/` (cookie encryption, chunking, the stored session) · `src/client/` (the client entry) ·
`src/index.ts` (server exports).

## Rules

1. **Tokens never reach the browser**, an error or a log.
2. **Renew only where the cookie can be written**; never in `getSession()`.
3. **CSRF header on every POST**; no state change on GET; no CORS headers.
4. **Return paths through `safeReturnTo`**; redirects built on `QEET_ID_APP_URL`.
5. **Import the session contract from `@qeet-id/react/contract`.**

## Commands

`bun install` · `bun run verify` · `bun run build` · `bun run test` · `bun run typecheck` · `bun run check`

## Do not

- put a token in the session JSON, a log or an error
- refresh a token in a Server Component render
- send Qeet ID a parameter its authorize endpoint doesn't take (organisation, login hint, sign-up hint)
- add `"use client"` to an entry module
- invent scripts — read `package.json`
