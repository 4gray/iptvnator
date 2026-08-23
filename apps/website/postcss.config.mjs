// Replaces the deprecated @astrojs/tailwind integration (Astro <= 5 only):
// Tailwind v3 runs as a plain PostCSS plugin, which Astro/Vite picks up
// automatically from this file. The config path is resolved explicitly so the
// build does not depend on the process working directory.
import { fileURLToPath } from 'node:url';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';

const tailwindConfig = fileURLToPath(
  new URL('./tailwind.config.mjs', import.meta.url),
);

export default {
  plugins: [tailwindcss({ config: tailwindConfig }), autoprefixer()],
};
