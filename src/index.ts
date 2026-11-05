/**
 * Qeet ID for Next.js, server side: the session routes, the proxy, and the
 * session in Server Components, Server Actions and Route Handlers. The
 * browser side is `@qeet-id/nextjs/client`.
 *
 * ```ts
 * // lib/qeet-id.ts
 * import { createQeetID } from "@qeet-id/nextjs";
 *
 * export const qeetId = createQeetID();
 * ```
 *
 * @packageDocumentation
 */
import "server-only";

export { createQeetID, type QeetIDNext } from "./qeet-id.js";
export { DEFAULT_BASE_URL, DEFAULT_SCOPES, DEFAULT_SESSION_MAX_AGE_SECONDS, type QeetIDNextOptions } from "./config.js";
export { RETURN_TO_HEADER, type ProxyOptions, type QeetIDProxy } from "./proxy.js";
export type { RouteHandlers } from "./routes.js";
export type { RequireSessionOptions } from "./server.js";
export { AccessTokenError, ConfigurationError, type AccessTokenErrorCode } from "./errors.js";
export { VERSION } from "./version.js";

// The base of every error the Qeet ID SDKs throw on purpose.
export { QeetIDError } from "@qeet-id/node";
// The session contract the routes implement.
export { DEFAULT_BASE_PATH, safeReturnTo, type Session, type SessionOrganization, type SessionUser } from "@qeet-id/react/contract";
