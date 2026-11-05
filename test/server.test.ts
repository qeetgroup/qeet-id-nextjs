import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type CookieJar, signIn, testQeetID } from "./helpers/browser.js";
import { MEERA, TENANT_ID, type FakeQeetID, fakeQeetID } from "./helpers/fake-qeet-id.js";
import { AccessTokenError, type QeetIDNext, QeetIDError, RETURN_TO_HEADER } from "../src/index.js";

/** What next/headers sees: the request's cookies and headers, and whether cookies may be set here. */
const request = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
  /** A Server Component: Next.js refuses to set cookies. */
  readOnly: false,
  sets: [] as { name: string; value: string; options: unknown }[],
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [...request.cookies].map(([name, value]) => ({ name, value })),
    set(name: string, value: string, options?: { maxAge?: number }) {
      if (request.readOnly) throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
      request.sets.push({ name, value, options });
      if (options?.maxAge === 0) request.cookies.delete(name);
      else request.cookies.set(name, value);
    },
  }),
  headers: async () => request.headers,
}));

vi.mock("next/navigation", () => ({
  redirect(url: string): never {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const START = new Date("2026-11-05T09:00:00.000Z").getTime();

let qeet: FakeQeetID;
let qeetId: QeetIDNext;

function useJar(jar: CookieJar): void {
  request.cookies = new Map([...jar.cookies].map(([name, cookie]) => [name, cookie.value]));
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  request.cookies = new Map();
  request.headers = new Headers();
  request.readOnly = false;
  request.sets = [];
  qeet = await fakeQeetID();
  qeetId = testQeetID(qeet);
});

afterEach(() => {
  vi.useRealTimers();
});

async function redirectOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return (error as Error & { url: string }).url;
    throw error;
  }
  throw new Error("expected a redirect");
}

describe("getSession", () => {
  it("is null when nobody is signed in", async () => {
    expect(await qeetId.getSession()).toBeNull();
  });

  it("reads the session from the cookie, without calling Qeet ID or writing", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    const calls = qeet.calls.length;
    const session = await qeetId.getSession();
    expect(session).toMatchObject({ user: { id: MEERA.sub, name: "Meera Iyer" }, organization: { id: TENANT_ID } });
    expect(qeet.calls.length).toBe(calls);
    expect(request.sets).toEqual([]);
  });

  it("still reads a session whose access token has expired: the session lives until expiresAt", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    vi.setSystemTime(START + 3_600_000);
    expect(await qeetId.getSession()).not.toBeNull();
  });
});

describe("requireSession", () => {
  it("returns the session when there is one", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    expect((await qeetId.requireSession()).user.id).toBe(MEERA.sub);
  });

  it("redirects to sign in and back to the path the proxy recorded", async () => {
    request.headers = new Headers({ [RETURN_TO_HEADER]: "/invoices?status=due" });
    expect(await redirectOf(qeetId.requireSession())).toBe("/auth/sign-in?returnTo=%2Finvoices%3Fstatus%3Ddue");
  });

  it("prefers the returnTo it is given, and falls back to /", async () => {
    expect(await redirectOf(qeetId.requireSession({ returnTo: "/reports" }))).toBe("/auth/sign-in?returnTo=%2Freports");
    expect(await redirectOf(qeetId.requireSession())).toBe("/auth/sign-in?returnTo=%2F");
  });

  it("never returns to another site", async () => {
    request.headers = new Headers({ [RETURN_TO_HEADER]: "https://evil.example/" });
    expect(await redirectOf(qeetId.requireSession())).toBe("/auth/sign-in?returnTo=%2F");
  });
});

describe("getAccessToken", () => {
  it("throws not_signed_in without a session", async () => {
    const error = await qeetId.getAccessToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccessTokenError);
    expect(error).toBeInstanceOf(QeetIDError);
    expect((error as AccessTokenError).code).toBe("not_signed_in");
  });

  it("returns the access token while it has time left", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    const token = await qeetId.getAccessToken();
    expect(token.split(".")).toHaveLength(3);
    expect(request.sets).toEqual([]);
  });

  it("renews near expiry in a Server Action or Route Handler, and stores the new cookie", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    const first = await qeetId.getAccessToken();
    vi.setSystemTime(START + 590_000);
    const renewed = await qeetId.getAccessToken();
    expect(renewed).not.toBe(first);
    const written = request.sets.filter((set) => set.value.startsWith("v1."));
    expect(written.at(-1)?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    // The stored cookie now holds the renewed token.
    expect(await qeetId.getAccessToken()).toBe(renewed);
  });

  it("never renews in a Server Component, where the rotated refresh token couldn't be stored", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    request.readOnly = true;
    vi.setSystemTime(START + 590_000);
    // Still valid for 10 seconds: handed out as is.
    expect(await qeetId.getAccessToken()).toMatch(/\./);
    vi.setSystemTime(START + 601_000);
    const error = await qeetId.getAccessToken().catch((caught: unknown) => caught);
    expect((error as AccessTokenError).code).toBe("cookies_read_only");
    expect(qeet.callsTo("POST /v1/oauth/token-code").filter((call) => call.form?.get("grant_type") === "refresh_token")).toHaveLength(0);
  });

  it("throws session_ended and clears the cookie when Qeet ID refuses the renewal", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    qeet.override("POST /v1/oauth/token-code", () => Response.json({ error: "invalid_grant" }, { status: 400 }));
    vi.setSystemTime(START + 590_000);
    const error = await qeetId.getAccessToken().catch((caught: unknown) => caught);
    expect((error as AccessTokenError).code).toBe("session_ended");
    expect(request.cookies.size).toBe(0);
  });

  it("hands out a still-valid token when Qeet ID can't be reached, and throws session_unavailable once it expires", async () => {
    useJar((await signIn(qeetId, qeet)).jar);
    qeet.override("POST /v1/oauth/token-code", () => new Response("down", { status: 503 }));
    vi.setSystemTime(START + 590_000);
    expect(await qeetId.getAccessToken()).toMatch(/\./);
    vi.setSystemTime(START + 601_000);
    const error = await qeetId.getAccessToken().catch((caught: unknown) => caught);
    expect((error as AccessTokenError).code).toBe("session_unavailable");
  });

  it("hands out the token without a refresh token until it expires", async () => {
    qeet.issueRefreshTokens = false;
    useJar((await signIn(qeetId, qeet)).jar);
    vi.setSystemTime(START + 590_000);
    expect(await qeetId.getAccessToken()).toMatch(/\./);
    vi.setSystemTime(START + 600_000);
    expect(((await qeetId.getAccessToken().catch((caught: unknown) => caught)) as AccessTokenError).code).toBe("not_signed_in");
  });
});
