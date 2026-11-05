import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as server from "../src/index.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as Record<string, any>;

describe("the package", () => {
  it("reports package.json's version", () => {
    expect(server.VERSION).toBe(pkg.version);
  });

  it("exports exactly its public names from the server entry", () => {
    expect(Object.keys(server).sort()).toEqual(
      [
        "AccessTokenError",
        "ConfigurationError",
        "DEFAULT_BASE_PATH",
        "DEFAULT_BASE_URL",
        "DEFAULT_SCOPES",
        "DEFAULT_SESSION_MAX_AGE_SECONDS",
        "QeetIDError",
        "RETURN_TO_HEADER",
        "VERSION",
        "createQeetID",
        "safeReturnTo",
      ].sort(),
    );
  });

  it("marks the server entry server-only and the provider a client boundary", () => {
    expect(readFileSync(new URL("../src/index.ts", import.meta.url), "utf8")).toMatch(/^import "server-only";$/m);
    expect(readFileSync(new URL("../src/client/provider.tsx", import.meta.url), "utf8")).toMatch(/^"use client";\n/);
    // The entry itself stays a plain module, as @qeet-id/react's does.
    expect(readFileSync(new URL("../src/client/index.ts", import.meta.url), "utf8")).not.toMatch(/^"use client";$/m);
  });

  it.runIf(existsSync(new URL("../dist/client/provider.mjs", import.meta.url)))("keeps both boundaries in the build", () => {
    expect(readFileSync(new URL("../dist/client/provider.mjs", import.meta.url), "utf8")).toMatch(/^"use client";\n/);
    expect(readFileSync(new URL("../dist/index.mjs", import.meta.url), "utf8")).toContain('import "server-only";');
  });

  it("depends on next and react as peers, and on the Qeet ID packages directly", () => {
    expect(Object.keys(pkg.peerDependencies).sort()).toEqual(["next", "react"]);
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@qeet-id/node", "@qeet-id/react", "server-only"]);
  });
});
