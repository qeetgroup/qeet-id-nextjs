import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CookieJar, get, signIn, testQeetID } from "./helpers/browser.js";
import { CLIENT_ID, ISSUER, type FakeQeetID, fakeQeetID } from "./helpers/fake-qeet-id.js";
import type { QeetIDNext } from "../src/index.js";

const SESSION_COOKIE = "__Host-Http-qeet-id-session";
const START = new Date("2026-11-05T09:00:00.000Z").getTime();

let qeet: FakeQeetID;
let qeetId: QeetIDNext;

beforeEach(async () => {
  // Only the clock is faked: the SDK's timeouts still run.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  qeet = await fakeQeetID();
  qeetId = testQeetID(qeet);
});

afterEach(() => {
  vi.useRealTimers();
});

async function session(jar: CookieJar): Promise<{ response: Response; body: any }> {
  const response = await qeetId.handlers.GET(get("/auth/session", jar));
  return { response, body: JSON.parse(await response.clone().text()) };
}

const refreshes = () => qeet.callsTo("POST /v1/oauth/token-code").filter((call) => call.form?.get("grant_type") === "refresh_token");

describe("renewal at GET /auth/session", () => {
  it("leaves a fresh access token alone", async () => {
    const { jar } = await signIn(qeetId, qeet);
    vi.setSystemTime(START + 60_000);
    const { response, body } = await session(jar);
    expect(body.session).not.toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(refreshes()).toHaveLength(0);
  });

  it("renews with the refresh token when less than a minute is left, and rolls the session on", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const before = (await session(jar)).body.session.expiresAt;
    vi.setSystemTime(START + 545_000);
    const { response, body } = await session(jar);
    expect(refreshes()).toHaveLength(1);
    expect(refreshes()[0]?.form?.get("refresh_token")).toBe(qeet.refreshTokens[0]);
    expect(Date.parse(body.session.expiresAt)).toBe(Date.parse(before) + 545_000);
    jar.take(response);
    // The new cookie carries the rotated refresh token: the next renewal uses it.
    vi.setSystemTime(START + 545_000 + 545_000);
    await session(jar);
    expect(refreshes()).toHaveLength(2);
    expect(refreshes()[1]?.form?.get("refresh_token")).toBe(qeet.refreshTokens[1]);
  });

  it("ends the session when Qeet ID refuses the refresh token", async () => {
    const { jar } = await signIn(qeetId, qeet);
    qeet.override("POST /v1/oauth/token-code", () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    vi.setSystemTime(START + 590_000);
    const { response, body } = await session(jar);
    expect(body).toEqual({ session: null });
    jar.take(response);
    expect(jar.cookies.has(SESSION_COOKIE)).toBe(false);
  });

  it("keeps the session while the access token lasts when Qeet ID can't be reached", async () => {
    const { jar } = await signIn(qeetId, qeet);
    qeet.override("POST /v1/oauth/token-code", () => new Response("bad gateway", { status: 502 }));
    vi.setSystemTime(START + 570_000);
    const usable = await session(jar);
    expect(usable.response.status).toBe(200);
    expect(usable.body.session).not.toBeNull();
    expect(usable.response.headers.getSetCookie()).toEqual([]);

    vi.setSystemTime(START + 601_000);
    const expired = await session(jar);
    expect(expired.response.status).toBe(503);
    expect(expired.response.headers.get("cache-control")).toBe("no-store");
    expect(expired.body.error.code).toBe("session_unavailable");
  });

  it("shares one renewal between requests that arrive together with the same cookie", async () => {
    const { jar } = await signIn(qeetId, qeet);
    vi.setSystemTime(START + 590_000);
    const [first, second, third] = await Promise.all([session(jar), session(jar), session(jar)]);
    expect(refreshes()).toHaveLength(1);
    for (const result of [first, second, third]) expect(result.body.session).not.toBeNull();
    // Every tab's new cookie holds the same, still-valid refresh token.
    const a = jar.copy().take(first.response);
    const b = jar.copy().take(third.response);
    vi.setSystemTime(START + 590_000 + 590_000);
    expect((await session(a)).body.session).not.toBeNull();
    expect((await session(b)).body.session).not.toBeNull();
  });

  it("reuses a renewal for a late request with the old cookie, instead of tripping reuse detection", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const stale = jar.copy();
    vi.setSystemTime(START + 590_000);
    jar.take((await session(jar)).response);
    vi.setSystemTime(START + 600_000);
    const late = await session(stale);
    expect(late.body.session).not.toBeNull();
    expect(refreshes()).toHaveLength(1);
    // Qeet ID never saw the old token twice, so the grant lives on.
    vi.setSystemTime(START + 590_000 + 590_000);
    expect((await session(jar)).body.session).not.toBeNull();
  });

  it("ends the session when the renewed ID token names someone else", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const sign = qeet.sign;
    qeet.signIdToken = (claims) => sign({ ...claims, sub: "someone-else" });
    vi.setSystemTime(START + 590_000);
    expect((await session(jar)).body).toEqual({ session: null });
  });

  it("ends a session without a refresh token when its access token expires", async () => {
    qeet.issueRefreshTokens = false;
    const { jar } = await signIn(qeetId, qeet);
    expect(jar.cookies.get(SESSION_COOKIE)?.maxAge).toBe(600);
    vi.setSystemTime(START + 590_000);
    expect((await session(jar)).body.session).not.toBeNull();
    vi.setSystemTime(START + 600_000);
    expect((await session(jar)).body).toEqual({ session: null });
    expect(refreshes()).toHaveLength(0);
  });

  it("ends a session not renewed within sessionMaxAgeSeconds", async () => {
    qeetId = testQeetID(qeet, { sessionMaxAgeSeconds: 3600 });
    qeet.accessTokenSeconds = 7200;
    const { jar } = await signIn(qeetId, qeet);
    vi.setSystemTime(START + 3_600_000);
    expect((await session(jar)).body).toEqual({ session: null });
  });

  it("keeps the user from the session when a renewal returns no ID token", async () => {
    const { jar } = await signIn(qeetId, qeet);
    qeet.override("POST /v1/oauth/token-code", (call) =>
      call.form?.get("grant_type") === "refresh_token"
        ? Response.json({ access_token: "at-2", token_type: "Bearer", expires_in: 600, refresh_token: "rt-2" })
        : undefined,
    );
    vi.setSystemTime(START + 590_000);
    const { body } = await session(jar);
    expect(body.session.user.email).toBe("meera@brightleaffoods.in");
  });

  it("checks the renewed ID token's audience", async () => {
    const { jar } = await signIn(qeetId, qeet);
    const sign = qeet.sign;
    qeet.signIdToken = (claims) => sign({ ...claims, iss: ISSUER, aud: [CLIENT_ID, "other"] });
    vi.setSystemTime(START + 590_000);
    const renewed = await session(jar);
    expect(renewed.body.session).not.toBeNull();
    jar.take(renewed.response);
    qeet.signIdToken = (claims) => sign({ ...claims, aud: "other" });
    vi.setSystemTime(START + 590_000 + 590_000);
    expect((await session(jar)).body).toEqual({ session: null });
    expect(refreshes()).toHaveLength(2);
    // Refused for the audience, not by Qeet ID: the second refresh token was fresh.
    expect(refreshes()[1]?.form?.get("refresh_token")).toBe(qeet.refreshTokens[1]);
  });
});
