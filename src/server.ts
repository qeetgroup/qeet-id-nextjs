/**
 * Reading the session in Server Components, Server Actions and Route
 * Handlers, through `next/headers`.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { type Session, safeReturnTo } from "@qeet-id/react/contract";
import type { Config } from "./config.js";
import { AccessTokenError } from "./errors.js";
import { type Oidc, RENEWAL_MARGIN_MS } from "./oidc.js";
import { RETURN_TO_HEADER } from "./proxy.js";
import type { RequestCookie } from "./session/cookies.js";
import { type SessionStore, type StoredSession, toSession } from "./session/store.js";

/** Configures `requireSession()`. */
export interface RequireSessionOptions {
  /**
   * The path on this site to come back to after signing in. Default: the
   * page being rendered, as the proxy recorded it, or `/` without the proxy.
   */
  returnTo?: string;
}

/** The server helpers. Internal; reached through `createQeetID()`. */
export interface ServerHelpers {
  getSession(): Promise<Session | null>;
  requireSession(options?: RequireSessionOptions): Promise<Session>;
  getAccessToken(): Promise<string>;
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** Builds the server helpers. */
export function createServerHelpers(config: Config, store: SessionStore, oidc: Oidc): ServerHelpers {
  // Read and decrypted once per request in a Server Component render; in a
  // Server Action or Route Handler React's cache does nothing and every call reads.
  const getSession = cache(async (): Promise<Session | null> => {
    const stored = await store.read((await cookies()).getAll());
    return stored === null ? null : toSession(stored);
  });

  async function requireSession(options: RequireSessionOptions = {}): Promise<Session> {
    const session = await getSession();
    if (session !== null) return session;
    const recorded = options.returnTo ?? (await headers()).get(RETURN_TO_HEADER) ?? "/";
    const signIn = new URL(config.routes.signIn, config.appOrigin);
    signIn.searchParams.set("returnTo", safeReturnTo(recorded, config.appOrigin) ?? "/");
    redirect(`${signIn.pathname}${signIn.search}`);
  }

  async function getAccessToken(): Promise<string> {
    const jar = await cookies();
    const existing: RequestCookie[] = jar.getAll();
    const stored = await store.read(existing);
    if (stored === null) throw new AccessTokenError("not_signed_in", "Nobody is signed in.");
    const now = Date.now();
    if (stored.accessTokenExpiresAt - now > RENEWAL_MARGIN_MS || stored.refreshToken === null) return stored.accessToken;
    // Renewing rotates the refresh token, so it happens only where the new one
    // can be stored: a second use of the old one would end the session.
    if (!writable(jar, store, stored, existing, now)) {
      if (stored.accessTokenExpiresAt > now) return stored.accessToken;
      throw new AccessTokenError(
        "cookies_read_only",
        "The access token has expired, and a Server Component can't store a renewed one. Let the proxy renew sessions, or call getAccessToken() from a Server Action or Route Handler.",
      );
    }
    const renewal = await oidc.renew(stored, now);
    switch (renewal.status) {
      case "current":
        return renewal.session.accessToken;
      case "renewed":
        for (const write of await store.write(renewal.session, existing)) jar.set(write.name, write.value, write.attributes);
        return renewal.session.accessToken;
      case "ended":
        for (const write of await store.write(null, existing)) jar.set(write.name, write.value, write.attributes);
        throw new AccessTokenError("session_ended", "The session has ended: sign in again.");
      case "unavailable":
        if (renewal.usable) return renewal.session.accessToken;
        throw new AccessTokenError("session_unavailable", "The access token has expired and Qeet ID couldn't be reached to renew it.");
    }
  }

  return { getSession, requireSession, getAccessToken };
}

/**
 * Whether cookies can be written here. Next.js lets a Server Action or Route
 * Handler set cookies and throws in a Server Component; the probe writes the
 * session's first cookie again, unchanged.
 */
function writable(jar: CookieStore, store: SessionStore, stored: StoredSession, existing: readonly RequestCookie[], now: number): boolean {
  const first = existing.find((cookie) => cookie.name === store.sessionName || cookie.name === `${store.sessionName}.0`);
  if (first === undefined) return false;
  try {
    jar.set(first.name, first.value, store.sessionAttributes(stored, now));
    return true;
  } catch {
    return false;
  }
}
