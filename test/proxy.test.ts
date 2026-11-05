import { NextRequest } from "next/server.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL, CookieJar, signIn, testQeetID } from "./helpers/browser.js";
import { type FakeQeetID, fakeQeetID } from "./helpers/fake-qeet-id.js";
import { type QeetIDNext, RETURN_TO_HEADER } from "../src/index.js";

const SESSION_COOKIE = "__Host-Http-qeet-id-session";
const START = new Date("2026-11-05T09:00:00.000Z").getTime();

let qeet: FakeQeetID;
let qeetId: QeetIDNext;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  qeet = await fakeQeetID();
  qeetId = testQeetID(qeet);
});

afterEach(() => {
  vi.useRealTimers();
});

function request(path: string, jar?: CookieJar, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(path, APP_URL), {
    method: init.method ?? "GET",
    headers: { ...(jar ? { cookie: jar.header() } : {}), ...init.headers },
  });
}

/** The request headers the proxy forwarded to the app (NextResponse.next({ request: { headers } })). */
function forwarded(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("qeetId.proxy()", () => {
  it("lets every request through when nothing is protected, recording the path for requireSession", async () => {
    const proxy = qeetId.proxy();
    const response = await proxy(request("/invoices?status=due"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(forwarded(response, RETURN_TO_HEADER)).toBe("/invoices?status=due");
  });

  it("replaces a return path the browser tried to set", async () => {
    const response = await qeetId.proxy()(request("/invoices", undefined, { headers: { [RETURN_TO_HEADER]: "https://evil.example" } }));
    expect(forwarded(response, RETURN_TO_HEADER)).toBe("/invoices");
  });

  it("sends a signed-out visitor of a protected page to sign in and back", async () => {
    const proxy = qeetId.proxy({ protect: ["/dashboard", "/settings/"] });
    for (const path of ["/dashboard", "/dashboard/reports?range=week", "/settings"]) {
      const response = await proxy(request(path));
      expect(response.status).toBe(307);
      const location = new URL(response.headers.get("location") ?? "");
      expect(`${location.origin}${location.pathname}`).toBe(`${APP_URL}/auth/sign-in`);
      expect(location.searchParams.get("returnTo")).toBe(path);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("matches protected paths at segment boundaries", async () => {
    const proxy = qeetId.proxy({ protect: ["/dashboard"] });
    for (const path of ["/dashboards", "/", "/auth/sign-in", "/public/dashboard"]) {
      expect((await proxy(request(path))).headers.get("x-middleware-next")).toBe("1");
    }
  });

  it("answers 401 not_signed_in to a signed-out POST to a protected path", async () => {
    const response = await qeetId.proxy({ protect: ["/dashboard"] })(request("/dashboard", undefined, { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "not_signed_in", message: "Sign in first." } });
  });

  it("takes a function for protect", async () => {
    const proxy = qeetId.proxy({ protect: (req) => req.nextUrl.searchParams.has("private") });
    expect((await proxy(request("/page?private"))).status).toBe(307);
    expect((await proxy(request("/page"))).headers.get("x-middleware-next")).toBe("1");
  });

  it("lets a signed-in person through without touching the cookie", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const response = await qeetId.proxy({ protect: ["/dashboard"] })(request("/dashboard", jar));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(forwarded(response, "cookie")).toBe(jar.header());
  });

  it("renews ahead of expiry and hands the new cookie to this request's render", async () => {
    const { jar } = await signIn(qeetId, qeet);
    vi.setSystemTime(START + 590_000);
    const response = await qeetId.proxy()(request("/invoices", jar));
    const cookies = response.headers.getSetCookie();
    expect(cookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=v1.`))).toBe(true);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const renewed = jar.copy().take(response);
    expect(forwarded(response, "cookie")).toContain(`${SESSION_COOKIE}=${renewed.cookies.get(SESSION_COOKIE)?.value}`);
  });

  it("clears an ended session and then treats the visitor as signed out", async () => {
    const { jar } = await signIn(qeetId, qeet);
    qeet.override("POST /v1/oauth/token-code", () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    vi.setSystemTime(START + 590_000);
    const response = await qeetId.proxy({ protect: ["/dashboard"] })(request("/dashboard", jar));
    expect(response.status).toBe(307);
    jar.take(response);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("clears a session cookie that no longer opens", async () => {
    const jar = new CookieJar();
    jar.cookies.set(SESSION_COOKIE, { value: "v1.garbage", path: "/", maxAge: 60, httpOnly: true, secure: true, sameSite: "Lax" });
    const response = await qeetId.proxy()(request("/", jar));
    expect(response.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${SESSION_COOKIE}=; Path=/; Max-Age=0`))]);
    expect(forwarded(response, "cookie")).toBe("");
  });

  it("keeps the session when Qeet ID can't be reached", async () => {
    const { jar } = await signIn(qeetId, qeet);
    qeet.override("POST /v1/oauth/token-code", () => new Response("down", { status: 503 }));
    vi.setSystemTime(START + 610_000);
    const response = await qeetId.proxy({ protect: ["/dashboard"] })(request("/dashboard", jar));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("leaves the session routes to themselves", async () => {
    const { jar } = await signIn(qeetId, qeet);
    vi.setSystemTime(START + 590_000);
    const response = await qeetId.proxy({ protect: () => true })(request("/auth/session", jar));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(qeet.callsTo("POST /v1/oauth/token-code").filter((call) => call.form?.get("grant_type") === "refresh_token")).toHaveLength(0);
  });
});
