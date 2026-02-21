import http from 'http';
import express, { Request, Response } from 'express';
import cors from 'cors';
import portalRouter from './app/routes/portal.route.js';
import dispatchPortalAction from './app/routes/dispatch.js';
import { resetAll } from './app/data-store.js';
import { SCENARIOS } from './app/scenarios.js';

const PORT = parseInt(process.env['PORT'] ?? '3210', 10);
const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log every request
app.use((req, _res, next) => {
    const action = req.query['action'] ?? '-';
    const mac =
        (req.headers['cookie'] ?? '')
            .split(';')
            .find((c) => c.trim().startsWith('mac='))
            ?.split('=')[1]
            ?.trim() ?? (req.query['macAddress'] as string) ?? 'no-mac';
    console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} action=${action} mac=${mac}`
    );
    next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Stalker portal.php endpoint (direct portal protocol, Electron mode)
app.use('/portal.php', portalRouter);

/**
 * CORS proxy compatibility endpoint — mirrors the IPTVnator backend API shape:
 *   GET /stalker?url=<portal_url>&macAddress=<mac>&action=<action>&...
 *   → { payload: <stalker_response> }
 *
 * The IPTVnator PWA sends Stalker requests to AppConfig.BACKEND_URL/stalker.
 * Playwright tests redirect those calls to this endpoint using page.route(),
 * so no app code changes are required.
 */
app.get('/stalker', (req: Request, res: Response) => {
    const { macAddress, url: _url, ...rest } = req.query as Record<string, string>;
    const mac = macAddress ?? '00:1a:79:00:00:01';

    // Build a lightweight synthetic request. We need a fresh object with mutable
    // `query` and a Cookie header containing the MAC for the handler helpers.
    const syntheticReq = {
        query: rest,
        headers: { cookie: `mac=${mac}` },
        params: {},
    } as unknown as Request;

    // Capture the JSON response and wrap it in the proxy envelope { payload: ... }
    let captured: unknown;
    const syntheticRes = {
        json: (data: unknown) => {
            captured = data;
        },
    } as unknown as Response;

    dispatchPortalAction(syntheticReq, syntheticRes);
    res.json({ payload: captured });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Reset all in-memory data (useful between Playwright test runs)
app.post('/reset', (_req: Request, res: Response) => {
    resetAll();
    res.json({ status: 'reset', timestamp: new Date().toISOString() });
});

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
process.stdin.on('end', () => { /* ignore stdin close */ });

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
    console.log('  Any other MAC generates deterministic unique data from MAC bytes.');
    console.log(`  Utilities:`);
    console.log(`    GET  http://localhost:${PORT}/health`);
    console.log(`    POST http://localhost:${PORT}/reset    (clears favorites + cache)`);
    console.log(`${divider}\n`);
});
