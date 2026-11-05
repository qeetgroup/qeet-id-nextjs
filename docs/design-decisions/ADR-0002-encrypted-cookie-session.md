# ADR-0002: A stateless session, encrypted with AES-256-GCM in the cookie

**Status:** Accepted

## Context

The tokens must stay on the server (RFC 10017 §6.1). They can live in a server-side store, keyed by a
cookie, or in the cookie itself, encrypted. A store means the app needs a database or cache, and its
latency on every request; the cookie needs authenticated encryption and stays under browser limits.

Libraries exist for the encryption (`jose` for JWE, `iron-session`), and Web Crypto does it natively
in every runtime Next.js runs on.

## Decision

The session is the cookie: the access, refresh and ID tokens, the user's claims, the organisation, and
the roles and permissions, as JSON, sealed with AES-256-GCM through Web Crypto. Each secret becomes a
256-bit key with HKDF-SHA-256; every value gets a fresh 96-bit IV; the cookie's purpose (`session` or
`sign-in`) is the additional authenticated data, so one cookie can't stand in for another. The format is
`v1.` and base64url(iv ‖ ciphertext ‖ tag). A list of secrets rotates: the first seals, all unseal.

No dependency is added: the code is about 80 lines and its tests cover tampering, wrong keys, wrong
purposes and rotation.

## Consequences

- A typical session is about 2.5 KB sealed: one cookie. Larger ones (many permissions) split into
  numbered chunks.
- A session can't be ended from the server side alone: signing out elsewhere takes effect when the
  next renewal is refused (within the access token's lifetime, 10 minutes by default at Qeet ID).
  Back-channel logout would need a store; see the README's sessions section.
- Changing the format means a new version prefix; unreadable cookies are cleared, signing people out.
