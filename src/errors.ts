/**
 * The errors this package throws. Both extend `QeetIDError` from
 * `@qeet-id/node`, so one `instanceof QeetIDError` catches every error the
 * Qeet ID SDKs make on purpose; `code` is stable, `message` is for developers.
 *
 * ```text
 * QeetIDError                (from @qeet-id/node)
 * ├── ConfigurationError     a setting is missing or invalid
 * └── AccessTokenError       getAccessToken() has no token to give
 * ```
 *
 * The session routes never throw at the browser: they answer the contract's
 * `{ "error": { "code", "message" } }` instead.
 */
import { QeetIDError } from "@qeet-id/node";

/** Gives an error class its `name` on the prototype, where `QeetIDError`'s cross-copy `instanceof` looks for it. */
function named(ctor: abstract new (...args: never[]) => Error, name: string): void {
  Object.defineProperty(ctor.prototype, "name", { value: name, enumerable: false, writable: true, configurable: true });
}

/**
 * A setting is missing or invalid. `problems` lists every one found, each
 * naming its environment variable or option, so one start shows them all.
 * Thrown by `createQeetID()`; during `next build` it waits until the first
 * request instead, so a build without the secrets still succeeds.
 */
export class ConfigurationError extends QeetIDError {
  /** Every problem found, one sentence each. */
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    const list = problems.map((problem) => `  - ${problem}`).join("\n");
    super(`Qeet ID for Next.js is not configured correctly:\n${list}`, { code: "invalid_configuration" });
    this.problems = Object.freeze([...problems]);
  }
}
named(ConfigurationError, "ConfigurationError");

/** Why `getAccessToken()` had no token to give. */
export type AccessTokenErrorCode =
  /** Nobody is signed in. */
  | "not_signed_in"
  /** The session ended: it expired, or Qeet ID refused to renew it (signed out elsewhere, revoked, suspended). */
  | "session_ended"
  /**
   * The access token has expired and needs renewing, but this is a Server
   * Component, where Next.js can't write the session cookie. Renew in the
   * proxy, a Server Action or a Route Handler.
   */
  | "cookies_read_only"
  /** The access token has expired and Qeet ID couldn't be reached to renew it. Try again shortly. */
  | "session_unavailable";

/** `getAccessToken()` had no access token to give; `code` says why. */
export class AccessTokenError extends QeetIDError {
  declare readonly code: AccessTokenErrorCode;

  constructor(code: AccessTokenErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, { code, cause: options.cause });
  }
}
named(AccessTokenError, "AccessTokenError");
