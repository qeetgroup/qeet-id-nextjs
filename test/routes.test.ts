import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSession } from "@qeet-id/react/contract";
import { APP_URL, CookieJar, get, post, signIn, testQeetID } from "./helpers/browser.js";
import { BASE_URL, CLIENT_ID, ISSUER, MEERA, TENANT_ID, type FakeQeetID, fakeQeetID } from "./helpers/fake-qeet-id.js";
import type { QeetIDNext } from "../src/index.js";

const SESSION_COOKIE = "__Host-Http-qeet-id-session";

let qeet: FakeQeetID;
let qeetId: QeetIDNext;

beforeEach(async () => {
  qeet = await fakeQeetID();
  qeetId = testQeetID(qeet);
});

afterEach(() => {
  vi.useRealTimers();
});

async function json(response: Response): Promise<any> {
  return JSON.parse(await response.text());
}

function expectNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("no-store");
}

describe("GET /auth/sign-in", () => {
  it("redirects to Qeet ID's authorization endpoint with PKCE S256, state and nonce", async () => {
    const response = await qeetId.handlers.GET(get("/auth/sign-in?returnTo=/invoices"));
    expect(response.status).toBe(302);
    expectNoStore(response);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(`${BASE_URL}/v1/oauth/authorize`);
    const params = Object.fromEntries(location.searchParams);
    expect(params).toMatchObject({
      response_type: "code",
      client_id: CLIENT_ID,
      redirect_uri: `${APP_URL}/auth/callback`,
      scope: "openid profile email offline_access",
      code_challenge_method: "S256",
    });
    expect(params.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(params.state).not.toBe(params.nonce);
    // The reserved parameters aren't sent: Qeet ID's authorize endpoint has none.
    expect(location.searchParams.has("organization")).toBe(false);
  });

  it("keeps the pending sign-in in an encrypted, HttpOnly cookie sent only to the callback", async () => {
    const response = await qeetId.handlers.GET(get("/auth/sign-in"));
    const state = new URL(response.headers.get("location") ?? "").searchParams.get("state");
    const jar = new CookieJar().take(response);
    const cookie = jar.cookies.get(`__Secure-qeet-id-sign-in.${state}`);
    expect(cookie).toMatchObject({ path: "/auth/callback", maxAge: 600, httpOnly: true, secure: true, sameSite: "Lax" });
    expect(cookie?.value).toMatch(/^v1\./);
    expect(cookie?.value).not.toContain(state ?? "-");
  });

  it("starts the same request for sign-up, and ignores the reserved organization and loginHint", async () => {
    const response = await qeetId.handlers.GET(get(`/auth/sign-up?organization=${TENANT_ID}&loginHint=meera%40brightleaffoods.in`));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/v1/oauth/authorize");
    expect(location.searchParams.has("login_hint")).toBe(false);
  });

  it("comes back with authError=session_unavailable when Qeet ID can't be reached", async () => {
    qeet.override("GET /.well-known/openid-configuration", () => new Response("down", { status: 503 }));
    const response = await qeetId.handlers.GET(get("/auth/sign-in?returnTo=/invoices"));
    expect(response.headers.get("location")).toBe(`${APP_URL}/invoices?authError=session_unavailable`);
  });
});

describe("GET /auth/callback", () => {
  it("exchanges the code, sets the session cookie and returns to the saved path", async () => {
    const { jar, location } = await signIn(qeetId, qeet, { returnTo: "/invoices?status=due#top" });
    expect(location).toBe(`${APP_URL}/invoices?status=due#top`);
    const cookie = jar.cookies.get(SESSION_COOKIE);
    expect(cookie).toMatchObject({ path: "/", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 604800 });
    // The sign-in cookie is gone.
    expect(jar.names().filter((name) => name.includes("sign-in"))).toEqual([]);
    const [exchange] = qeet.callsTo("POST /v1/oauth/token-code");
    expect(exchange?.form?.get("grant_type")).toBe("authorization_code");
    expect(exchange?.form?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(exchange?.form?.get("redirect_uri")).toBe(`${APP_URL}/auth/callback`);
  });

  it.each([
    ["an absolute URL elsewhere", "https://evil.example/steal", "/"],
    ["a protocol-relative URL", "//evil.example", "/"],
    ["a backslash trick", "/\\evil.example", "/"],
    ["a javascript: URL", "javascript:alert(1)", "/"],
    ["an absolute URL on this site", `${APP_URL}/reports`, "/reports"],
  ])("returns to / instead of %s", async (_label, returnTo, expected) => {
    const { location } = await signIn(qeetId, qeet, { returnTo });
    expect(location).toBe(`${APP_URL}${expected}`);
  });

  it("refuses a callback this browser didn't start: invalid_state", async () => {
    const start = await qeetId.handlers.GET(get("/auth/sign-in?returnTo=/invoices"));
    const callbackUrl = qeet.authorize(start.headers.get("location") ?? "");
    // Another browser, without the sign-in cookie.
    const response = await qeetId.handlers.GET(new Request(callbackUrl));
    expect(response.headers.get("location")).toBe(`${APP_URL}/?authError=invalid_state`);
    expect(qeet.callsTo("POST /v1/oauth/token-code")).toHaveLength(0);
  });

  it("refuses a callback whose state doesn't match the cookie's", async () => {
    const jar = new CookieJar();
    const start = await qeetId.handlers.GET(get("/auth/sign-in", jar));
    jar.take(start);
    const callbackUrl = new URL(qeet.authorize(start.headers.get("location") ?? ""));
    callbackUrl.searchParams.set("state", "a-different-state");
    const response = await qeetId.handlers.GET(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/?authError=invalid_state`);
  });

  it("refuses a sign-in cookie that was tampered with", async () => {
    const jar = new CookieJar();
    const start = await qeetId.handlers.GET(get("/auth/sign-in", jar));
    jar.take(start);
    for (const cookie of jar.cookies.values()) cookie.value = `${cookie.value.slice(0, -2)}AA`;
    const callbackUrl = qeet.authorize(start.headers.get("location") ?? "");
    const response = await qeetId.handlers.GET(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/?authError=invalid_state`);
  });

  it("refuses an authorization response from another issuer (RFC 9207)", async () => {
    const jar = new CookieJar();
    const start = await qeetId.handlers.GET(get("/auth/sign-in?returnTo=/invoices", jar));
    jar.take(start);
    const callbackUrl = new URL(qeet.authorize(start.headers.get("location") ?? ""));
    callbackUrl.searchParams.set("iss", "https://attacker.example");
    const response = await qeetId.handlers.GET(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/invoices?authError=invalid_state`);
    expect(qeet.callsTo("POST /v1/oauth/token-code")).toHaveLength(0);
  });

  it("refuses an ID token whose nonce isn't this sign-in's", async () => {
    qeet.override("POST /v1/oauth/token-code", async () => {
      const now = Math.floor(Date.now() / 1000);
      const idToken = await qeet.sign({ iss: ISSUER, sub: MEERA.sub, aud: CLIENT_ID, iat: now, exp: now + 600, nonce: "someone-elses" });
      return Response.json({ access_token: "at", id_token: idToken, token_type: "Bearer", expires_in: 600 });
    });
    const { jar, location } = await signIn(qeetId, qeet, { returnTo: "/invoices" });
    expect(location).toBe(`${APP_URL}/invoices?authError=invalid_state`);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses an ID token that isn't signed by Qeet ID", async () => {
    const other = await fakeQeetID();
    qeet.signIdToken = other.sign; // right claims and nonce, wrong key
    const { jar, location } = await signIn(qeetId, qeet, { returnTo: "/invoices" });
    expect(location).toBe(`${APP_URL}/invoices?authError=invalid_state`);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("refuses an ID token issued to another application", async () => {
    const sign = qeet.sign;
    qeet.signIdToken = (claims) => sign({ ...claims, aud: "another_app" });
    const { location } = await signIn(qeetId, qeet, { returnTo: "/invoices" });
    expect(location).toBe(`${APP_URL}/invoices?authError=invalid_state`);
  });

  it("passes Qeet ID's OAuth error on to the return path", async () => {
    const jar = new CookieJar();
    const start = await qeetId.handlers.GET(get("/auth/sign-in?returnTo=/invoices", jar));
    jar.take(start);
    const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
    const response = await qeetId.handlers.GET(
      get(`/auth/callback?error=access_denied&state=${state}&iss=${encodeURIComponent(ISSUER)}`, jar),
    );
    expect(response.headers.get("location")).toBe(`${APP_URL}/invoices?authError=access_denied`);
    jar.take(response);
    expect(jar.names()).toEqual([]);
  });

  it("reports session_unavailable when the code can't be exchanged", async () => {
    qeet.override("POST /v1/oauth/token-code", () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    const { location } = await signIn(qeetId, qeet, { returnTo: "/invoices" });
    expect(location).toBe(`${APP_URL}/invoices?authError=session_unavailable`);
  });

  it("answers at the redirect URI's own path when one is configured", async () => {
    qeetId = testQeetID(qeet, { redirectUri: `${APP_URL}/public/auth/callback` });
    const { location, jar } = await signIn(qeetId, qeet, { returnTo: "/invoices" });
    expect(location).toBe(`${APP_URL}/invoices`);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(true);
  });
});

describe("GET /auth/session", () => {
  it("answers { session: null } with no-store when nobody is signed in", async () => {
    const response = await qeetId.handlers.GET(get("/auth/session"));
    expect(response.status).toBe(200);
    expectNoStore(response);
    expect(await json(response)).toEqual({ session: null });
  });

  it("answers the contract's Session, with no token in it", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.handlers.GET(get("/auth/session", jar));
    const body = await json(response);
    expect(parseSession(body.session)).toEqual(body.session);
    expect(body.session).toMatchObject({
      user: {
        id: MEERA.sub,
        email: "meera@brightleaffoods.in",
        emailVerified: true,
        name: "Meera Iyer",
        picture: "https://cdn.brightleaffoods.in/people/meera.png",
      },
      organization: { id: TENANT_ID, name: null },
      roles: [],
      permissions: [],
    });
    expect(Date.parse(body.session.expiresAt)).toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);
    expect(JSON.stringify(body)).not.toMatch(/eyJ|token/i);
  });

  it("fills in the organisation's name, roles and permissions with an API key", async () => {
    qeetId = testQeetID(qeet, { apiKey: "qk_test_key" });
    const { jar } = await signIn(qeetId, qeet);
    const body = await json(await qeetId.handlers.GET(get("/auth/session", jar)));
    expect(body.session).toMatchObject({
      organization: { id: TENANT_ID, name: "Brightleaf Foods" },
      roles: ["Finance approver"],
      permissions: ["invoice.approve", "invoice.read"],
    });
    expect(qeet.callsTo(`GET /v1/tenants/${TENANT_ID}`)[0]?.headers.get("authorization")).toBe("ApiKey qk_test_key");
  });

  it("signs in without the lookups when they fail", async () => {
    qeetId = testQeetID(qeet, { apiKey: "qk_test_key" });
    qeet.override(`GET /v1/tenants/${TENANT_ID}`, () => Response.json({ error: { code: "forbidden", message: "no" } }, { status: 403 }));
    qeet.override(`GET /v1/users/${MEERA.sub}/tenants/${TENANT_ID}/permissions`, () => new Response("down", { status: 503 }));
    const { jar } = await signIn(qeetId, qeet);
    const body = await json(await qeetId.handlers.GET(get("/auth/session", jar)));
    expect(body.session).toMatchObject({ organization: { id: TENANT_ID, name: null }, roles: [], permissions: [] });
  });

  it("maps missing claims to null, and emailVerified to false without an email", async () => {
    const { jar } = await signIn(qeetId, qeet, { user: { sub: "c3a1", tenant_id: TENANT_ID } });
    const body = await json(await qeetId.handlers.GET(get("/auth/session", jar)));
    expect(body.session.user).toEqual({ id: "c3a1", email: null, emailVerified: false, name: null, picture: null });
  });

  it("clears a cookie that no longer opens, such as one from a retired secret", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const rotated = testQeetID(qeet, { secret: "a-brand-new-secret-of-at-least-32-characters" });
    const response = await rotated.handlers.GET(get("/auth/session", jar));
    expect(await json(response)).toEqual({ session: null });
    jar.take(response);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("keeps sessions across a secret rotation", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const rotated = testQeetID(qeet, {
      secret: ["a-brand-new-secret-of-at-least-32-characters", "a-test-secret-that-is-at-least-32-characters-long"],
    });
    expect((await json(await rotated.handlers.GET(get("/auth/session", jar)))).session.user.id).toBe(MEERA.sub);
  });
});

describe("POST /auth/sign-out", () => {
  it("clears the session, revokes the refresh token and sends the browser to end Qeet ID's session", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.handlers.POST(post("/auth/sign-out", jar, { returnTo: "/goodbye" }));
    expect(response.status).toBe(200);
    expectNoStore(response);
    const { redirectTo } = await json(response);
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE_URL}/v1/oauth/logout`);
    expect(url.searchParams.get("id_token_hint")).toMatch(/^eyJ/);
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe(`${APP_URL}/`);
    expect(url.searchParams.get("state")).toBe("/goodbye");
    const [revoke] = qeet.callsTo("POST /oauth/revoke");
    expect(revoke?.form?.get("token")).toBe(qeet.refreshTokens[0]);
    expect(revoke?.form?.get("token_type_hint")).toBe("refresh_token");
    jar.take(response);
    expect(jar.names()).toEqual([]);
    expect(await json(await qeetId.handlers.GET(get("/auth/session", jar)))).toEqual({ session: null });
  });

  it("answers 200 without a session: signing out twice is fine", async () => {
    const response = await qeetId.handlers.POST(post("/auth/sign-out", undefined, { returnTo: "/goodbye" }));
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ redirectTo: "/goodbye" });
    expect(await json(await qeetId.handlers.POST(post("/auth/sign-out", undefined)))).toEqual({ redirectTo: "/" });
  });

  it("drops a returnTo that isn't a path on this site", async () => {
    const response = await qeetId.handlers.POST(post("/auth/sign-out", undefined, { returnTo: "https://evil.example" }));
    expect(await json(response)).toEqual({ redirectTo: "/" });
  });

  it("still signs out when revocation fails", async () => {
    qeet.override("POST /oauth/revoke", () => new Response("down", { status: 503 }));
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.handlers.POST(post("/auth/sign-out", jar));
    expect(response.status).toBe(200);
    jar.take(response);
    expect(jar.names()).toEqual([]);
  });

  it("refuses a body that isn't JSON", async () => {
    const request = post("/auth/sign-out", undefined, undefined, { "content-type": "text/plain" });
    const response = await qeetId.handlers.POST(new Request(request, { body: "returnTo=/x" }));
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_request");
  });
});

describe("POST /auth/switch-organization", () => {
  it("answers 401 not_signed_in without a session", async () => {
    const response = await qeetId.handlers.POST(post("/auth/switch-organization", undefined, { organizationId: TENANT_ID }));
    expect(response.status).toBe(401);
    expect(await json(response)).toEqual({ error: { code: "not_signed_in", message: expect.any(String) } });
  });

  it("answers the session when it is already in that organisation", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.handlers.POST(post("/auth/switch-organization", jar, { organizationId: TENANT_ID }));
    expect(response.status).toBe(200);
    expect((await json(response)).session.organization.id).toBe(TENANT_ID);
  });

  it("answers 501 organization_switch_unavailable for another organisation", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.handlers.POST(post("/auth/switch-organization", jar, { organizationId: "8d1e…" }));
    expect(response.status).toBe(501);
    expectNoStore(response);
    expect((await json(response)).error.code).toBe("organization_switch_unavailable");
  });

  it.each([[undefined], [{}], [{ organizationId: 42 }], [["x"]]])("answers 400 invalid_request for %j", async (body) => {
    const response = await qeetId.handlers.POST(post("/auth/switch-organization", undefined, body));
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe("invalid_request");
  });
});

describe("CSRF", () => {
  it.each([
    ["no X-Qeet-ID-Request header", { "x-qeet-id-request": "" }],
    ["a wrong header value", { "x-qeet-id-request": "true" }],
    ["Sec-Fetch-Site: cross-site", { "sec-fetch-site": "cross-site" }],
  ])("refuses a POST with %s: 403 csrf_rejected", async (_label, headers) => {
    const { jar } = await signIn(qeetId, qeet);
    for (const path of ["/auth/sign-out", "/auth/switch-organization"]) {
      const response = await qeetId.handlers.POST(post(path, jar, { organizationId: TENANT_ID }, headers));
      expect(response.status).toBe(403);
      expectNoStore(response);
      expect((await json(response)).error.code).toBe("csrf_rejected");
    }
    // Nothing happened: still signed in, nothing revoked.
    expect(qeet.callsTo("POST /oauth/revoke")).toHaveLength(0);
    expect((await json(await qeetId.handlers.GET(get("/auth/session", jar)))).session).not.toBeNull();
  });

  it("never answers with CORS headers", async () => {
    const response = await qeetId.handlers.GET(get("/auth/session", undefined, { origin: "https://evil.example" }));
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("routing", () => {
  it("answers 405 with Allow for the wrong method", async () => {
    const response = await qeetId.handlers.POST(post("/auth/session", undefined));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect((await json(response)).error.code).toBe("method_not_allowed");
    const signOut = await qeetId.handlers.GET(get("/auth/sign-out"));
    expect(signOut.status).toBe(405);
    expect(signOut.headers.get("allow")).toBe("POST");
  });

  it("answers HEAD with 405, so nothing but the browser's GET redeems a code", async () => {
    const jar = new CookieJar();
    const start = await qeetId.handlers.GET(get("/auth/sign-in", jar));
    jar.take(start);
    const callbackUrl = qeet.authorize(start.headers.get("location") ?? "");
    const head = await qeetId.handlers.GET(new Request(callbackUrl, { method: "HEAD", headers: { cookie: jar.header() } }));
    expect(head.status).toBe(405);
    expect(qeet.callsTo("POST /v1/oauth/token-code")).toHaveLength(0);
    const response = await qeetId.handlers.GET(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
    expect(response.headers.get("location")).toBe(`${APP_URL}/`);
  });

  it("answers 404 for a path that isn't a session route", async () => {
    const response = await qeetId.handlers.GET(get("/auth/nope"));
    expect(response.status).toBe(404);
    expectNoStore(response);
    expect((await json(response)).error.code).toBe("not_found");
  });

  it("serves the routes under a custom base path", async () => {
    qeetId = testQeetID(qeet, { basePath: "/account/auth" });
    expect(qeetId.basePath).toBe("/account/auth");
    const response = await qeetId.handlers.GET(get("/account/auth/sign-in"));
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("redirect_uri")).toBe(`${APP_URL}/account/auth/callback`);
    expect((await qeetId.handlers.GET(get("/auth/session"))).status).toBe(404);
  });

  it("answers 500 internal_error without leaking the cause", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("secret detail"));
      },
    });
    const request = new Request(`${APP_URL}/auth/sign-out`, {
      method: "POST",
      headers: { "x-qeet-id-request": "1", "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    const response = await qeetId.handlers.POST(request);
    expect(response.status).toBe(500);
    expectNoStore(response);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(text).not.toContain("secret detail");
  });
});
