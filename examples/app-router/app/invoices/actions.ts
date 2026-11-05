"use server";

import { AccessTokenError } from "@qeet-id/nextjs";
import { qeetId } from "../../lib/qeet-id";

// A Server Action is a public endpoint: check the session in it, whatever the page did.
export async function approveInvoice(invoiceId: string): Promise<{ approved: boolean }> {
  const session = await qeetId.requireSession({ returnTo: "/invoices" });
  if (!session.permissions.includes("invoice.approve")) return { approved: false };

  // Call your own API as the signed-in person. Renewed here if it's about to expire.
  let accessToken: string;
  try {
    accessToken = await qeetId.getAccessToken();
  } catch (error) {
    if (error instanceof AccessTokenError && error.code === "session_ended") return { approved: false };
    throw error;
  }
  const response = await fetch(`https://api.brightleaffoods.in/invoices/${encodeURIComponent(invoiceId)}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  return { approved: response.ok };
}
