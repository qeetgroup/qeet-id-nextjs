declare const __QEET_ID_NEXTJS_VERSION__: string | undefined;

/**
 * This package's version, sent in the User-Agent of every request to Qeet ID.
 * It is package.json's `version`, written in at build time (tsdown.config.ts),
 * so the two can't disagree.
 */
export const VERSION: string = typeof __QEET_ID_NEXTJS_VERSION__ === "string" ? __QEET_ID_NEXTJS_VERSION__ : "0.0.0-development";
