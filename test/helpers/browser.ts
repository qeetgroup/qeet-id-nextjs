/**
 * A browser's view of the app for the tests: a cookie jar fed by
 * `Set-Cookie`, and requests to the session routes carrying its cookies.
 */
import { type QeetIDNext, type QeetIDNextOptions, createQeetID } from "../../src/index.js";
import { BASE_URL, CLIENT_ID, CLIENT_SECRET, type FakeQeetID, type FakeUser, MEERA } from "./fake-qeet-id.js";

export const APP_URL = "https://app.brightleaffoods.in";
export const SECRET = "a-test-secret-that-is-at-least-32-characters-long";

export interface StoredCookie {
  value: string;
  path: string;
  maxAge: number | undefined;
  httpOnly: boolean;
  secure: boolean;
  sameSite: string | undefined;
}

/** Cookies as a browser keeps them (paths aren't scoped: every cookie is sent). */
export class CookieJar {
  readonly cookies: Map<string, StoredCookie> = new Map();

  /** Takes in every `Set-Cookie` of a response. */
  take(response: Response): this {
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";").map((part) => part.trim());
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const cookie: StoredCookie = {
        value: pair.slice(index + 1),
        path: "/",
        maxAge: undefined,
        httpOnly: false,
        secure: false,
        sameSite: undefined,
      };
      for (const attribute of attributes) {
        const [key = "", value = ""] = attribute.split("=");
        const lower = key.toLowerCase();
        if (lower === "path") cookie.path = value;
        else if (lower === "max-age") cookie.maxAge = Number(value);
        else if (lower === "httponly") cookie.httpOnly = true;
        else if (lower === "secure") cookie.secure = true;
        else if (lower === "samesite") cookie.sameSite = value;
      }
      if (cookie.maxAge !== undefined && cookie.maxAge <= 0) this.cookies.delete(name);
      else this.cookies.set(name, cookie);
    }
    return this;
  }

  header(): string {
    return [...this.cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join("; ");
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  copy(): CookieJar {
    const jar = new CookieJar();
    for (const [name, cookie] of this.cookies) jar.cookies.set(name, { ...cookie });
    return jar;
  }
}

/** A Qeet ID for the tests, talking to `qeet`. */
export function testQeetID(qeet: FakeQeetID, options: QeetIDNextOptions = {}): QeetIDNext {
  return createQeetID({
    baseUrl: BASE_URL,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    secret: SECRET,
    appUrl: APP_URL,
    fetch: qeet.fetch,
    ...options,
  });
}

/** A GET to the app, as a page navigation, with the jar's cookies. */
export function get(path: string, jar?: CookieJar, headers: Record<string, string> = {}): Request {
  return new Request(new URL(path, APP_URL), { headers: { ...(jar ? { cookie: jar.header() } : {}), ...headers } });
}

/** A POST to a session route as `@qeet-id/react` sends it. */
export function post(path: string, jar: CookieJar | undefined, body?: unknown, headers: Record<string, string> = {}): Request {
  return new Request(new URL(path, APP_URL), {
    method: "POST",
    headers: {
      "x-qeet-id-request": "1",
      "sec-fetch-site": "same-origin",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(jar ? { cookie: jar.header() } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Signs in through the routes and the fake hosted page; returns the browser's jar and the final redirect. */
export async function signIn(
  qeetId: QeetIDNext,
  qeet: FakeQeetID,
  options: { returnTo?: string; user?: FakeUser; jar?: CookieJar } = {},
): Promise<{ jar: CookieJar; location: string }> {
  const jar = options.jar ?? new CookieJar();
  const query = options.returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(options.returnTo)}`;
  const start = await qeetId.handlers.GET(get(`${qeetId.routes.signIn}${query}`, jar));
  jar.take(start);
  const callbackUrl = qeet.authorize(start.headers.get("location") ?? "", options.user ?? MEERA);
  const callback = await qeetId.handlers.GET(new Request(callbackUrl, { headers: { cookie: jar.header() } }));
  jar.take(callback);
  return { jar, location: callback.headers.get("location") ?? "" };
}
