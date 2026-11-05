/**
 * A stand-in for Qeet ID's endpoints, behind a `fetch` function: discovery,
 * JWKS, the authorization request (as `authorize`), the token endpoint with
 * PKCE checks and refresh-token rotation with reuse detection (as the server
 * does), revocation, and the two management lookups. No network.
 */

export const BASE_URL = "https://api.id.qeet.test";
export const ISSUER = "https://api.id.qeet.test";
export const CLIENT_ID = "app_brightleaf_web";
export const CLIENT_SECRET = "secret_for_tests_only";
export const TENANT_ID = "5f0c1d2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";

export interface FakeUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  tenant_id?: string;
}

export const MEERA: FakeUser = {
  sub: "0b9a2c7e-5d41-4f1e-9a3b-6c2d8e7f1a90",
  email: "meera@brightleaffoods.in",
  email_verified: true,
  name: "Meera Iyer",
  picture: "https://cdn.brightleaffoods.in/people/meera.png",
  tenant_id: TENANT_ID,
};

export interface RecordedCall {
  method: string;
  path: string;
  form: URLSearchParams | undefined;
  headers: Headers;
}

interface IssuedCode {
  user: FakeUser;
  nonce: string | null;
  challenge: string | null;
  redirectUri: string;
  scope: string;
}

interface IssuedRefresh {
  user: FakeUser;
  used: boolean;
  revoked: boolean;
}

export interface FakeQeetID {
  fetch: typeof fetch;
  calls: RecordedCall[];
  /** Plays the hosted sign-in: answers an authorization URL with the callback URL Qeet ID would redirect to. */
  authorize(authorizationUrl: string, user?: FakeUser): string;
  /** Signs a JWT with the issuer's key. */
  sign(claims: Record<string, unknown>): Promise<string>;
  /** Signs the ID tokens the token endpoint issues: `sign` unless a test replaces it. */
  signIdToken(claims: Record<string, unknown>): Promise<string>;
  /** Replaces one route's answer; return undefined to fall through to the default. */
  override(route: string, answer: (call: RecordedCall) => Response | undefined | Promise<Response | undefined>): void;
  /** How long access tokens live, in seconds. */
  accessTokenSeconds: number;
  /** Whether the token endpoint issues refresh tokens. */
  issueRefreshTokens: boolean;
  /** Every refresh token issued, newest last. */
  refreshTokens: string[];
  callsTo(route: string): RecordedCall[];
}

export async function fakeQeetID(): Promise<FakeQeetID> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const kid = "test-key-1";
  const codes = new Map<string, IssuedCode>();
  const refresh = new Map<string, IssuedRefresh>();
  const overrides = new Map<string, (call: RecordedCall) => Response | undefined | Promise<Response | undefined>>();
  const calls: RecordedCall[] = [];

  async function sign(claims: Record<string, unknown>): Promise<string> {
    const header = b64(JSON.stringify({ alg: "ES256", kid, typ: "JWT" }));
    const payload = b64(JSON.stringify(claims));
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keys.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${Buffer.from(signature).toString("base64url")}`;
  }

  async function tokens(user: FakeUser, nonce: string | null, scope: string): Promise<Response> {
    const now = Math.floor(Date.now() / 1000);
    const idClaims: Record<string, unknown> = { iss: ISSUER, sub: user.sub, aud: CLIENT_ID, iat: now, exp: now + fake.accessTokenSeconds };
    if (nonce) idClaims.nonce = nonce;
    for (const key of ["email", "email_verified", "name", "picture", "tenant_id"] as const) {
      if (user[key] !== undefined) idClaims[key] = user[key];
    }
    const body: Record<string, unknown> = {
      access_token: await sign({
        iss: ISSUER,
        sub: user.sub,
        aud: "qeet-id",
        exp: now + fake.accessTokenSeconds,
        client_id: CLIENT_ID,
        jti: random(),
      }),
      id_token: await fake.signIdToken(idClaims),
      token_type: "Bearer",
      expires_in: fake.accessTokenSeconds,
      scope,
    };
    if (fake.issueRefreshTokens) {
      const token = random();
      refresh.set(token, { user, used: false, revoked: false });
      fake.refreshTokens.push(token);
      body.refresh_token = token;
    }
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  }

  function oauthError(error: string, status = 400): Response {
    return Response.json({ error, error_description: error }, { status });
  }

  async function answer(call: RecordedCall): Promise<Response> {
    const route = `${call.method} ${call.path}`;
    const override = overrides.get(route);
    if (override) {
      const response = await override(call);
      if (response) return response;
    }
    if (route === "GET /.well-known/openid-configuration") {
      return Response.json({
        issuer: ISSUER,
        authorization_endpoint: `${BASE_URL}/v1/oauth/authorize`,
        token_endpoint: `${BASE_URL}/v1/oauth/token-code`,
        jwks_uri: `${BASE_URL}/.well-known/jwks.json`,
        end_session_endpoint: `${BASE_URL}/v1/oauth/logout`,
        revocation_endpoint: `${BASE_URL}/oauth/revoke`,
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    }
    if (route === "GET /.well-known/jwks.json") {
      return Response.json({ keys: [{ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, kid, use: "sig", alg: "ES256" }] });
    }
    if (route === "POST /v1/oauth/token-code") {
      const form = call.form ?? new URLSearchParams();
      if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return oauthError("invalid_client", 401);
      if (form.get("grant_type") === "authorization_code") {
        const issued = codes.get(form.get("code") ?? "");
        if (!issued) return oauthError("invalid_grant");
        codes.delete(form.get("code") ?? "");
        if (issued.redirectUri !== form.get("redirect_uri")) return oauthError("invalid_grant");
        if (issued.challenge !== (await s256(form.get("code_verifier") ?? ""))) return oauthError("invalid_grant");
        return tokens(issued.user, issued.nonce, issued.scope);
      }
      if (form.get("grant_type") === "refresh_token") {
        const issued = refresh.get(form.get("refresh_token") ?? "");
        if (!issued || issued.revoked) return oauthError("invalid_grant");
        if (issued.used) {
          // Reuse: assume theft and end every refresh token of the grant, as Qeet ID does.
          for (const entry of refresh.values()) entry.revoked = true;
          return oauthError("invalid_grant");
        }
        issued.used = true;
        return tokens(issued.user, null, "openid profile email offline_access");
      }
      return oauthError("unsupported_grant_type");
    }
    if (route === "POST /oauth/revoke") {
      const issued = refresh.get(call.form?.get("token") ?? "");
      if (issued) issued.revoked = true;
      return new Response(null, { status: 200 });
    }
    if (route === `GET /v1/tenants/${TENANT_ID}`) {
      return Response.json({ id: TENANT_ID, slug: "brightleaf-foods", name: "Brightleaf Foods" });
    }
    if (route === `GET /v1/users/${MEERA.sub}/tenants/${TENANT_ID}/permissions`) {
      return Response.json({
        permissions: ["invoice.read", "invoice.approve", "invoice.read"],
        grants: [
          { permission: "invoice.approve", granted_by: "role", via: "direct", role_id: "r1", role_name: "Finance approver" },
          { permission: "invoice.read", granted_by: "role", via: "direct", role_id: "r1", role_name: "Finance approver" },
        ],
      });
    }
    return Response.json({ error: { code: "not_found", message: `No route ${route}` } }, { status: 404 });
  }

  const fake: FakeQeetID = {
    calls,
    accessTokenSeconds: 600,
    issueRefreshTokens: true,
    refreshTokens: [],
    async fetch(input, init) {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      if (url.origin !== BASE_URL) throw new TypeError(`fetch to an unexpected origin: ${url.origin}`);
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === "string" ? init.body : undefined;
      const form =
        headers.get("content-type")?.startsWith("application/x-www-form-urlencoded") && body !== undefined
          ? new URLSearchParams(body)
          : undefined;
      const call: RecordedCall = { method: init?.method ?? "GET", path: url.pathname, form, headers };
      calls.push(call);
      return answer(call);
    },
    authorize(authorizationUrl, user = MEERA) {
      const url = new URL(authorizationUrl);
      const code = random();
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      codes.set(code, {
        user,
        nonce: url.searchParams.get("nonce"),
        challenge: url.searchParams.get("code_challenge"),
        redirectUri,
        scope: url.searchParams.get("scope") ?? "",
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", url.searchParams.get("state") ?? "");
      callback.searchParams.set("iss", ISSUER);
      return callback.toString();
    },
    sign,
    signIdToken: sign,
    override(route, answer) {
      overrides.set(route, answer);
    },
    callsTo(route) {
      return calls.filter((call) => `${call.method} ${call.path}` === route);
    },
  };
  return fake;
}

function b64(text: string): string {
  return Buffer.from(text).toString("base64url");
}

function random(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
}

async function s256(verifier: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
}
