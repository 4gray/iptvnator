import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
    root: resolve(process.cwd(), 'apps/tv-setup'),
    base: './',
    build: {
        outDir: '../../dist/apps/tv-setup',
        emptyOutDir: true,
        target: 'chrome68',
        cssCodeSplit: false,
        modulePreload: false,
        rollupOptions: {
            output: {
                entryFileNames: 'setup.js',
                assetFileNames: 'setup.[ext]',
            },
        },
    },
});
