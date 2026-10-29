import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const workspace = process.cwd();
const paths = JSON.parse(readFileSync('tsconfig.base.json', 'utf8'))
    .compilerOptions.paths as Record<string, string[]>;
const app = JSON.parse(
    readFileSync(resolve(workspace, 'apps/tv/public/appinfo.json'), 'utf8')
) as { id?: unknown; version?: unknown; title?: unknown; vendor?: unknown };
const appName =
    typeof app.title === 'string' && app.title.trim() ? app.title.trim() : 'unknown';
const appVersion =
    typeof app.version === 'string' && app.version.trim()
        ? app.version.trim()
        : 'unknown';
let gitCommit = 'unknown';
try {
    const value = execFileSync(
        'git',
        ['rev-parse', '--short=12', 'HEAD'],
        {
            cwd: workspace,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }
    ).trim();
    if (/^[0-9a-f]{7,12}$/i.test(value)) gitCommit = value.toLowerCase();
} catch {
    gitCommit = 'unknown';
}
const buildTimestamp = new Date().toISOString();
const buildInfo = {
    name: appName,
    version: appVersion,
    buildId: `${appVersion}-${gitCommit}-${buildTimestamp
        .replace(/[-:.TZ]/g, '')
        .replace(/000Z$/, '')}`,
    buildTimestamp,
    gitCommit,
};
export default defineConfig({
    root: resolve(workspace, 'apps/tv'),
    base: './',
    define: {
        __TV_BUILD_INFO__: JSON.stringify(buildInfo),
    },
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
                writeFileSync(
                    resolve(workspace, 'dist/apps/tv/build-info.json'),
                    `${JSON.stringify(buildInfo, null, 2)}\n`,
                    'utf8'
                );
            },
        },
    ],
    resolve: {
        alias: Object.keys(paths)
            .filter((k) => k.startsWith('@iptvnator/'))
            // Vite matches the first prefix: a sub-entrypoint must precede
            // its parent barrel, regardless of tsconfig declaration order.
            .sort((a, b) => b.length - a.length)
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
