import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  // The same build-time VERSION as tsdown.config.ts.
  define: { __QEET_ID_NEXTJS_VERSION__: JSON.stringify(version) },
  resolve: {
    // Next.js resolves `server-only` itself; outside Next.js it throws on import.
    alias: { "server-only": new URL("./test/helpers/server-only.ts", import.meta.url).pathname },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts", "src/**/*.tsx"],
    },
  },
});
