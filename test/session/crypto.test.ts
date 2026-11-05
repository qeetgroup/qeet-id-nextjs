import { describe, expect, it } from "vitest";
import { Sealer } from "../../src/session/crypto.js";

const SECRET = "first-secret-with-at-least-32-characters";
const OLD_SECRET = "older-secret-with-at-least-32-characters";

describe("Sealer", () => {
  it("unseals what it sealed", async () => {
    const sealer = new Sealer([SECRET]);
    const sealed = await sealer.seal({ user: "meera", roles: ["Finance approver"] }, "session");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(await sealer.unseal(sealed, "session")).toEqual({ user: "meera", roles: ["Finance approver"] });
  });

  it("uses a fresh IV for every seal", async () => {
    const sealer = new Sealer([SECRET]);
    expect(await sealer.seal({ a: 1 }, "session")).not.toBe(await sealer.seal({ a: 1 }, "session"));
  });

  it("doesn't put the plaintext in the cookie", async () => {
    const sealed = await new Sealer([SECRET]).seal({ token: "eyJhbGciOiJFUzI1NiJ9.secret" }, "session");
    expect(Buffer.from(sealed.slice(3), "base64url").toString("latin1")).not.toContain("secret");
  });

  it("refuses a value sealed for another purpose", async () => {
    const sealer = new Sealer([SECRET]);
    const sealed = await sealer.seal({ state: "x" }, "sign-in");
    expect(await sealer.unseal(sealed, "session")).toBeUndefined();
    expect(await sealer.unseal(sealed, "sign-in")).toEqual({ state: "x" });
  });

  it("refuses a tampered value", async () => {
    const sealer = new Sealer([SECRET]);
    const sealed = await sealer.seal({ admin: false }, "session");
    const bytes = Buffer.from(sealed.slice(3), "base64url");
    for (const index of [0, 12, bytes.length - 1]) {
      const copy = Buffer.from(bytes);
      copy[index] = (copy[index] ?? 0) ^ 1;
      expect(await sealer.unseal(`v1.${copy.toString("base64url")}`, "session")).toBeUndefined();
    }
  });

  it("refuses a value sealed with an unknown secret", async () => {
    const sealed = await new Sealer([OLD_SECRET]).seal({ a: 1 }, "session");
    expect(await new Sealer([SECRET]).unseal(sealed, "session")).toBeUndefined();
  });

  it("refuses what isn't a sealed value", async () => {
    const sealer = new Sealer([SECRET]);
    for (const value of ["", "v1.", "v2.abcd", "v1.not base64!", "v1.AAAA", "plain"]) {
      expect(await sealer.unseal(value, "session")).toBeUndefined();
    }
  });

  describe("rotation", () => {
    it("unseals with any listed secret and seals with the first", async () => {
      const before = await new Sealer([OLD_SECRET]).seal({ n: 1 }, "session");
      const rotating = new Sealer([SECRET, OLD_SECRET]);
      expect(await rotating.unseal(before, "session")).toEqual({ n: 1 });

      const after = await rotating.seal({ n: 2 }, "session");
      expect(await new Sealer([SECRET]).unseal(after, "session")).toEqual({ n: 2 });
      expect(await new Sealer([OLD_SECRET]).unseal(after, "session")).toBeUndefined();
    });
  });

  it("needs a secret", () => {
    expect(() => new Sealer([])).toThrow(TypeError);
  });
});
