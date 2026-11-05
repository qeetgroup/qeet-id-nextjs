"use client";

import { QeetIDProvider as ReactQeetIDProvider, type QeetIDProviderProps } from "@qeet-id/react";
import { useRouter } from "next/navigation";
import { type JSX, useCallback } from "react";

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
