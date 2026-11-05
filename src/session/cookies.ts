/**
 * Cookie names, attributes and chunking. Pure functions over `{ name, value }`
 * lists, so the route handlers, the proxy and `next/headers` share them.
 */

/** A cookie as a request carries it. */
export interface RequestCookie {
  name: string;
  value: string;
}

/** The attributes this package sets. Always `HttpOnly` and `SameSite=Lax`. */
export interface CookieAttributes {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  /** Seconds; 0 deletes the cookie. */
  maxAge: number;
}

/** One `Set-Cookie` to send. */
export interface CookieWrite {
  name: string;
  value: string;
  attributes: CookieAttributes;
}

/**
 * The longest value one cookie carries before the session is split into
 * `name.0`, `name.1`, … Browsers keep at least 4096 bytes per cookie, name and
 * attributes included (RFC 6265 §6.1).
 */
export const MAX_COOKIE_VALUE_LENGTH = 3800;

/**
 * The session cookie's name. Over https it has the `__Host-Http-` prefix: the
 * browser keeps it only with `Secure`, `Path=/`, no `Domain` and `HttpOnly`
 * (RFC 10017 §6.1.3.2; a browser that doesn't know `__Host-Http-` still
 * enforces `__Host-`). Plain http on localhost can't use a prefix.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? "__Host-Http-qeet-id-session" : "qeet-id-session";
}

/**
 * The sign-in cookie's name for one authorization request, keyed by its
 * `state`, so sign-ins started in two tabs don't overwrite each other. It is
 * sent only to the callback (its `Path`), so it uses `__Secure-`, which allows
 * a path.
 */
export function signInCookieName(secure: boolean, state: string): string {
  return `${secure ? "__Secure-" : ""}qeet-id-sign-in.${state}`;
}

/** Parses a `Cookie` header into its cookies, in order. Values are kept as sent. */
export function parseCookieHeader(header: string | null): RequestCookie[] {
  if (!header) return [];
  const cookies: RequestCookie[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (name !== "") cookies.push({ name, value: part.slice(index + 1).trim() });
  }
  return cookies;
}

/** Serialises cookies back into a `Cookie` header. */
export function cookieHeader(cookies: readonly RequestCookie[]): string {
  return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
}

/** Reads a value written by `chunkedWrites`: the cookie `name`, or `name.0`, `name.1`, … joined. */
export function readChunked(cookies: readonly RequestCookie[], name: string): string | undefined {
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const whole = byName.get(name);
  if (whole !== undefined && whole !== "") return whole;
  let value = "";
  for (let index = 0; byName.has(`${name}.${index}`); index++) value += byName.get(`${name}.${index}`);
  return value === "" ? undefined : value;
}

/**
 * The writes that store `value` under `name` (one cookie, or chunks when it is
 * long), or delete it when `value` is `null`, also deleting whatever chunks
 * the request carried that the new value no longer uses.
 */
export function chunkedWrites(
  name: string,
  value: string | null,
  existing: readonly RequestCookie[],
  attributes: Omit<CookieAttributes, "maxAge">,
  maxAge: number,
): CookieWrite[] {
  const writes: CookieWrite[] = [];
  const keep = new Set<string>();
  if (value !== null) {
    if (value.length <= MAX_COOKIE_VALUE_LENGTH) {
      writes.push({ name, value, attributes: { ...attributes, maxAge } });
      keep.add(name);
    } else {
      for (let index = 0; index * MAX_COOKIE_VALUE_LENGTH < value.length; index++) {
        const chunk = `${name}.${index}`;
        const start = index * MAX_COOKIE_VALUE_LENGTH;
        writes.push({ name: chunk, value: value.slice(start, start + MAX_COOKIE_VALUE_LENGTH), attributes: { ...attributes, maxAge } });
        keep.add(chunk);
      }
    }
  }
  for (const cookie of existing) {
    if (keep.has(cookie.name)) continue;
    if (cookie.name === name || isChunkOf(cookie.name, name)) {
      writes.push({ name: cookie.name, value: "", attributes: { ...attributes, maxAge: 0 } });
    }
  }
  return writes;
}

/** Applies writes to the cookies a request carries, as the browser will once it has the response. */
export function applyWrites(cookies: readonly RequestCookie[], writes: readonly CookieWrite[]): RequestCookie[] {
  const changed = new Map(writes.map((write) => [write.name, write]));
  const result = cookies.filter((cookie) => !changed.has(cookie.name));
  for (const write of writes) if (write.attributes.maxAge > 0) result.push({ name: write.name, value: write.value });
  return result;
}

function isChunkOf(cookieName: string, name: string): boolean {
  return cookieName.startsWith(`${name}.`) && /^\d+$/.test(cookieName.slice(name.length + 1));
}
