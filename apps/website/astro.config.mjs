// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// Tailwind (v3) is applied via apps/website/postcss.config.mjs — the
// @astrojs/tailwind integration only supports Astro <= 5.
// https://astro.build/config
export default defineConfig({
  site: 'https://4gray.github.io',
  base: '/iptvnator',
  outDir: '../../dist/apps/website',
  integrations: [sitemap(), mdx()],
});
