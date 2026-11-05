/**
 * Everything this package asks of Qeet ID, through `@qeet-id/node`: the
 * discovery document, the authorization request, the code exchange, ID token
 * verification, renewal, revocation, the sign-out address, and (with an API
 * key) the organisation's name and the person's roles and permissions.
 */
import {
  ApiError,
  type DiscoveryDocument,
  OAuthError,
  QeetID,
  type TokenResponse,
  TokenVerifier,
  type AccessTokenClaims,
  discover,
} from "@qeet-id/node";
import type { SignInErrorCode } from "@qeet-id/react/contract";
import type { Config } from "./config.js";
import type { PendingSignIn, StoredSession } from "./session/store.js";
import { VERSION } from "./version.js";

/** Renew the access token when it has less than this left: 60 seconds. */
export const RENEWAL_MARGIN_MS = 60_000;
/** How long the discovery document is reused: 1 hour. */
const DISCOVERY_TTL_MS = 60 * 60 * 1000;
/**
 * How long a renewal's answer is reused for the same refresh token: 30 s.
 * Qeet ID rotates refresh tokens and treats a second use of one as theft,
 * ending every grant of the application for that person. Requests that
 * arrive together with the same cookie share one renewal instead.
 */
const RENEWAL_REUSE_MS = 30_000;
const MAX_PENDING_RENEWALS = 1000;
/** Calls to Qeet ID made while a person waits. */
const TIMEOUT_MS = 10_000;
/** The organisation and permission lookups, which the session can do without. */
const LOOKUP_TIMEOUT_MS = 5_000;

/** A sign-in that failed at the callback, with the code the return path carries. Internal. */
export class SignInFailure extends Error {
  readonly code: SignInErrorCode;

  constructor(code: SignInErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
  }
}

/** The outcome of `renew`. */
export type Renewal =
  /** Nothing to do: the access token has time left. */
  | { status: "current"; session: StoredSession }
  /** Renewed: write the new session. */
  | { status: "renewed"; session: StoredSession }
  /** The session has ended: expired, or Qeet ID refused to renew it. Delete it. */
  | { status: "ended" }
  /** Qeet ID couldn't be reached. `usable`: the access token hasn't expired yet. */
  | { status: "unavailable"; session: StoredSession; usable: boolean };

/** The start of a sign-in: where to send the browser, and what to keep until the callback. */
export interface SignInStart {
  url: string;
  pending: PendingSignIn;
}

interface OrganizationDetails {
  name: string | null;
  roles: string[];
  permissions: string[];
}

/** Qeet ID, as the session routes use it. One per configuration; safe for concurrent use. */
export class Oidc {
  readonly #config: Config;
  readonly #client: QeetID;
  #discovery: { document: Promise<DiscoveryDocument>; fetchedAt: number } | undefined;
  #verifier: { issuer: string; jwksUrl: string; verifier: TokenVerifier } | undefined;
  readonly #renewals = new Map<string, { result: Promise<TokenResponse>; until: number }>();

  constructor(config: Config) {
    this.#config = config;
    this.#client = new QeetID({
      baseUrl: config.baseUrl,
      ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
      ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
      timeoutMs: TIMEOUT_MS,
      appInfo: { name: "qeet-id-nextjs", version: VERSION },
    });
  }

  /** The discovery document, fetched once an hour. A failed fetch is tried again by the next caller. */
  discovery(now: number = Date.now()): Promise<DiscoveryDocument> {
    if (this.#discovery === undefined || now - this.#discovery.fetchedAt > DISCOVERY_TTL_MS) {
      const document = discover({
        baseUrl: this.#config.baseUrl,
        timeoutMs: TIMEOUT_MS,
        ...(this.#config.fetch === undefined ? {} : { fetch: this.#config.fetch }),
      });
      const entry = { document, fetchedAt: now };
      this.#discovery = entry;
      document.catch(() => {
        if (this.#discovery === entry) this.#discovery = undefined;
      });
    }
    return this.#discovery.document;
  }

  /** A new authorization request: code with PKCE S256, `state` and `nonce` (OAuth 2.1, RFC 9700 §2.1.1). */
  async startSignIn(returnTo: string): Promise<SignInStart> {
    const document = await this.discovery();
    const pending: PendingSignIn = { v: 1, state: randomToken(), nonce: randomToken(), codeVerifier: randomToken(), returnTo };
    const url = new URL(document.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.#config.clientId);
    url.searchParams.set("redirect_uri", this.#config.redirectUri);
    url.searchParams.set("scope", this.#config.scope);
    url.searchParams.set("state", pending.state);
    url.searchParams.set("nonce", pending.nonce);
    url.searchParams.set("code_challenge", await s256(pending.codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");
    return { url: url.toString(), pending };
  }

  /**
   * Completes a sign-in at the callback: checks the issuer (RFC 9207),
   * exchanges the code with the PKCE verifier, verifies the ID token and its
   * nonce, and builds the session. Throws a `SignInFailure`.
   */
  async completeSignIn(code: string, iss: string | null, pending: PendingSignIn): Promise<StoredSession> {
    let document: DiscoveryDocument;
    try {
      document = await this.discovery();
    } catch (error) {
      throw new SignInFailure("session_unavailable", "Qeet ID's discovery document could not be read.", { cause: error });
    }
    // RFC 9207 §2.4: a server that says it sends `iss` must send the right one.
    if ((iss !== null || document.authorization_response_iss_parameter_supported === true) && iss !== document.issuer) {
      throw new SignInFailure("invalid_state", "The callback's issuer is not Qeet ID's.");
    }
    let tokens: TokenResponse;
    try {
      tokens = await this.#client.oauth.authorizationCodeGrant({
        client_id: this.#config.clientId,
        client_secret: this.#config.clientSecret,
        code,
        redirect_uri: this.#config.redirectUri,
        code_verifier: pending.codeVerifier,
      });
    } catch (error) {
      throw new SignInFailure("session_unavailable", "The authorization code could not be exchanged.", { cause: error });
    }
    if (typeof tokens.id_token !== "string") throw new SignInFailure("session_unavailable", "Qeet ID answered without an ID token.");
    let claims: AccessTokenClaims;
    try {
      claims = await this.#tokenVerifier(document).verify(tokens.id_token);
    } catch (error) {
      throw new SignInFailure("invalid_state", "The ID token failed verification.", { cause: error });
    }
    if (claims.nonce !== pending.nonce) throw new SignInFailure("invalid_state", "The ID token's nonce is not this sign-in's.");
    if (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.#config.clientId) {
      throw new SignInFailure("invalid_state", "The ID token was issued to another party (azp).");
    }
    return this.#session(tokens, claims, null, Date.now());
  }

  /**
   * Renews the access token when it has less than a minute left, with the
   * refresh token. Requests carrying the same refresh token share one renewal
   * in this process. Never throws.
   */
  async renew(session: StoredSession, now: number = Date.now()): Promise<Renewal> {
    if (session.expiresAt <= now) return { status: "ended" };
    if (session.accessTokenExpiresAt - now > RENEWAL_MARGIN_MS) return { status: "current", session };
    if (session.refreshToken === null) return session.accessTokenExpiresAt > now ? { status: "current", session } : { status: "ended" };
    let tokens: TokenResponse;
    try {
      tokens = await this.#refresh(session.refreshToken, now);
    } catch (error) {
      if (refused(error)) return { status: "ended" };
      return { status: "unavailable", session, usable: session.accessTokenExpiresAt > now };
    }
    // The ID token came straight from the token endpoint over TLS, so its
    // claims are read without fetching keys (OpenID Connect Core §3.1.3.7, 6).
    // It must still name the same person (§12.2).
    const claims = tokens.id_token === undefined ? undefined : decodeClaims(tokens.id_token);
    if (claims !== undefined && (claims.sub !== session.user.id || !audienceIncludes(claims.aud, this.#config.clientId))) {
      return { status: "ended" };
    }
    return { status: "renewed", session: await this.#session(tokens, claims, session, Date.now()) };
  }

  /** Revokes a refresh token and its grant (RFC 7009). Best effort: a failure leaves it to expire. */
  async revoke(refreshToken: string): Promise<void> {
    try {
      await this.#client.oauth.revoke(
        refreshToken,
        { client_id: this.#config.clientId, client_secret: this.#config.clientSecret },
        { token_type_hint: "refresh_token" },
        { timeoutMs: LOOKUP_TIMEOUT_MS, maxRetries: 0 },
      );
    } catch {
      // Ending Qeet ID's session (the sign-out's redirect) ends the grant too.
    }
  }

  /**
   * Where the browser goes to sign out of Qeet ID too: its end-session
   * endpoint with `id_token_hint`, so it doesn't ask, and the registered
   * post-logout address. `returnTo` rides in `state`. Without an ID token
   * there is no Qeet ID session to end here: the answer is `returnTo`.
   */
  async signOutUrl(idToken: string | null, returnTo: string | undefined): Promise<string> {
    if (idToken === null) return returnTo ?? "/";
    let endpoint = `${this.#config.baseUrl}/v1/oauth/logout`;
    try {
      endpoint = (await this.discovery()).end_session_endpoint ?? endpoint;
    } catch {
      // Discovery is down; the endpoint's address is fixed anyway.
    }
    const url = new URL(endpoint);
    url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set("client_id", this.#config.clientId);
    url.searchParams.set("post_logout_redirect_uri", this.#config.postLogoutRedirectUri);
    if (returnTo !== undefined) url.searchParams.set("state", returnTo);
    return url.toString();
  }

  #tokenVerifier(document: DiscoveryDocument): TokenVerifier {
    if (this.#verifier?.issuer !== document.issuer || this.#verifier.jwksUrl !== document.jwks_uri) {
      const verifier = new TokenVerifier({
        issuer: document.issuer,
        audience: this.#config.clientId,
        jwksUrl: document.jwks_uri,
        ...(this.#config.fetch === undefined ? {} : { fetch: this.#config.fetch }),
      });
      this.#verifier = { issuer: document.issuer, jwksUrl: document.jwks_uri, verifier };
    }
    return this.#verifier.verifier;
  }

  async #refresh(refreshToken: string, now: number): Promise<TokenResponse> {
    const key = await sha256(refreshToken);
    const pending = this.#renewals.get(key);
    if (pending !== undefined && pending.until > now) return pending.result;
    for (const [entry, { until }] of this.#renewals) if (until <= now) this.#renewals.delete(entry);
    while (this.#renewals.size >= MAX_PENDING_RENEWALS) this.#renewals.delete(this.#renewals.keys().next().value as string);
    const result = this.#client.oauth.refreshTokenGrant({
      client_id: this.#config.clientId,
      client_secret: this.#config.clientSecret,
      refresh_token: refreshToken,
    });
    this.#renewals.set(key, { result, until: now + RENEWAL_REUSE_MS });
    // A refusal is shared like an answer; an outage isn't, so the next request tries again.
    result.catch((error: unknown) => {
      if (!refused(error)) this.#renewals.delete(key);
    });
    return result;
  }

  async #session(
    tokens: TokenResponse,
    claims: Record<string, unknown> | undefined,
    previous: StoredSession | null,
    now: number,
  ): Promise<StoredSession> {
    // A renewal without an ID token keeps what the session knew.
    const user = claims === undefined && previous !== null ? previous.user : userFrom(claims ?? {});
    const tenantId = claims === undefined ? (previous?.organization?.id ?? null) : stringOrNull(claims.tenant_id);
    const accessTokenExpiresAt = now + Math.max(0, tokens.expires_in) * 1000;
    const refreshToken = typeof tokens.refresh_token === "string" ? tokens.refresh_token : null;
    const known = previous?.organization?.id === tenantId ? previous : null;
    const details = tenantId === null ? null : await this.#details(tenantId, user.id);
    return {
      v: 1,
      user,
      organization: tenantId === null ? null : { id: tenantId, name: details?.name ?? known?.organization?.name ?? null },
      roles: details?.roles ?? known?.roles ?? [],
      permissions: details?.permissions ?? known?.permissions ?? [],
      accessToken: tokens.access_token,
      accessTokenExpiresAt,
      refreshToken,
      idToken: tokens.id_token ?? previous?.idToken ?? null,
      expiresAt: refreshToken === null ? accessTokenExpiresAt : now + this.#config.sessionMaxAgeSeconds * 1000,
    };
  }

  /** The organisation's name and the person's roles and permissions, with the API key; `null` without one or when both lookups fail. */
  async #details(tenantId: string, userId: string): Promise<OrganizationDetails | null> {
    if (this.#config.apiKey === undefined) return null;
    const options = { timeoutMs: LOOKUP_TIMEOUT_MS, maxRetries: 0 };
    const [tenant, access] = await Promise.allSettled([
      this.#client.tenants.get(tenantId, options),
      this.#client.permissions.listEffective(tenantId, userId, options),
    ]);
    if (tenant.status === "rejected" && access.status === "rejected") return null;
    const roles = access.status === "fulfilled" ? access.value.grants.map((grant) => grant.role_name).filter(isText) : [];
    return {
      name: tenant.status === "fulfilled" && isText(tenant.value.name) ? tenant.value.name : null,
      roles: [...new Set(roles)].sort(),
      permissions: access.status === "fulfilled" ? [...new Set(access.value.permissions.filter(isText))].sort() : [],
    };
  }
}

/** Whether Qeet ID refused (rather than failed to answer): the grant is gone. */
function refused(error: unknown): boolean {
  if (error instanceof OAuthError) return true;
  return error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
}

function userFrom(claims: Record<string, unknown>): StoredSession["user"] {
  const email = stringOrNull(claims.email);
  return {
    id: typeof claims.sub === "string" ? claims.sub : "",
    email,
    emailVerified: email !== null && claims.email_verified === true,
    name: stringOrNull(claims.name),
    picture: stringOrNull(claims.picture),
  };
}

function audienceIncludes(aud: unknown, clientId: string): boolean {
  return aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
}

/** A JWT's claims, unverified, or `undefined` when it isn't one. Only for a token from the token endpoint. */
function decodeClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined || !/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && !Array.isArray(claims) ? (claims as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** 256 random bits, base64url: 43 characters, as PKCE's verifier wants (RFC 7636 §4.1). */
function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** The PKCE S256 challenge of a verifier (RFC 7636 §4.2). */
async function s256(verifier: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url");
}

async function sha256(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
}
