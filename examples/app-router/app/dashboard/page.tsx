import { qeetId } from "../../lib/qeet-id";

// A Server Component: requireSession() redirects to sign in and back when nobody is.
export default async function DashboardPage() {
  const session = await qeetId.requireSession();
  return (
    <main>
      <h1>Welcome, {session.user.name ?? session.user.email}</h1>
      <p>
        Signed in to {session.organization?.name ?? "your organisation"} until {session.expiresAt}.
      </p>
    </main>
  );
}
