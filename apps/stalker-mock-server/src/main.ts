import http from 'http';
import { join } from 'node:path';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { buildStalkerIdentityRequestContext } from '@iptvnator/shared/interfaces';
import portalRouter, { createPortalRouter } from './app/routes/portal.route.js';
import dispatchPortalAction from './app/routes/dispatch.js';
import {
    checkRequestAuthorization,
    invalidateSession,
    resetAuthState,
} from './app/auth-store.js';
import { resetWatchdogPings } from './app/handlers/get-events.handler.js';
import { resetAll, resetMac } from './app/data-store.js';
import { renderMarketingLogoSvg } from '@iptvnator/shared/marketing-fixtures';
import { SCENARIOS } from './app/scenarios.js';
import {
    buildRequestOrigin,
    resolveMarketingPosterUrls,
} from './app/marketing-poster-url.js';

const PORT = parseInt(process.env['PORT'] ?? '3210', 10);
// Loopback by default: the fixture serves fabricated but unauthenticated
// content, so it should not be reachable from other hosts unless a dev
// explicitly opts in with HOST=0.0.0.0 (e.g. to point a phone or STB at it).
const HOST = process.env['HOST'] ?? '127.0.0.1';
const app = express();
const MARKETING_POSTER_DIRECTORY = join(
    process.cwd(),
    'apps/xtream-mock-server/public/marketing/poster'
);

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

// Marketing fixtures store deployment-neutral asset paths. Resolve them
// against the public origin of each request, including reverse-proxy headers.
// `get_all_channels` is the full ITV list the app caches per session, so the
// live-TV channel logos of the marketing scenario ride on it as well.
app.use((req, res, next) => {
    if (
        !['get_ordered_list', 'get_all_channels', 'favorites'].includes(
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

// Channel logos of the marketing-demo scenario, rendered on the fly with the
// same generator the Xtream mock uses, so a live-TV frame never fetches a
// third-party image.
app.get('/assets/marketing/logo/:slug', (req: Request, res: Response) => {
    const size =
        typeof req.query['size'] === 'string' ? req.query['size'] : undefined;
    res.type('image/svg+xml')
        .set('Cache-Control', 'public, max-age=3600')
        .send(renderMarketingLogoSvg(String(req.params['slug'] ?? ''), size));
});

// Stalker portal.php endpoint (reseller-panel alias — tolerant, no token check)
app.use('/portal.php', portalRouter);

// Canonical Ministra endpoints — enforce the Bearer token and the MAC format
// exactly like the real middleware, so the full-portal auth flow is testable.
// Both URL shapes the app classifies as "full" must land on the strict branch.
app.use('/stalker_portal/server/load.php', createPortalRouter(true));
app.use('/server/load.php', createPortalRouter(true));

// Genuine-Ministra host simulation: everything under /ministra serves ONLY
// the canonical `server/load.php` endpoint — `/ministra/portal.php` 404s like
// a real Stalker/Ministra installation (portal.php is a reseller-panel alias
// the official middleware never ships). This is what lets e2e prove the
// endpoint-discovery fallthrough: `http://host/ministra/c` must probe
// portal.php, hit the 404, and land on server/load.php in full-portal mode.
app.use('/ministra/server/load.php', createPortalRouter(true));

/**
 * Which proxied portal URLs this mock enforces the token on. It mirrors
 * `isFullStalkerPortalUrl()` in `@iptvnator/shared/interfaces` — the union of
 * the three predicates that used to diverge in the app before endpoint
 * discovery unified them.
 *
 * The app itself no longer classifies by URL shape (mode is an observed,
 * persisted fact), but a fixture has to decide strictness from the path
 * alone: it IS the behavior being observed. Every URL shape the client would
 * authenticate against must be enforced here, or tests silently exercise the
 * tolerant branch.
 */
function isFullPortalUrlShape(url: string): boolean {
    return url.includes('/stalker_portal') || url.includes('/server/load.php');
}

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
    const {
        macAddress,
        token,
        serialNumber,
        url: portalUrl,
        ...rest
    } = req.query as Record<string, unknown>;

    // A repeated query key arrives as an array, so every value used below must
    // be narrowed to a string before it reaches a string API.
    const asString = (value: unknown): string | undefined =>
        typeof value === 'string' ? value : undefined;

    const mac = asString(macAddress) ?? '00:1a:79:00:00:01';
    const bearer = asString(token);

    // Mirror of the real backend proxy: `macAddress`, `token` and
    // `serialNumber` are control params turned into the portal-facing
    // Cookie / Authorization / SN headers and STRIPPED from the query the
    // portal sees — with one protocol exception, `handshake`, which presents
    // its candidate token as a query param (that keeps the
    // idempotent-handshake path testable). The shared identity builder is the
    // same code the real proxy and the Electron transport run, so this mirror
    // cannot drift from them.
    const query: Record<string, unknown> = { ...rest };
    if (query['action'] === 'handshake' && bearer) {
        query['token'] = bearer;
    }
    const identity = buildStalkerIdentityRequestContext({
        macAddress: mac,
        params: query as Record<string, string | number>,
        ...(bearer ? { token: bearer } : {}),
        ...(asString(serialNumber)
            ? { serialNumber: asString(serialNumber) }
            : {}),
    });
    // The real proxy appends this while building the portal URL; mirror it so
    // `query_keys_received` diagnostics match what a real portal would log.
    if (!identity.requestParams['JsHttpRequest']) {
        identity.requestParams['JsHttpRequest'] = '1-xml';
    }

    // Forward the COMPLETE identity header set (Cookie, MAG UA pair, SN,
    // Authorization, Accept/Language/Connection), lowercased the way Express
    // normalizes incoming headers, so portal handlers can validate any header
    // the real proxy sends — not just the cookie and token.
    const headers: Record<string, string> = Object.fromEntries(
        Object.entries(identity.headers).map(([key, value]) => [
            key.toLowerCase(),
            value,
        ])
    );

    // Build a lightweight synthetic request. We need a fresh object with mutable
    // `query` and a Cookie header containing the MAC for the handler helpers.
    const syntheticReq = {
        query: identity.requestParams,
        headers,
        params: {},
    } as unknown as Request;

    // Capture the JSON response and wrap it in the proxy envelope { payload: ... }
    let captured: unknown;
    let plainTextBody: string | undefined;
    const syntheticRes = {
        json: (data: unknown) => {
            captured = data;
        },
        status: () => syntheticRes,
        type: () => syntheticRes,
        send: (body: string) => {
            plainTextBody = body;
        },
    } as unknown as Response & { send: (body: string) => void };

    dispatchPortalAction(syntheticReq, syntheticRes, {
        // The proxied portal URL decides strictness, matching the direct
        // endpoints: every canonical Ministra path shape enforces the token.
        enforceAuth: isFullPortalUrlShape(asString(portalUrl) ?? ''),
    });

    // The portal answers auth failures with a plain-text body; the real backend
    // proxy still wraps whatever it got in the { payload } envelope, so the
    // renderer sees the raw string there rather than a transport error.
    res.json({ payload: plainTextBody ?? captured });
});

/**
 * Auth-gated media endpoints for the `gated-stream` scenario. A real portal's
 * streamer sits behind the same session gate as the API, so these routes
 * require the mac cookie AND the MAC's Bearer token and answer 403
 * otherwise. They are the only automated proof that a player's actual media
 * requests carry the portal credentials — a unit test cannot show that a
 * header reached the video (or audio) element.
 *
 * The bodies are the shared clear (non-DRM) fragmented-MP4 fixtures from the
 * DASH e2e suite (video for ITV, audio-only for radio); `sendFile` supplies
 * Range support for progressive playback.
 */
const GATED_STREAM_FIXTURES: Record<string, string> = {
    'audio.mp4': join(
        process.cwd(),
        'apps/web-e2e/src/fixtures/dash/clear-audio.mp4'
    ),
    'video.mp4': join(
        process.cwd(),
        'apps/web-e2e/src/fixtures/dash/clear-video.mp4'
    ),
};

app.get('/stream/gated/:file', (req: Request, res: Response) => {
    const fixture = GATED_STREAM_FIXTURES[req.params['file'] ?? ''];
    if (!fixture) {
        res.status(404).type('text/plain').send('Not found');
        return;
    }

    const failure = checkRequestAuthorization(req, true);
    if (failure) {
        // Log only header PRESENCE: the cookie carries the mac session
        // credential and must never reach terminal/CI logs verbatim.
        console.log(
            `[gated-stream] 403 (${failure}) cookie=${
                req.headers['cookie'] ? 'present' : '<none>'
            } auth=${req.headers['authorization'] ? 'present' : '<none>'}`
        );
        res.status(403).type('text/plain').send(failure);
        return;
    }

    // `dotfiles: 'allow'`: express refuses any path with a dot-segment by
    // default, and git worktrees live under `.claude/worktrees/…` — without
    // this the fixture 404s in every worktree checkout.
    res.sendFile(fixture, {
        dotfiles: 'allow',
        headers: { 'Content-Type': 'video/mp4' },
    });
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Reset in-memory state between test runs.
 *
 * `?macAddress=<mac>` scopes the reset to that MAC and is what specs should
 * use: mock state is per-MAC, so a scoped reset cannot wipe the session of a
 * spec file running concurrently in another Playwright worker. Without the
 * parameter everything is cleared, which is only safe when nothing else is
 * talking to this server.
 */
app.post('/reset', (req: Request, res: Response) => {
    const macParam = req.query['macAddress'];
    // Repeated `macAddress` params let a suite clear all of its MACs in one
    // request instead of one round trip each.
    const macs = (Array.isArray(macParam) ? macParam : [macParam]).filter(
        (value): value is string => typeof value === 'string' && value !== ''
    );

    if (macs.length > 0) {
        for (const mac of macs) {
            resetMac(mac);
            resetAuthState(mac);
            resetWatchdogPings(mac);
        }
    } else {
        resetAll();
        resetAuthState();
        resetWatchdogPings();
    }

    res.json({
        status: 'reset',
        ...(macs.length > 0 ? { macs } : {}),
        timestamp: new Date().toISOString(),
    });
});

/**
 * Drop a MAC's session so the next portal request fails with
 * `Authorization failed.` — lets e2e assert the client re-handshakes and
 * retries instead of surfacing an error.
 */
app.post('/invalidate-session', (req: Request, res: Response) => {
    const macParam = req.query['macAddress'];
    const mac = typeof macParam === 'string' ? macParam : '';
    if (!mac) {
        res.status(400).json({ error: 'macAddress query param is required' });
        return;
    }
    invalidateSession(mac);
    res.json({ status: 'invalidated', mac });
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

server.listen(PORT, HOST, () => {
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
