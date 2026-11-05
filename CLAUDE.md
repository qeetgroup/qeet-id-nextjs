# CLAUDE.md — qeet-id-nextjs

**Read [AGENTS.md](AGENTS.md) first.** It is the model-neutral instruction file and the source of
truth for this repository. This file adds only Claude-specific guidance.

```text
CLAUDE.md  →  AGENTS.md  →  docs/llm/*
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

## The things most likely to trip you up here

1. **The session contract is `@qeet-id/react`'s.** Import from `@qeet-id/react/contract`; don't redefine.
2. **Renewal rotates the refresh token** and Qeet ID ends the grant on reuse: renew only where the cookie is
   written (ADR-0003). `getSession()` never renews.
3. **`server-only` on the server entry, `"use client"` on the provider only.**
4. **No tokens** in anything the browser sees, in errors or in logs.
5. **Qeet ID's authorize endpoint takes no organisation, login hint or sign-up hint**, and an application
   can't switch organisation: don't invent them.

## Working style

- **Read before editing.** Match the neighbouring module rather than introducing an abstraction.
- Use the architecture map instead of guessing a path.
- **Do not read `.env*` or secret files** into anything you write.

## Finishing a change

```bash
bun run verify
git diff
```

## Escalate rather than proceed

Stop and report if a task would weaken a security control, change the session contract, or require
modifying another repository.
