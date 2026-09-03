/// <reference types="astro/client" />

/**
 * Repository version from the workspace root `package.json`, injected at
 * build time by `astro.config.mjs` through Vite `define`. Used by the download
 * pages' offline fallback (`src/lib/downloads.ts`).
 */
declare const __IPTVNATOR_VERSION__: string;
