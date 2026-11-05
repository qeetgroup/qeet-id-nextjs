import { DEFAULT_BASE_PATH, type Session, type SessionRoutes, sessionRoutes } from "@qeet-id/react/contract";
import { type Config, type QeetIDNextOptions, resolveConfig } from "./config.js";
import { ConfigurationError } from "./errors.js";
import { Oidc } from "./oidc.js";
import { type ProxyOptions, type QeetIDProxy, createProxy, protectedPaths } from "./proxy.js";
import { type RouteHandlers, createRouteHandlers } from "./routes.js";
import { type RequireSessionOptions, type ServerHelpers, createServerHelpers } from "./server.js";
import { SessionStore } from "./session/store.js";

/** Qeet ID in a Next.js app: the session routes, the proxy and the server helpers. Make one, in a module of its own. */
export interface QeetIDNext {
  /** Where the session routes live, such as `/auth`. Pass it to `QeetIDProvider` when it isn't the default. */
  readonly basePath: string;
  /** Each session route's path, such as `routes.signIn` (`/auth/sign-in`), for links. */
  readonly routes: SessionRoutes;
  /**
   * The session routes, for the catch-all route under `basePath`:
   *
   * ```ts
   * // app/auth/[...qeetid]/route.ts
   * export const { GET, POST } = qeetId.handlers;
   * ```
   */
  readonly handlers: RouteHandlers;
  /**
   * The proxy, for `proxy.ts`: renews sessions ahead of expiry and sends
   * signed-out visitors of `protect`ed paths to sign in.
   */
  proxy(options?: ProxyOptions): QeetIDProxy;
  /**
   * The signed-in person's session, or `null`. In Server Components, Server
   * Actions and Route Handlers. Reading it makes the route dynamic. It never
   * renews: the proxy and the session route do.
   */
  getSession(): Promise<Session | null>;
  /**
   * The session, or a redirect to sign in and back. Call it where protected
   * data is read: in the page, the Server Action or the Route Handler.
   */
  requireSession(options?: RequireSessionOptions): Promise<Session>;
  /**
   * An access token for calling your APIs as the signed-in person, renewed
   * when it has less than a minute left (where the cookie can be written).
   * Throws an `AccessTokenError`. Never send it to the browser.
   */
  getAccessToken(): Promise<string>;
}

interface Parts {
  config: Config;
  store: SessionStore;
  oidc: Oidc;
  handlers: RouteHandlers;
  helpers: ServerHelpers;
}

/**
 * Creates Qeet ID for this app from `options` and the environment
 * (`QEET_ID_*`). Throws a `ConfigurationError` listing every missing or
 * invalid setting; during `next build` it waits for the first request, so a
 * build without the secrets succeeds.
 *
 * ```ts
 * // lib/qeet-id.ts
 * import { createQeetID } from "@qeet-id/nextjs";
 *
 * export const qeetId = createQeetID();
 * ```
 */
export function createQeetID(options: QeetIDNextOptions = {}): QeetIDNext {
  const routes = sessionRoutes(options.basePath ?? DEFAULT_BASE_PATH);
  let parts: Parts | undefined;
  const resolved = (): Parts => {
    if (parts === undefined) {
      const config = resolveConfig(options);
      const store = new SessionStore(config);
      const oidc = new Oidc(config);
      parts = {
        config,
        store,
        oidc,
        handlers: createRouteHandlers(config, store, oidc),
        helpers: createServerHelpers(config, store, oidc),
      };
    }
    return parts;
  };
  try {
    resolved();
  } catch (error) {
    if (!(error instanceof ConfigurationError && process.env.NEXT_PHASE === "phase-production-build")) throw error;
  }

  return {
    basePath: routes.callback.slice(0, -"/callback".length) || "/",
    routes,
    handlers: {
      async GET(request) {
        return resolved().handlers.GET(request);
      },
      async POST(request) {
        return resolved().handlers.POST(request);
      },
    },
    proxy(proxyOptions = {}) {
      const isProtected = protectedPaths(proxyOptions.protect);
      let proxy: QeetIDProxy | undefined;
      return async (request) => {
        if (proxy === undefined) {
          const { config, store, oidc } = resolved();
          proxy = createProxy(config, store, oidc, isProtected);
        }
        return proxy(request);
      };
    },
    getSession: async () => resolved().helpers.getSession(),
    requireSession: async (requireOptions) => resolved().helpers.requireSession(requireOptions),
    getAccessToken: async () => resolved().helpers.getAccessToken(),
  };
}
