# Workflows — qeet-id-nextjs

**Level:** L2 · **Last verified:** 2026-11-05
**Verification scope:** every command checked against `package.json` and `.github/workflows/`.

## Set up

```bash
bun install
bun run verify   # typecheck (and the example) + Biome + tests + build + publint + attw
```

No services required — tests use a fake Qeet ID.

## The session contract changed

```text
1  read qeet-id-react's docs/session-contract.md and src/contract.ts (the new version)
2  raise @qeet-id/react to the version with the change; bun run typecheck shows what moved
3  src/routes.ts for routes, JSON and errors; src/session/store.ts (toSession) for the Session
4  test/routes.test.ts: a test per changed behaviour
5  README (the routes table), CHANGELOG
6  bun run verify
```

## Rely on something new from Qeet ID

```text
1  find it in qeet-id-server: api/openapi/*.yaml, then the handler under internal/ (the tiebreaker)
2  call it through @qeet-id/node from src/oidc.ts; add it to @qeet-id/node first if it's missing there
3  teach test/helpers/fake-qeet-id.ts to answer as the server does
4  tests, README, CHANGELOG; bun run verify
```

## Change the cookie or its encryption

**Review required.** `src/session/`. A new format needs a new version prefix (`v2.`); old cookies are then
cleared, signing everyone out. Keep `test/session/` green and add the case.

## Change where renewal happens

**Review required.** Read ADR-0003 first. Never renew where Next.js can't write the cookie.

## Release

```text
1  CHANGELOG.md: move [Unreleased] under the version being released
2  bun run verify
3  raise the version in package.json (patch, minor or major) on develop, then open a pull request
   from develop into main; Verify runs on it
4  merge it: release.yml sees a version npm does not have, publishes to npm with
   provenance, then tags vX.Y.Z and opens a GitHub Release
```

A push whose version is already on npm
releases nothing, so re-running is safe. A bad release is not unpublished: `npm dist-tag add <package>@<version> latest`
points `latest` back at a good version, then release a fix.
