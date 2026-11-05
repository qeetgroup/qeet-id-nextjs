# GEMINI.md — qeet-id-nextjs

**Read [AGENTS.md](AGENTS.md) first.** It is the model-neutral instruction file and the source of
truth for this repository. This file is a pointer and adds no architecture.

```text
GEMINI.md  →  AGENTS.md  →  docs/llm/*
```

## Canonical context

| File | For |
| --- | --- |
| [qeet-repo.yml](qeet-repo.yml) | Machine-readable repository identity |
| [AGENTS.md](AGENTS.md) | **Rules, commands, what CI enforces** |
| [docs/llm/context.md](docs/llm/context.md) | How this repository actually works |
| [docs/llm/boundaries.md](docs/llm/boundaries.md) | What it owns, and what it must not touch |
| [docs/llm/workflows.md](docs/llm/workflows.md) | Step-by-step for common changes |
| [docs/llm/architecture-map.md](docs/llm/architecture-map.md) | "Where is X?" — fastest path to a file |

Parent context: **L0** `qeetgroup/qeet-context` · **L1** `qeetgroup/qeet-id-context`.

## What this repository is

**Qeet ID for Next.js** — `@qeet-id/nextjs`. The session routes, an encrypted cookie session, renewal, the
proxy and server helpers for a Next.js 16 App Router app, plus a client entry re-exporting `@qeet-id/react`.
Node.js 22.12+, bun, Biome, an ES module package via tsdown.

## Non-negotiables

1. **Tokens never reach the browser.**
2. **Renew only where the cookie can be written** (ADR-0003).
3. **CSRF header on every POST; same-origin return paths only.**
4. **The session contract is `@qeet-id/react`'s** — import it, don't copy it.
5. **Never weaken** the cookie encryption or the callback's checks.

## Commands

`bun install` · `bun run verify` · `bun run build` · `bun run test` · `bun run typecheck` · `bun run check` · `bun run check:package`

That list is complete — **do not invent commands.**

## Before finishing

```bash
bun run verify
git diff
```
