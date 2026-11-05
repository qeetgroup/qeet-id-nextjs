import { readFileSync } from "node:fs";
import { defineConfig } from "tsdown";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// ES module output with declarations, one file per source module, for
// Next.js's bundler to compile. The client entry keeps its "use client"
// directive, which marks the boundary between the server and client graphs.
export default defineConfig({
  entry: ["src/index.ts", "src/client/index.tsx"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  unbundle: true,
  fixedExtension: true,
  dts: true,
  sourcemap: false,
  clean: true,
  // VERSION comes from package.json, the one place a release changes it.
  define: { __QEET_ID_NEXTJS_VERSION__: JSON.stringify(version) },
  inputOptions: {
    // Unbundled, each module keeps its own directive: "use client" stays at
    // the top of dist/client/index.mjs (test/package.test.ts checks it).
    onLog(level, log, handler) {
      if (log.code === "MODULE_LEVEL_DIRECTIVE" && log.message.includes('"use client"')) return;
      handler(level, log);
    },
  },
});
