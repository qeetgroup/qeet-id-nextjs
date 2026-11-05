import { describe, expect, it } from "vitest";
import {
  MAX_COOKIE_VALUE_LENGTH,
  applyWrites,
  chunkedWrites,
  cookieHeader,
  parseCookieHeader,
  readChunked,
  sessionCookieName,
  signInCookieName,
} from "../../src/session/cookies.js";

const ATTRIBUTES = { httpOnly: true as const, secure: true, sameSite: "lax" as const, path: "/" };

describe("cookie names", () => {
  it("uses the __Host-Http- prefix over https and none on localhost", () => {
    expect(sessionCookieName(true)).toBe("__Host-Http-qeet-id-session");
    expect(sessionCookieName(false)).toBe("qeet-id-session");
  });

  it("keys the sign-in cookie by state, with __Secure- over https", () => {
    expect(signInCookieName(true, "abc")).toBe("__Secure-qeet-id-sign-in.abc");
    expect(signInCookieName(false, "abc")).toBe("qeet-id-sign-in.abc");
  });
});

describe("parseCookieHeader", () => {
  it("reads name=value pairs and skips junk", () => {
    expect(parseCookieHeader("a=1; b = two ; junk; =x; c=d=e")).toEqual([
      { name: "a", value: "1" },
      { name: "b", value: "two" },
      { name: "c", value: "d=e" },
    ]);
    expect(parseCookieHeader(null)).toEqual([]);
  });

  it("round-trips through cookieHeader", () => {
    const cookies = [
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ];
    expect(parseCookieHeader(cookieHeader(cookies))).toEqual(cookies);
  });
});

describe("chunking", () => {
  it("keeps a short value in one cookie", () => {
    const writes = chunkedWrites("s", "value", [], ATTRIBUTES, 60);
    expect(writes).toEqual([{ name: "s", value: "value", attributes: { ...ATTRIBUTES, maxAge: 60 } }]);
  });

  it("splits a long value into chunks that read back whole", () => {
    const value = "x".repeat(MAX_COOKIE_VALUE_LENGTH * 2 + 10);
    const writes = chunkedWrites("s", value, [], ATTRIBUTES, 60);
    expect(writes.map((write) => write.name)).toEqual(["s.0", "s.1", "s.2"]);
    expect(writes.every((write) => write.value.length <= MAX_COOKIE_VALUE_LENGTH)).toBe(true);
    expect(readChunked(applyWrites([], writes), "s")).toBe(value);
  });

  it("deletes the chunks a shorter value no longer uses", () => {
    const existing = [
      { name: "s.0", value: "a" },
      { name: "s.1", value: "b" },
      { name: "s.2", value: "c" },
      { name: "other", value: "kept" },
      { name: "s.extra", value: "not a chunk" },
    ];
    const writes = chunkedWrites("s", "short", existing, ATTRIBUTES, 60);
    expect(writes.map((write) => [write.name, write.attributes.maxAge])).toEqual([
      ["s", 60],
      ["s.0", 0],
      ["s.1", 0],
      ["s.2", 0],
    ]);
    const after = applyWrites(existing, writes);
    expect(after).toEqual([
      { name: "other", value: "kept" },
      { name: "s.extra", value: "not a chunk" },
      { name: "s", value: "short" },
    ]);
    expect(readChunked(after, "s")).toBe("short");
  });

  it("deletes every cookie of the value for null", () => {
    const existing = [
      { name: "s", value: "old" },
      { name: "s.0", value: "a" },
    ];
    const writes = chunkedWrites("s", null, existing, ATTRIBUTES, 0);
    expect(writes.map((write) => [write.name, write.value, write.attributes.maxAge])).toEqual([
      ["s", "", 0],
      ["s.0", "", 0],
    ]);
    expect(readChunked(applyWrites(existing, writes), "s")).toBeUndefined();
  });

  it("reads nothing when there is nothing", () => {
    expect(readChunked([], "s")).toBeUndefined();
    expect(readChunked([{ name: "s", value: "" }], "s")).toBeUndefined();
  });
});
