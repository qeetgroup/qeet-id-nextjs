import type { Session, SessionUser } from "@qeet-id/react/contract";
import type { Config } from "../config.js";
import {
  type CookieAttributes,
  type CookieWrite,
  type RequestCookie,
  chunkedWrites,
  readChunked,
  sessionCookieName,
  signInCookieName,
} from "./cookies.js";
import { Sealer } from "./crypto.js";

/** How long a sign-in may take, from the redirect to Qeet ID to the callback: 10 minutes. */
export const SIGN_IN_MAX_AGE_SECONDS = 600;

/**
 * What the session cookie holds, encrypted. Times are milliseconds since the
 * epoch. Never sent to the browser as is: `toSession` is what it sees.
 */
export interface StoredSession {
  v: 1;
  user: SessionUser;
  organization: { id: string; name: string | null } | null;
  roles: string[];
  permissions: string[];
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string | null;
  /** Kept for the sign-out's `id_token_hint`, so Qeet ID ends its own session without asking. */
  idToken: string | null;
  /** When the session ends unless it is renewed first. */
  expiresAt: number;
}

/** What the sign-in cookie holds between the redirect to Qeet ID and the callback. */
export interface PendingSignIn {
  v: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  /** A path on this site, already checked. */
  returnTo: string;
}

/** Reads and writes the session and sign-in cookies. One per configuration. */
export class SessionStore {
  readonly #config: Config;
  readonly #sealer: Sealer;
  /** The session cookie's name. */
  readonly sessionName: string;

  constructor(config: Config) {
    this.#config = config;
    this.#sealer = new Sealer(config.secrets);
    this.sessionName = sessionCookieName(config.secure);
  }

  /** The session the cookies carry, or `null`: none, unreadable, or past `expiresAt`. */
  async read(cookies: readonly RequestCookie[], now: number = Date.now()): Promise<StoredSession | null> {
    const sealed = readChunked(cookies, this.sessionName);
    if (sealed === undefined) return null;
    const value = await this.#sealer.unseal(sealed, "session");
    if (!isStoredSession(value) || value.expiresAt <= now) return null;
    return value;
  }

  /** The writes that store `session`, or delete the session when it is `null`. */
  async write(session: StoredSession | null, existing: readonly RequestCookie[], now: number = Date.now()): Promise<CookieWrite[]> {
    const { maxAge, ...attributes } = this.sessionAttributes(session, now);
    return chunkedWrites(
      this.sessionName,
      session === null ? null : await this.#sealer.seal(session, "session"),
      existing,
      attributes,
      maxAge,
    );
  }

  /** The attributes of the session's cookies, living until `session` expires (deleting them for `null`). */
  sessionAttributes(session: StoredSession | null, now: number = Date.now()): CookieAttributes {
    const maxAge = session === null ? 0 : Math.max(1, Math.ceil((session.expiresAt - now) / 1000));
    return { httpOnly: true, secure: this.#config.secure, sameSite: "lax", path: "/", maxAge };
  }

  /** The cookie that holds a pending sign-in until its callback. */
  async writeSignIn(pending: PendingSignIn): Promise<CookieWrite> {
    return {
      name: signInCookieName(this.#config.secure, pending.state),
      value: await this.#sealer.seal(pending, "sign-in"),
      attributes: this.#signInAttributes(SIGN_IN_MAX_AGE_SECONDS),
    };
  }

  /** The pending sign-in for `state`, or `null` when this browser started none (or it expired). */
  async readSignIn(cookies: readonly RequestCookie[], state: string): Promise<PendingSignIn | null> {
    const name = signInCookieName(this.#config.secure, state);
    const sealed = cookies.find((cookie) => cookie.name === name)?.value;
    if (sealed === undefined) return null;
    const value = await this.#sealer.unseal(sealed, "sign-in");
    return isPendingSignIn(value) && value.state === state ? value : null;
  }

  /** Deletes the sign-in cookie for `state`. */
  clearSignIn(state: string): CookieWrite {
    return { name: signInCookieName(this.#config.secure, state), value: "", attributes: this.#signInAttributes(0) };
  }

  #signInAttributes(maxAge: number): CookieWrite["attributes"] {
    return { httpOnly: true, secure: this.#config.secure, sameSite: "lax", path: this.#config.callbackPath, maxAge };
  }
}

/** The session as the browser sees it (the contract's `Session`): no tokens. */
export function toSession(stored: StoredSession): Session {
  return {
    user: { ...stored.user },
    organization: stored.organization === null ? null : { ...stored.organization },
    roles: [...stored.roles],
    permissions: [...stored.permissions],
    expiresAt: new Date(stored.expiresAt).toISOString(),
  };
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Partial<StoredSession>;
  return (
    session.v === 1 &&
    typeof session.user === "object" &&
    session.user !== null &&
    typeof session.user.id === "string" &&
    typeof session.accessToken === "string" &&
    typeof session.accessTokenExpiresAt === "number" &&
    typeof session.expiresAt === "number" &&
    Array.isArray(session.roles) &&
    Array.isArray(session.permissions)
  );
}

function isPendingSignIn(value: unknown): value is PendingSignIn {
  if (typeof value !== "object" || value === null) return false;
  const pending = value as Partial<PendingSignIn>;
  return (
    pending.v === 1 &&
    typeof pending.state === "string" &&
    typeof pending.nonce === "string" &&
    typeof pending.codeVerifier === "string" &&
    typeof pending.returnTo === "string"
  );
}
