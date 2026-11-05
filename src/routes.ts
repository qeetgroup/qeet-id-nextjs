/**
 * The session routes of the contract (`@qeet-id/react`'s
 * docs/session-contract.md), as one route handler for
 * `app/{basePath}/[...qeetid]/route.ts`.
 */
import {
  AUTH_ERROR_PARAMETER,
  CSRF_HEADER,
  CSRF_HEADER_VALUE,
  type ErrorResponse,
  type SessionErrorCode,
  type SessionResponse,
  type SignInErrorCode,
  type SignOutResponse,
  type SwitchOrganizationResponse,
  SIGN_IN_PARAMETERS,
  safeReturnTo,
} from "@qeet-id/react/contract";
import type { Config } from "./config.js";
import { type CookieWrite, type RequestCookie, parseCookieHeader } from "./session/cookies.js";
import { type SessionStore, toSession } from "./session/store.js";
import { type Oidc, SignInFailure } from "./oidc.js";

/** The route handlers to export from the catch-all route: `export const { GET, POST } = qeetId.handlers`. */
export interface RouteHandlers {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
}

type RouteName = "signIn" | "signUp" | "callback" | "session" | "signOut" | "switchOrganization";

/** The largest JSON body a POST route reads. */
const MAX_BODY_BYTES = 8 * 1024;
/** An OAuth error code as Qeet ID sends it (RFC 6749 §4.1.2.1): passed on, anything else becomes `server_error`. */
const OAUTH_ERROR_CODE = /^[a-z_]{1,64}$/;

/** Builds the route handlers. */
export function createRouteHandlers(config: Config, store: SessionStore, oidc: Oidc): RouteHandlers {
  const byPath = new Map<string, RouteName>(Object.entries(config.routes).map(([name, path]) => [path, name as RouteName]));
  // The callback answers at the redirect URI's path, which may differ from {basePath}/callback behind a rewrite.
  byPath.set(config.callbackPath.replace(/\/+$/, "") || "/", "callback");

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = byPath.get(url.pathname.replace(/\/+$/, "") || "/");
    if (route === undefined) {
      return errorResponse(404, "not_found", `No Qeet ID session route answers ${url.pathname}. The routes live under ${config.basePath}.`);
    }
    const method = route === "signOut" || route === "switchOrganization" ? "POST" : "GET";
    if (request.method !== method && !(method === "GET" && request.method === "HEAD")) {
      return errorResponse(405, "method_not_allowed", `${url.pathname} answers ${method} only.`, { allow: method });
    }
    const cookies = parseCookieHeader(request.headers.get("cookie"));
    try {
      switch (route) {
        case "signIn":
        case "signUp":
          return await signIn(url);
        case "callback":
          return await callback(url, cookies);
        case "session":
          return await session(cookies);
        case "signOut":
          return await signOut(request, cookies);
        case "switchOrganization":
          return await switchOrganization(request, cookies);
      }
    } catch {
      return errorResponse(500, "internal_error", "The session route failed unexpectedly.");
    }
  }

  // GET {base}/sign-in and {base}/sign-up. Qeet ID's authorize endpoint takes
  // no organisation, login hint or sign-up hint, so `organization` and
  // `loginHint` are accepted and not sent (the contract reserves them).
  async function signIn(url: URL): Promise<Response> {
    const returnTo = safeReturnTo(url.searchParams.get(SIGN_IN_PARAMETERS.returnTo), config.appOrigin) ?? "/";
    let start: Awaited<ReturnType<Oidc["startSignIn"]>>;
    try {
      start = await oidc.startSignIn(returnTo);
    } catch {
      return redirectResponse(withAuthError(returnTo, "session_unavailable"));
    }
    return redirectResponse(start.url, [await store.writeSignIn(start.pending)]);
  }

  // GET {base}/callback: Qeet ID's answer to the authorization request.
  async function callback(url: URL, cookies: RequestCookie[]): Promise<Response> {
    const state = url.searchParams.get("state");
    const pending = state === null || state === "" ? null : await store.readSignIn(cookies, state);
    if (state === null || pending === null) {
      // No sign-in this browser started: a forged, replayed or expired callback.
      return redirectResponse(withAuthError("/", "invalid_state"));
    }
    const writes: CookieWrite[] = [store.clearSignIn(state)];
    const error = url.searchParams.get("error");
    if (error !== null) {
      const code = (OAUTH_ERROR_CODE.test(error) ? error : "server_error") as SignInErrorCode;
      return redirectResponse(withAuthError(pending.returnTo, code), writes);
    }
    const code = url.searchParams.get("code");
    if (code === null || code === "") return redirectResponse(withAuthError(pending.returnTo, "invalid_request"), writes);
    try {
      const session = await oidc.completeSignIn(code, url.searchParams.get("iss"), pending);
      writes.push(...(await store.write(session, cookies)));
      return redirectResponse(pending.returnTo, writes);
    } catch (failure) {
      const reason = failure instanceof SignInFailure ? failure.code : "session_unavailable";
      return redirectResponse(withAuthError(pending.returnTo, reason), writes);
    }
  }

  // GET {base}/session: who is signed in, renewing the access token near expiry.
  async function session(cookies: RequestCookie[]): Promise<Response> {
    const stored = await store.read(cookies);
    if (stored === null) {
      // Nobody, or a cookie that no longer opens: clear what's there.
      return jsonResponse<SessionResponse>(200, { session: null }, await store.write(null, cookies));
    }
    const renewal = await oidc.renew(stored);
    switch (renewal.status) {
      case "current":
        return jsonResponse<SessionResponse>(200, { session: toSession(renewal.session) });
      case "renewed":
        return jsonResponse<SessionResponse>(200, { session: toSession(renewal.session) }, await store.write(renewal.session, cookies));
      case "ended":
        return jsonResponse<SessionResponse>(200, { session: null }, await store.write(null, cookies));
      case "unavailable":
        if (renewal.usable) return jsonResponse<SessionResponse>(200, { session: toSession(renewal.session) });
        return errorResponse(503, "session_unavailable", "Qeet ID couldn't be reached to renew the session.");
    }
  }

  // POST {base}/sign-out: clear the session, revoke the refresh token, and
  // send the browser to end Qeet ID's session too. Answers 200 without a session.
  async function signOut(request: Request, cookies: RequestCookie[]): Promise<Response> {
    const refusal = csrfRefusal(request);
    if (refusal !== undefined) return refusal;
    const body = await readJson(request, true);
    if (body === undefined) return errorResponse(400, "invalid_request", 'The body must be JSON: { "returnTo"?: string }.');
    const returnTo = safeReturnTo(body.returnTo, config.appOrigin);
    const stored = await readAny(cookies);
    if (stored?.refreshToken) await oidc.revoke(stored.refreshToken);
    const redirectTo = await oidc.signOutUrl(stored?.idToken ?? null, returnTo);
    return jsonResponse<SignOutResponse>(200, { redirectTo }, await store.write(null, cookies));
  }

  // POST {base}/switch-organization. Qeet ID always issues an application's
  // tokens for the application's own organisation and refuses its tokens at
  // the switch endpoint, so the only switch that can succeed is to the
  // organisation the session is already in.
  async function switchOrganization(request: Request, cookies: RequestCookie[]): Promise<Response> {
    const refusal = csrfRefusal(request);
    if (refusal !== undefined) return refusal;
    const body = await readJson(request, false);
    const organizationId = body?.organizationId;
    if (typeof organizationId !== "string" || organizationId === "") {
      return errorResponse(400, "invalid_request", 'The body must be JSON: { "organizationId": string }.');
    }
    const stored = await store.read(cookies);
    if (stored === null) return errorResponse(401, "not_signed_in", "Nobody is signed in.");
    if (stored.organization?.id === organizationId) {
      return jsonResponse<SwitchOrganizationResponse>(200, { session: toSession(stored) });
    }
    return errorResponse(
      501,
      "organization_switch_unavailable",
      "Qeet ID signs people in to an application's own organisation, and can't move an application's session to another one.",
    );
  }

  /** The session whatever its expiry, for signing out of what it holds. */
  async function readAny(cookies: RequestCookie[]) {
    return store.read(cookies, Number.NEGATIVE_INFINITY);
  }

  function withAuthError(returnTo: string, code: SignInErrorCode): string {
    const url = new URL(returnTo, config.appOrigin);
    url.searchParams.set(AUTH_ERROR_PARAMETER, code);
    return url.toString();
  }

  function redirectResponse(location: string, writes: readonly CookieWrite[] = []): Response {
    const target = new URL(location, config.appOrigin).toString();
    return withCookies(new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } }), writes);
  }

  return { GET: handle, POST: handle };
}

/**
 * The CSRF defence of every POST (RFC 10017 §6.1.3.3.2): the custom header,
 * which a page on another site can't add without a CORS preflight these
 * routes never answer, and Fetch Metadata's verdict when the browser sends it.
 */
function csrfRefusal(request: Request): Response | undefined {
  if (request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE || request.headers.get("sec-fetch-site") === "cross-site") {
    return errorResponse(
      403,
      "csrf_rejected",
      `A POST to a session route must come from this site with the ${CSRF_HEADER}: ${CSRF_HEADER_VALUE} header.`,
    );
  }
  return undefined;
}

/** The body as a JSON object; `{}` for an empty one when `optional`; `undefined` when it isn't one. */
async function readJson(request: Request, optional: boolean): Promise<Record<string, unknown> | undefined> {
  const text = await request.text();
  if (text.trim() === "") return optional ? {} : undefined;
  if (text.length > MAX_BODY_BYTES) return undefined;
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(type)) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function jsonResponse<T>(status: number, body: T, writes: readonly CookieWrite[] = []): Response {
  return withCookies(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } }),
    writes,
  );
}

function errorResponse(
  status: number,
  code: SessionErrorCode | "not_found",
  message: string,
  headers: Record<string, string> = {},
): Response {
  const body: ErrorResponse = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** Adds a `Set-Cookie` per write. */
export function withCookies(response: Response, writes: readonly CookieWrite[]): Response {
  for (const write of writes) response.headers.append("set-cookie", serializeCookie(write));
  return response;
}

/** One `Set-Cookie` value (RFC 6265 §4.1). Values here are base64url, so need no encoding. */
export function serializeCookie({ name, value, attributes }: CookieWrite): string {
  const parts = [`${name}=${value}`, `Path=${attributes.path}`, `Max-Age=${attributes.maxAge}`];
  if (attributes.maxAge === 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  parts.push("HttpOnly", "SameSite=Lax");
  if (attributes.secure) parts.push("Secure");
  return parts.join("; ");
}
