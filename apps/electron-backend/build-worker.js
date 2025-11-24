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

const isProduction = process.env.NODE_ENV === 'production';

async function buildWorker() {
    try {
        console.log(`Building EPG parser worker with esbuild (${isProduction ? 'production' : 'development'})...`);

        await esbuild.build({
            entryPoints: [path.join(__dirname, 'src/app/workers/epg-parser.worker.ts')],
            bundle: true,
            platform: 'node',
            target: 'node18',
            format: 'cjs',
            outfile: path.join(__dirname, '../../dist/apps/electron-backend/workers/epg-parser.worker.js'),
            external: nodeBuiltins.map(m => `node:${m}`).concat(nodeBuiltins),
            sourcemap: !isProduction,
            minify: isProduction,
            // Resolve workspace libraries from tsconfig paths
            alias: {
                'shared-interfaces': path.join(__dirname, '../../libs/shared/interfaces/src/index.ts'),
            },
        });

        console.log('✅ Worker built successfully!');
    } catch (error) {
        console.error('❌ Worker build failed:', error);
        process.exit(1);
    }
}

buildWorker();
