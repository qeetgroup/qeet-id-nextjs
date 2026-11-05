"use client";

/**
 * Qeet ID for Next.js, browser side: everything `@qeet-id/react` exports, with
 * a `QeetIDProvider` that re-renders the app's Server Components whenever the
 * session changes (a sign-out, an expiry, a switch), so they never show the
 * session that ended.
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
import { QeetIDProvider as ReactQeetIDProvider, type QeetIDProviderProps } from "@qeet-id/react";
import { useRouter } from "next/navigation.js";
import { type JSX, useCallback } from "react";

export * from "@qeet-id/react";

/**
 * `@qeet-id/react`'s provider, for the App Router. Pass `initialSession` from
 * the server (`await qeetId.getSession()`) so the first render already knows
 * who is signed in, and `basePath={qeetId.basePath}` when it isn't `/auth`.
 * When the session changes it calls your `onSessionChange`, then
 * `router.refresh()`.
 */
export function QeetIDProvider(props: QeetIDProviderProps): JSX.Element {
  const router = useRouter();
  const { onSessionChange } = props;
  const handleSessionChange = useCallback<NonNullable<QeetIDProviderProps["onSessionChange"]>>(
    (session, previousSession) => {
      onSessionChange?.(session, previousSession);
      router.refresh();
    },
    [onSessionChange, router],
  );
  return <ReactQeetIDProvider {...props} onSessionChange={handleSessionChange} />;
}
