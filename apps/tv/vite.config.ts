import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
const workspace = process.cwd();
const paths = JSON.parse(readFileSync('tsconfig.base.json', 'utf8'))
    .compilerOptions.paths as Record<string, string[]>;
export default defineConfig({
    root: resolve(workspace, 'apps/tv'),
    base: './',
    plugins: [
        preact({ devToolsEnabled: false }),
        {
            name: 'tv-runtime-contract',
            apply: 'build',
            generateBundle() {
                for (const id of this.getModuleIds()) {
                    if (
                        /^(?:node:|electron$)/.test(id) ||
                        id.includes('__vite-browser-external')
                    )
                        this.error('TV output contains a non-browser module');
                    if (
                        /node_modules\/(?:@angular|@ngrx|electron|rxjs)\//.test(
                            id
                        )
                    )
                        this.error(
                            'TV output contains a forbidden runtime dependency'
                        );
                }
            },
            closeBundle() {
                const file = resolve(workspace, 'dist/apps/tv/index.html');
                // Packaged file:// pages need a classic script, not a CORS module fetch.
                writeFileSync(
                    file,
                    readFileSync(file, 'utf8')
                        .replace(/ type="module"/g, ' defer')
                        .replace(/ crossorigin/g, '')
                );
            },
        },
    ],
    resolve: {
        alias: Object.keys(paths)
            .filter((k) => k.startsWith('@iptvnator/'))
            .map((find) => ({
                find,
                replacement: resolve(workspace, paths[find][0]),
            })),
    },
    server: { port: 4310, strictPort: true },
    build: {
        outDir: '../../dist/apps/tv',
        emptyOutDir: true,
        target: ['chrome68', 'es2018'],
        cssTarget: 'chrome68',
        modulePreload: false,
        rollupOptions: {
            output: { format: 'iife' },
        },
    },
});
