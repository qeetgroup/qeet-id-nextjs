// The session routes: /auth/sign-in, /auth/sign-up, /auth/callback, /auth/session,
// /auth/sign-out and /auth/switch-organization.
import { qeetId } from "../../../lib/qeet-id";

export const { GET, POST } = qeetId.handlers;
