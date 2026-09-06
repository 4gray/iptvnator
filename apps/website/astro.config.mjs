// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

/**
 * Repository version for the download pages' offline fallback
 * (`src/lib/downloads.ts`). Read from the workspace root through the file
 * system and injected as a build-time constant: importing the root
 * `package.json` from inside the project trips the Nx module-boundaries rule
 * ("external resources cannot be imported using a relative path"), and a
 * value fixed at build time is what the fallback needs anyway.
 */
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
);

// Tailwind (v3) is applied via apps/website/postcss.config.mjs — the
// @astrojs/tailwind integration only supports Astro <= 5.
// https://astro.build/config
export default defineConfig({
  site: 'https://4gray.github.io',
  base: '/iptvnator',
  outDir: '../../dist/apps/website',
  integrations: [sitemap(), mdx()],
  vite: {
    define: {
      __IPTVNATOR_VERSION__: JSON.stringify(version),
    },
  },
});
