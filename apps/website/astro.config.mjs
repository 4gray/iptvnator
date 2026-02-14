// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  site: 'https://4gray.github.io',
  base: '/iptvnator',
  outDir: '../../dist/apps/website',
  integrations: [tailwind(), sitemap(), mdx()],
});
