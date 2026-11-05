import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@qeet-id/react/contract";

const seen = vi.hoisted(() => ({ props: undefined as Record<string, any> | undefined, refresh: vi.fn() }));

vi.mock("@qeet-id/react", () => ({
  QeetIDProvider(props: Record<string, any>) {
    seen.props = props;
    return props.children;
  },
  useSession: () => ({ session: null }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: seen.refresh }),
}));

const { QeetIDProvider, useSession } = await import("../../src/client/index.js");

const SESSION: Session = {
  user: { id: "u1", email: null, emailVerified: false, name: null, picture: null },
  organization: null,
  roles: [],
  permissions: [],
  expiresAt: "2026-11-05T21:30:00.000Z",
};

beforeEach(() => {
  seen.props = undefined;
  seen.refresh.mockClear();
});

describe("QeetIDProvider", () => {
  it("passes its props through to @qeet-id/react's provider", () => {
    const html = renderToStaticMarkup(
      <QeetIDProvider basePath="/account/auth" initialSession={SESSION}>
        <p>app</p>
      </QeetIDProvider>,
    );
    expect(html).toBe("<p>app</p>");
    expect(seen.props).toMatchObject({ basePath: "/account/auth", initialSession: SESSION });
  });

  it("refreshes the Server Components when the session changes, after the app's own handler", () => {
    const calls: string[] = [];
    seen.refresh.mockImplementation(() => calls.push("refresh"));
    const onSessionChange = vi.fn(() => calls.push("app"));
    renderToStaticMarkup(<QeetIDProvider initialSession={SESSION} onSessionChange={onSessionChange} />);
    seen.props?.onSessionChange(null, SESSION);
    expect(onSessionChange).toHaveBeenCalledWith(null, SESSION);
    expect(calls).toEqual(["app", "refresh"]);
  });

  it("refreshes without an app handler too", () => {
    renderToStaticMarkup(<QeetIDProvider />);
    seen.props?.onSessionChange(SESSION, null);
    expect(seen.refresh).toHaveBeenCalledTimes(1);
  });

  it("re-exports the rest of @qeet-id/react", () => {
    expect(useSession()).toEqual({ session: null });
  });
});
