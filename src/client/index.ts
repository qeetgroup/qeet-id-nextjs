/**
 * Qeet ID for Next.js, browser side: everything `@qeet-id/react` exports, with
 * a `QeetIDProvider` that re-renders the app's Server Components whenever the
 * session changes (a sign-out, an expiry, a switch), so they never show a
 * session that ended.
 *
 * Like `@qeet-id/react`, this module has no "use client": the provider and
 * each component and hook carry their own, so `QeetIDError`, `VERSION` and the
 * types stay importable from Server Components.
 *
 * ```tsx
 * // app/layout.tsx
 * import { QeetIDProvider } from "@qeet-id/nextjs/client";
 * import { qeetId } from "@/lib/qeet-id";
 *
 * export default async function RootLayout({ children }: { children: React.ReactNode }) {
 *   return (
 *     <html lang="en">
 *       <body>
 *         <QeetIDProvider initialSession={await qeetId.getSession()}>{children}</QeetIDProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */
export * from "@qeet-id/react";
export { QeetIDProvider } from "./provider.js";
