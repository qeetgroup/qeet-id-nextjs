import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SCOPES, resolveConfig } from "../src/config.js";
import { ConfigurationError, createQeetID } from "../src/index.js";
import { QeetIDError } from "@qeet-id/node";

const ENV = {
  QEET_ID_CLIENT_ID: "app_brightleaf_web",
  QEET_ID_CLIENT_SECRET: "client-secret",
  QEET_ID_SECRET: "a-test-secret-that-is-at-least-32-characters-long",
  QEET_ID_APP_URL: "https://app.brightleaffoods.in",
};

function problems(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    expect(error).toBeInstanceOf(QeetIDError);
    expect((error as ConfigurationError).code).toBe("invalid_configuration");
    return (error as ConfigurationError).problems;
  }
  throw new Error("expected a ConfigurationError");
}

describe("resolveConfig", () => {
  it("reads the environment and fills in the defaults", () => {
    const config = resolveConfig({}, ENV);
    expect(config).toMatchObject({
      baseUrl: "https://api.id.qeet.in",
      clientId: "app_brightleaf_web",
      clientSecret: "client-secret",
      appOrigin: "https://app.brightleaffoods.in",
      redirectUri: "https://app.brightleaffoods.in/auth/callback",
      callbackPath: "/auth/callback",
      postLogoutRedirectUri: "https://app.brightleaffoods.in/",
      scope: DEFAULT_SCOPES.join(" "),
      apiKey: undefined,
      basePath: "/auth",
      secure: true,
      sessionMaxAgeSeconds: 604800,
    });
    expect(config.scope).toBe("openid profile email offline_access");
  });

  it("lets options win over the environment", () => {
    const config = resolveConfig(
      {
        clientId: "from-options",
        basePath: "/account/auth",
        scopes: ["openid", "email"],
        secret: ["b".repeat(32), "a".repeat(32)],
        apiKey: "qk_test",
      },
      ENV,
    );
    expect(config.clientId).toBe("from-options");
    expect(config.redirectUri).toBe("https://app.brightleaffoods.in/account/auth/callback");
    expect(config.basePath).toBe("/account/auth");
    expect(config.routes.session).toBe("/account/auth/session");
    expect(config.scope).toBe("openid email");
    expect(config.secrets).toEqual(["b".repeat(32), "a".repeat(32)]);
    expect(config.apiKey).toBe("qk_test");
  });

  it("splits a comma-separated secret list for a rotation", () => {
    expect(resolveConfig({}, { ...ENV, QEET_ID_SECRET: ` ${"n".repeat(32)} , ${"o".repeat(32)} ` }).secrets).toEqual([
      "n".repeat(32),
      "o".repeat(32),
    ]);
  });

  it("allows plain http only on this machine, and then sets no Secure", () => {
    const local = resolveConfig(
      {},
      { ...ENV, QEET_ID_APP_URL: "http://localhost:3000", QEET_ID_BASE_URL: "http://api.dev.id.qeet.localhost" },
    );
    expect(local.secure).toBe(false);
    expect(local.redirectUri).toBe("http://localhost:3000/auth/callback");
    expect(problems(() => resolveConfig({}, { ...ENV, QEET_ID_APP_URL: "http://app.brightleaffoods.in" }))).toEqual([
      "QEET_ID_APP_URL (appUrl) must use https (plain http is allowed only for localhost).",
    ]);
  });

  it("names every missing setting at once", () => {
    const found = problems(() => resolveConfig({}, {}));
    expect(found).toHaveLength(4);
    expect(found.join("\n")).toMatch(/QEET_ID_CLIENT_ID[\s\S]*QEET_ID_CLIENT_SECRET[\s\S]*QEET_ID_SECRET[\s\S]*QEET_ID_APP_URL/);
  });

  it.each([
    [{ QEET_ID_SECRET: "too-short" }, /at least 32 characters/],
    [{ QEET_ID_APP_URL: "https://app.brightleaffoods.in/dashboard" }, /must be an origin/],
    [{ QEET_ID_APP_URL: "not a url" }, /must be an absolute URL/],
    [{ QEET_ID_BASE_URL: "https://user:pass@api.id.qeet.in" }, /fragment or credentials/],
    [{ QEET_ID_REDIRECT_URI: "https://elsewhere.example/auth/callback" }, /on QEET_ID_APP_URL's origin/],
    [{ QEET_ID_SCOPES: "profile email" }, /must include openid/],
  ])("refuses %o", (overrides, message) => {
    expect(problems(() => resolveConfig({}, { ...ENV, ...overrides })).join("\n")).toMatch(message);
  });

  it("refuses a basePath that isn't a path on this site, and an out-of-range session age", () => {
    expect(problems(() => resolveConfig({ basePath: "//evil.example" }, ENV)).join("\n")).toMatch(/basePath/);
    expect(problems(() => resolveConfig({ sessionMaxAgeSeconds: 10 }, ENV)).join("\n")).toMatch(/sessionMaxAgeSeconds/);
  });

  it("takes a redirect URI on the app's origin, with its own path", () => {
    const config = resolveConfig({}, { ...ENV, QEET_ID_REDIRECT_URI: "https://app.brightleaffoods.in/public/auth/callback" });
    expect(config.callbackPath).toBe("/public/auth/callback");
  });

  it("puts every problem in the message", () => {
    try {
      resolveConfig({}, {});
    } catch (error) {
      expect((error as Error).message).toMatch(/^Qeet ID for Next.js is not configured correctly:\n {2}- QEET_ID_CLIENT_ID/);
    }
  });
});

describe("createQeetID", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws at once when the configuration is wrong", () => {
    vi.stubEnv("QEET_ID_CLIENT_ID", "");
    expect(() => createQeetID({})).toThrow(ConfigurationError);
  });

  it("waits for the first request during next build", async () => {
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("QEET_ID_CLIENT_ID", "");
    const qeetId = createQeetID({});
    expect(qeetId.basePath).toBe("/auth");
    expect(qeetId.routes.signIn).toBe("/auth/sign-in");
    await expect(qeetId.handlers.GET(new Request("https://app.brightleaffoods.in/auth/session"))).rejects.toThrow(ConfigurationError);
  });

  it("refuses a protect path that isn't one when the proxy is made", () => {
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    const qeetId = createQeetID({});
    expect(() => qeetId.proxy({ protect: ["dashboard"] })).toThrow(TypeError);
  });
});
