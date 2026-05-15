const esbuild = require('esbuild');
const path = require('path');

// Node.js built-in modules that should be externalized
const nodeBuiltins = [
    'assert', 'async_hooks', 'buffer', 'child_process', 'cluster',
    'console', 'constants', 'crypto', 'dgram', 'dns', 'domain',
    'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module',
    'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
    'querystring', 'readline', 'repl', 'stream', 'string_decoder',
    'sys', 'timers', 'tls', 'trace_events', 'tty', 'url', 'util',
    'v8', 'vm', 'worker_threads', 'zlib'
];

// Native modules that must be externalized (loaded at runtime)
const nativeModules = [
    'better-sqlite3',
];

const isProduction = process.env.NODE_ENV === 'production';

async function buildWorker() {
    try {
        const workers = [
            {
                label: 'EPG parser worker',
                entry: path.join(
                    __dirname,
                    'src/app/workers/epg-parser.worker.ts'
                ),
                outfile: path.join(
                    __dirname,
                    '../../dist/apps/electron-backend/workers/epg-parser.worker.js'
                ),
            },
            {
                label: 'database worker',
                entry: path.join(
                    __dirname,
                    'src/app/workers/database.worker.ts'
                ),
                outfile: path.join(
                    __dirname,
                    '../../dist/apps/electron-backend/workers/database.worker.js'
                ),
            },
            {
                label: 'playlist refresh worker',
                entry: path.join(
                    __dirname,
                    'src/app/workers/playlist-refresh.worker.ts'
                ),
                outfile: path.join(
                    __dirname,
                    '../../dist/apps/electron-backend/workers/playlist-refresh.worker.js'
                ),
            },
        ];

        for (const worker of workers) {
            console.log(
                `Building ${worker.label} with esbuild (${isProduction ? 'production' : 'development'})...`
            );

            await esbuild.build({
                entryPoints: [worker.entry],
                bundle: true,
                platform: 'node',
                target: 'node18',
                format: 'cjs',
                outfile: worker.outfile,
                external: [
                    ...nodeBuiltins.map((m) => `node:${m}`),
                    ...nodeBuiltins,
                    ...nativeModules,
                ],
                sourcemap: !isProduction,
                minify: isProduction,
                alias: {
                    '@iptvnator/shared/interfaces': path.join(
                        __dirname,
                        '../../libs/shared/interfaces/src/index.ts'
                    ),
                    '@iptvnator/shared/m3u-utils': path.join(
                        __dirname,
                        '../../libs/shared/m3u-utils/src/index.ts'
                    ),
                    '@iptvnator/shared/database': path.join(
                        __dirname,
                        '../../libs/shared/database/src/index.ts'
                    ),
                    '@iptvnator/shared/database/schema': path.join(
                        __dirname,
                        '../../libs/shared/database/src/lib/schema.ts'
                    ),
                    '@iptvnator/shared/database/path-utils': path.join(
                        __dirname,
                        '../../libs/shared/database/src/lib/path-utils.ts'
                    ),
                },
            });
        }

        console.log('✅ Workers built successfully!');
    } catch (error) {
        console.error('❌ Worker build failed:', error);
        process.exit(1);
    }
}

buildWorker();
