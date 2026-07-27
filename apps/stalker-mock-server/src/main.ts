import http from 'http';
import { join } from 'node:path';
import express, { Response } from 'express';
import { SCENARIOS } from './app/scenarios.js';
import {
    buildRequestOrigin,
    resolveMarketingPosterUrls,
} from './app/marketing-poster-url.js';
import { createStalkerMockApp } from './app.js';

const PORT = parseInt(process.env['PORT'] ?? '3210', 10);
const app = express();
const MARKETING_POSTER_DIRECTORY = join(
    process.cwd(),
    'apps/xtream-mock-server/public/marketing/poster'
);

// Marketing fixtures store deployment-neutral asset paths. Resolve them
// against the public origin of each request, including reverse-proxy headers.
app.use((req, res, next) => {
    if (
        !['get_ordered_list', 'favorites'].includes(
            String(req.query['action'])
        )
    ) {
        next();
        return;
    }

    const sendJson = res.json.bind(res);
    const requestOrigin = buildRequestOrigin(req);

    res.json = ((body: unknown) =>
        sendJson(
            resolveMarketingPosterUrls(body, requestOrigin)
        )) as Response['json'];
    next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Serve the shared screenshot-safe poster catalog directly from this process.
app.use(
    '/assets/marketing/poster',
    express.static(MARKETING_POSTER_DIRECTORY, {
        fallthrough: false,
        immutable: true,
        maxAge: '1y',
    })
);

app.use(createStalkerMockApp());

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const server = http.createServer(app);

server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[stalker-mock] Port ${PORT} is already in use.`);
    } else {
        console.error('[stalker-mock] Server error:', err.message);
    }
    process.exit(1);
});

const shutdown = () => {
    console.log('\n[stalker-mock] Shutting down...');
    server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
    console.error('[stalker-mock] Uncaught exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[stalker-mock] Unhandled rejection:', reason);
    process.exit(1);
});

// When Nx (or any process manager) closes stdin, prevent auto-exit.
// The HTTP server handle is what keeps the process alive.
process.stdin.resume();
process.stdin.on('end', () => {
    /* ignore stdin close */
});

server.listen(PORT, () => {
    const divider = '─'.repeat(62);
    console.log(`\n${divider}`);
    console.log(`  🎬  Stalker Mock Server  →  http://localhost:${PORT}`);
    console.log(divider);
    console.log('  Portal URL (Electron/direct):');
    console.log(`    http://localhost:${PORT}/portal.php`);
    console.log('');
    console.log('  CORS proxy URL (PWA/Playwright e2e):');
    console.log(`    http://localhost:${PORT}/stalker?url=...&macAddress=...`);
    console.log('');
    console.log('  Predefined scenario MACs:');
    for (const [mac, scenario] of Object.entries(SCENARIOS)) {
        console.log(
            `    ${mac}  →  ${scenario.name.padEnd(16)} ${scenario.description}`
        );
    }
    console.log('');
    console.log(
        '  Any other MAC gets an isolated catalog from a MAC-derived seed.'
    );
    console.log(`  Utilities:`);
    console.log(`    GET  http://localhost:${PORT}/health`);
    console.log(
        `    POST http://localhost:${PORT}/reset    (clears favorites + cache)`
    );
    console.log(`${divider}\n`);
});
