"use client";

import { Protect, SignedIn, SignedOut, SignInButton, UserButton, useSession } from "@qeet-id/nextjs/client";

export function Header() {
  const { organization } = useSession();
  return (
    <header>
      <strong>{organization?.name ?? "Brightleaf Foods"}</strong>
      <Protect permission="invoice.approve">
        <a href="/invoices">Invoices to approve</a>
      </Protect>
      <SignedOut>
        <SignInButton returnTo="/dashboard" />
      </SignedOut>
      <SignedIn>
        <UserButton showName signOutReturnTo="/" />
      </SignedIn>
    </header>
  );
}
