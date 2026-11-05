// Renews sessions ahead of expiry, and sends signed-out visitors of /dashboard
// and /invoices to sign in and back.
import { qeetId } from "./lib/qeet-id";

export default qeetId.proxy({ protect: ["/dashboard", "/invoices"] });

export const config = {
  // Everything but Next.js's own files and the static ones.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
