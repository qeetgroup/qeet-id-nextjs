import { qeetId } from "../../../lib/qeet-id";

// A Route Handler: answer 401 rather than redirect, since a script calls it.
export async function GET() {
  const session = await qeetId.getSession();
  if (session === null) return Response.json({ error: "not_signed_in" }, { status: 401 });
  return Response.json({ organization: session.organization?.id, invoices: [] });
}
