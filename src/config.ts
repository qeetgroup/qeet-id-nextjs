import { DEFAULT_BASE_PATH, type SessionRoutes, sessionRoutes } from "@qeet-id/react/contract";
import { ConfigurationError } from "./errors.js";

/** Qeet ID's production API, where its OpenID Connect discovery document lives. */
export const DEFAULT_BASE_URL = "https://api.id.qeet.in";
/** The scopes asked for unless `QEET_ID_SCOPES` says otherwise. `offline_access` asks for a refresh token. */
export const DEFAULT_SCOPES: readonly string[] = Object.freeze(["openid", "profile", "email", "offline_access"]);
/** How long a session lasts without being renewed, in seconds: 7 days. */
export const DEFAULT_SESSION_MAX_AGE_SECONDS: number = 7 * 24 * 60 * 60;
/** The shortest secret accepted, in characters. */
export const MIN_SECRET_LENGTH = 32;

/** The longest a cookie may live (RFC 6265bis caps Max-Age at 400 days). */
const MAX_SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Configures `createQeetID`. Every option falls back to its environment
 * variable, so most apps pass nothing.
 */
export interface QeetIDNextOptions {
  /** Qeet ID's API, where discovery lives. `QEET_ID_BASE_URL`; default `https://api.id.qeet.in`. */
  baseUrl?: string;
  /** The application's client id. `QEET_ID_CLIENT_ID`; required. */
  clientId?: string;
  /** The application's client secret: the session routes are a confidential client. `QEET_ID_CLIENT_SECRET`; required. */
  clientSecret?: string;
  /**
   * The secret that encrypts the session cookie, at least 32 characters, or a
   * list for a rotation: the first encrypts, every one decrypts.
   * `QEET_ID_SECRET`, comma-separated for a list; required.
   */
  secret?: string | readonly string[];
  /** The app's own origin, such as `https://app.brightleaffoods.in`. `QEET_ID_APP_URL`; required. */
  appUrl?: string;
  /**
   * Where Qeet ID sends people back: register exactly this URL on the
   * application. `QEET_ID_REDIRECT_URI`; default `{appUrl}{basePath}/callback`.
   */
  redirectUri?: string;
  /**
   * Where Qeet ID sends people after signing out: register it on the
   * application. `QEET_ID_POST_LOGOUT_REDIRECT_URI`; default `{appUrl}/`.
   */
  postLogoutRedirectUri?: string;
  /** The scopes to ask for. `QEET_ID_SCOPES`, space-separated; default `openid profile email offline_access`. */
  scopes?: string | readonly string[];
  /**
   * A server-side API key, to look up the organisation's name and the
   * person's roles and permissions for the session. `QEET_ID_API_KEY`;
   * optional: without it they are `null` and `[]`.
   */
  apiKey?: string;
  /** Where the session routes are mounted. Default `/auth`. Pass the same value to `QeetIDProvider`. */
  basePath?: string;
  /** How long a session lasts without being renewed, in seconds. Default 7 days. */
  sessionMaxAgeSeconds?: number;
  /** Replaces the global `fetch` for every call to Qeet ID: for a proxy, custom TLS, or tests. */
  fetch?: typeof fetch;
}

/** The checked configuration. Internal. */
export interface Config {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  secrets: readonly string[];
  /** The app's origin, without a trailing slash. */
  appOrigin: string;
  redirectUri: string;
  /** The redirect URI's path: where the sign-in cookie is sent. */
  callbackPath: string;
  postLogoutRedirectUri: string;
  scope: string;
  apiKey: string | undefined;
  basePath: string;
  routes: SessionRoutes;
  /** Whether cookies are `Secure`: the app is served over https. */
  secure: boolean;
  sessionMaxAgeSeconds: number;
  fetch: typeof fetch | undefined;
}

type Env = Record<string, string | undefined>;

/**
 * Reads the options and the environment and checks them, collecting every
 * problem before throwing one `ConfigurationError` that lists them all.
 */
export function resolveConfig(options: QeetIDNextOptions = {}, env: Env = process.env): Config {
  const problems: string[] = [];
  const read = (option: string | undefined, name: string): string | undefined => {
    const value = option ?? env[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };

  const baseUrl = checkedUrl(read(options.baseUrl, "QEET_ID_BASE_URL") ?? DEFAULT_BASE_URL, "QEET_ID_BASE_URL (baseUrl)", problems);

  const clientId = read(options.clientId, "QEET_ID_CLIENT_ID");
  if (!clientId) problems.push("QEET_ID_CLIENT_ID (clientId) is not set: the client id of your application in Qeet ID.");

  const clientSecret = read(options.clientSecret, "QEET_ID_CLIENT_SECRET");
  if (!clientSecret) {
    problems.push(
      "QEET_ID_CLIENT_SECRET (clientSecret) is not set: the application's client secret. The session routes run on your server as a confidential client.",
    );
  }

  const secrets = readSecrets(options.secret, env.QEET_ID_SECRET);
  if (secrets.length === 0) {
    problems.push(
      `QEET_ID_SECRET (secret) is not set: at least ${MIN_SECRET_LENGTH} random characters that encrypt the session cookie, such as the output of \`openssl rand -base64 32\`.`,
    );
  } else if (secrets.some((secret) => secret.length < MIN_SECRET_LENGTH)) {
    problems.push(`QEET_ID_SECRET (secret) must be at least ${MIN_SECRET_LENGTH} characters, each one when it lists several.`);
  }

  const appUrlValue = read(options.appUrl, "QEET_ID_APP_URL");
  let appOrigin: string | undefined;
  if (!appUrlValue) {
    problems.push("QEET_ID_APP_URL (appUrl) is not set: your app's origin, such as https://app.example.com.");
  } else {
    const appUrl = checkedUrl(appUrlValue, "QEET_ID_APP_URL (appUrl)", problems);
    if (appUrl !== undefined) {
      const url = new URL(appUrl);
      if (url.pathname !== "/") problems.push("QEET_ID_APP_URL (appUrl) must be an origin, such as https://app.example.com, with no path.");
      else appOrigin = url.origin;
    }
  }

  let basePath = DEFAULT_BASE_PATH;
  let routes: SessionRoutes | undefined;
  try {
    routes = sessionRoutes(options.basePath ?? DEFAULT_BASE_PATH);
    basePath = routes.callback.slice(0, -"/callback".length) || "/";
  } catch (error) {
    problems.push(`basePath ${(error as Error).message}`);
  }

  let redirectUri: string | undefined;
  let callbackPath: string | undefined;
  const redirectValue = read(options.redirectUri, "QEET_ID_REDIRECT_URI");
  if (appOrigin !== undefined && routes !== undefined) {
    redirectUri =
      redirectValue === undefined
        ? `${appOrigin}${routes.callback}`
        : checkedUrl(redirectValue, "QEET_ID_REDIRECT_URI (redirectUri)", problems);
    if (redirectUri !== undefined) {
      const url = new URL(redirectUri);
      if (url.origin !== appOrigin) {
        problems.push(
          "QEET_ID_REDIRECT_URI (redirectUri) must be on QEET_ID_APP_URL's origin: the sign-in cookie it reads is set by this app.",
        );
      }
      callbackPath = url.pathname;
    }
  }

  let postLogoutRedirectUri: string | undefined;
  if (appOrigin !== undefined) {
    const value = read(options.postLogoutRedirectUri, "QEET_ID_POST_LOGOUT_REDIRECT_URI");
    postLogoutRedirectUri =
      value === undefined ? `${appOrigin}/` : checkedUrl(value, "QEET_ID_POST_LOGOUT_REDIRECT_URI (postLogoutRedirectUri)", problems);
  }

  const scopes = readScopes(options.scopes, env.QEET_ID_SCOPES);
  if (!scopes.includes("openid")) problems.push("QEET_ID_SCOPES (scopes) must include openid: the session is built from the ID token.");

  const sessionMaxAgeSeconds = options.sessionMaxAgeSeconds ?? DEFAULT_SESSION_MAX_AGE_SECONDS;
  if (!Number.isInteger(sessionMaxAgeSeconds) || sessionMaxAgeSeconds < 60 || sessionMaxAgeSeconds > MAX_SESSION_MAX_AGE_SECONDS) {
    problems.push(`sessionMaxAgeSeconds must be a whole number of seconds from 60 to ${MAX_SESSION_MAX_AGE_SECONDS} (400 days).`);
  }

  if (options.fetch !== undefined && typeof options.fetch !== "function") problems.push("fetch must be a function.");

  if (
    problems.length > 0 ||
    baseUrl === undefined ||
    clientId === undefined ||
    clientSecret === undefined ||
    appOrigin === undefined ||
    routes === undefined ||
    redirectUri === undefined ||
    callbackPath === undefined ||
    postLogoutRedirectUri === undefined
  ) {
    throw new ConfigurationError(problems);
  }

  return {
    baseUrl,
    clientId,
    clientSecret,
    secrets,
    appOrigin,
    redirectUri,
    callbackPath,
    postLogoutRedirectUri,
    scope: scopes.join(" "),
    apiKey: read(options.apiKey, "QEET_ID_API_KEY"),
    basePath,
    routes,
    secure: appOrigin.startsWith("https:"),
    sessionMaxAgeSeconds,
    fetch: options.fetch,
  };
}

/**
 * Checks an absolute URL: https, or http for this machine only (`localhost`,
 * `*.localhost`, `127.0.0.1`, `[::1]`), with no fragment. Returns it without
 * a trailing slash on a bare origin, or records a problem.
 */
function checkedUrl(value: string, name: string, problems: string[]): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    problems.push(`${name} must be an absolute URL; got ${JSON.stringify(value)}.`);
    return undefined;
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    problems.push(`${name} must use https (plain http is allowed only for localhost).`);
    return undefined;
  }
  if (url.hash !== "" || url.username !== "" || url.password !== "") {
    problems.push(`${name} must not have a fragment or credentials.`);
    return undefined;
  }
  return url.pathname === "/" && url.search === "" ? url.origin : url.toString();
}

function readSecrets(option: string | readonly string[] | undefined, env: string | undefined): readonly string[] {
  const value = option ?? env ?? "";
  const list = typeof value === "string" ? value.split(",") : [...value];
  return Object.freeze(list.map((secret) => secret.trim()).filter((secret) => secret !== ""));
}

function readScopes(option: string | readonly string[] | undefined, env: string | undefined): readonly string[] {
  const value = option ?? (env !== undefined && env.trim() !== "" ? env : undefined);
  if (value === undefined) return DEFAULT_SCOPES;
  const list = typeof value === "string" ? value.split(/\s+/) : [...value];
  return [...new Set(list.map((scope) => scope.trim()).filter((scope) => scope !== ""))];
}
