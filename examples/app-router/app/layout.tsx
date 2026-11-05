import { QeetIDProvider } from "@qeet-id/nextjs/client";
import type { ReactNode } from "react";
import { Header } from "../components/header";
import { qeetId } from "../lib/qeet-id";

// The provider starts with the server's session: no flash of "signed out".
export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QeetIDProvider initialSession={await qeetId.getSession()}>
          <Header />
          {children}
        </QeetIDProvider>
      </body>
    </html>
  );
}
