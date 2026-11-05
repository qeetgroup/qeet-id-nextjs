# ADR-0004: ES module only

**Status:** Accepted

## Context

`@qeet-id/node` and `@qeet-id/react` ship ES module and CommonJS builds, for Jest and TypeScript
projects compiled to CommonJS. This package is different: it only runs inside a Next.js app, whose
compiler handles ES modules natively, and it imports `next/server`, `next/headers` and
`next/navigation`, which only mean something there. `@auth0/nextjs-auth0` v4 and
`@workos-inc/authkit-nextjs` ship ES modules only. Node.js 22.12 and later can `require()` an ES module.

## Decision

Ship ES modules only: `.mjs` with `.d.mts`, `types` first in each `exports` condition. The package
check is `attw --pack . --profile esm-only`, which skips the CommonJS resolution modes.

## Revisit

If customers' test runners can't load it, add a CommonJS build then; adding one is not a breaking change.
