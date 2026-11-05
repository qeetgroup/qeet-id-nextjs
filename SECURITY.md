# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities privately — do not open a public GitHub issue. Email
**security@qeet.in** with:

- A description of the vulnerability and its impact.
- Steps to reproduce (a minimal Next.js app or request sequence against this package, not the Qeet ID
  backend).
- The package version (`import { VERSION } from "@qeet-id/nextjs"`), and the Next.js and Node.js versions.

We aim to acknowledge reports within 2 business days.

## Scope

This policy covers `qeet-id-nextjs` itself. The highest-sensitivity code is the cookie encryption
(`src/session/crypto.ts`), the session routes' checks (`src/routes.ts`: state, issuer, CSRF, return paths),
ID token validation and renewal (`src/oidc.ts`). Vulnerabilities in the Qeet ID platform itself should be
reported through Qeet ID's own security channel, not here.

## Supported versions

Only the latest minor version receives security fixes before 1.0. From 1.0, the two most recent minor
versions are supported.

## Disclosure

We'll credit reporters (unless anonymity is requested) in the release notes once a fix ships.
