/**
 * The proxy (Next.js 16's `proxy.ts`, formerly middleware): renews sessions
 * ahead of expiry, where the cookie can be written, and sends signed-out
 * visitors of protected paths to sign in.
 */
import { NextResponse, type NextRequest } from "next/server.js";
import type { ErrorResponse } from "@qeet-id/react/contract";
import type { Config } from "./config.js";
import { type CookieWrite, applyWrites, cookieHeader } from "./session/cookies.js";
import type { SessionStore } from "./session/store.js";
import type { Oidc } from "./oidc.js";
import { serializeCookie } from "./routes.js";

/**
 * The request header the proxy sets to the path and query being visited, for
 * `requireSession()` to come back to. Any value the browser sent is replaced.
 */
export const RETURN_TO_HEADER = "x-qeet-id-return-to";

/** Configures `qeetId.proxy()`. */
export interface ProxyOptions {
  /**
   * The paths only a signed-in person may visit: path prefixes such as
   * `"/dashboard"` (which covers `/dashboard` and `/dashboard/…`, not
   * `/dashboards`), or a function of the request. A signed-out `GET` is sent
   * to sign in and back; any other method gets `401 not_signed_in`.
   *
   * The proxy is a first check, not the only one: check the session again
   * where the data is read (`requireSession()`), as Next.js advises.
   */
  protect?: readonly string[] | ((request: NextRequest) => boolean);
}

/** A proxy function, for `export default qeetId.proxy()` in `proxy.ts`. */
export type QeetIDProxy = (request: NextRequest) => Promise<NextResponse>;

/** Builds the proxy. */
export function createProxy(config: Config, store: SessionStore, oidc: Oidc, isProtected: (request: NextRequest) => boolean): QeetIDProxy {
  const base = config.basePath === "/" ? "/" : `${config.basePath}/`;

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname, search } = request.nextUrl;
    // The session routes manage the session themselves.
    if (pathname === config.basePath || pathname.startsWith(base) || pathname === config.callbackPath) return NextResponse.next();

    const cookies = request.cookies.getAll();
    let session = await store.read(cookies);
    let writes: CookieWrite[] = [];
    if (session !== null) {
      const renewal = await oidc.renew(session);
      if (renewal.status === "renewed") {
        session = renewal.session;
        writes = await store.write(session, cookies);
      } else if (renewal.status === "ended") {
        session = null;
        writes = await store.write(null, cookies);
      }
      // "unavailable": keep the session; Qeet ID is asked again on the next request.
    } else if (cookies.some((cookie) => cookie.name === store.sessionName || cookie.name.startsWith(`${store.sessionName}.`))) {
      writes = await store.write(null, cookies); // a cookie that no longer opens
    }

    if (session === null && isProtected(request)) {
      if (request.method === "GET" || request.method === "HEAD") {
        const signIn = new URL(config.routes.signIn, config.appOrigin);
        signIn.searchParams.set("returnTo", `${pathname}${search}`);
        return withWrites(NextResponse.redirect(signIn, { headers: { "cache-control": "no-store" } }), writes);
      }
      const body: ErrorResponse = { error: { code: "not_signed_in", message: "Sign in first." } };
      return withWrites(NextResponse.json(body, { status: 401, headers: { "cache-control": "no-store" } }), writes);
    }

    // Forward the renewed cookies with the request, so this very render sees
    // them, and the path for requireSession() to come back to.
    const headers = new Headers(request.headers);
    headers.set(RETURN_TO_HEADER, `${pathname}${search}`);
    if (writes.length > 0) headers.set("cookie", cookieHeader(applyWrites(cookies, writes)));
    const response = NextResponse.next({ request: { headers } });
    if (writes.length > 0) response.headers.set("cache-control", "private, no-store");
    return withWrites(response, writes);
  };
}

function withWrites(response: NextResponse, writes: readonly CookieWrite[]): NextResponse {
  for (const write of writes) response.headers.append("set-cookie", serializeCookie(write));
  return response;
}

/** The `protect` option as a predicate. Throws a `TypeError` for a path that isn't one. */
export function protectedPaths(protect: ProxyOptions["protect"]): (request: NextRequest) => boolean {
  if (protect === undefined) return () => false;
  if (typeof protect === "function") return protect;
  const prefixes = protect.map((prefix) => {
    if (typeof prefix !== "string" || !prefix.startsWith("/"))
      throw new TypeError(`protect lists paths such as "/dashboard"; got ${JSON.stringify(prefix)}.`);
    return prefix.replace(/\/+$/, "");
  });
  return (request) => {
    const path = request.nextUrl.pathname;
    return prefixes.some((prefix) => prefix === "" || path === prefix || path.startsWith(`${prefix}/`));
  };
}
