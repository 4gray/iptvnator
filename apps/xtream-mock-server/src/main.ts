import http from 'http';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import express from 'express';
import cors from 'cors';
import { dispatchAction } from './app/routes/dispatch.js';
import { resetAll } from './app/data-store.js';
import { renderMarketingAssetSvg } from './app/generators/marketing.generator.js';

const app = express();
const PORT = parseInt(process.env['PORT'] ?? '3211', 10);
const M3U_FIXTURE = `#EXTM3U
#EXTINF:0 tvg-id="1" tvg-logo="http://channel.icons.url/img/1.png" group-title="News", Channel 1
https://example.channels/path-to-file/1.m3u8
#EXTINF:0 tvg-id="2" tvg-logo="http://channel.icons.url/img/2.png" group-title="News", Positive News TV
https://example.channels/path-to-file/2.m3u8
#EXTINF:0 tvg-id="3" tvg-logo="http://channel.icons.url/img/3.png" group-title="Sport", Sport TVX
https://example.channels/path-to-file/3.m3u8
#EXTINF:0 tvg-id="4" tvg-logo="http://channel.icons.url/img/4.png" group-title="Kids", HappyKids TV
https://example.channels/path-to-file/4.m3u8
`;
const marketingRasterAssetRoot = join(
    process.cwd(),
    'apps/xtream-mock-server/public/marketing'
);

app.use(cors());
app.use(express.json());

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', server: 'xtream-mock-server', port: PORT });
});

// ─── Reset all cached data ─────────────────────────────────────────────────────
app.post('/reset', (_req, res) => {
    resetAll();
    res.json({ status: 'reset' });
});

// ─── M3U fixture endpoint for self-hosted PWA URL import tests ───────────────
app.get('/playlist.m3u', (_req, res) => {
    res.type('audio/x-mpegurl')
        .set('Cache-Control', 'no-store')
        .send(M3U_FIXTURE);
});

// ─── Local fictional artwork for release screenshots ──────────────────────────
app.get('/assets/marketing/:kind/:slug', (req, res) => {
    const kind = req.params['kind'] as
        | 'backdrop'
        | 'episode'
        | 'logo'
        | 'poster'
        | 'season';
    const slug = req.params['slug'] ?? '';
    const size =
        typeof req.query['size'] === 'string' ? req.query['size'] : undefined;

    if (!['backdrop', 'episode', 'logo', 'poster', 'season'].includes(kind)) {
        res.status(404).send('Unknown marketing asset kind');
        return;
    }

    const rasterSlug = slug.replace(/\.(svg|png)$/i, '');
    const rasterPath = join(
        marketingRasterAssetRoot,
        kind,
        `${rasterSlug}.png`
    );

    if (existsSync(rasterPath)) {
        res.type('image/png')
            .set('Cache-Control', 'public, max-age=3600')
            .send(readFileSync(rasterPath));
        return;
    }

    res.type('image/svg+xml')
        .set('Cache-Control', 'public, max-age=3600')
        .send(renderMarketingAssetSvg(kind, slug, size));
});

// ─── Direct Xtream player_api.php endpoint ─────────────────────────────────────
app.get('/player_api.php', dispatchAction);

// ─── Stream stub endpoints (Xtream stream URLs reference these) ────────────────
// Returns a valid HLS playlist redirect for any stream type.
// In production these would be actual video streams.
const HLS_STUB = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

app.get('/live/:username/:password/:streamId.m3u8', (_req, res) => {
    res.redirect(HLS_STUB);
});

app.get('/live/:username/:password/:streamId.ts', (_req, res) => {
    res.redirect(HLS_STUB);
});

app.get('/movie/:username/:password/:streamId.:ext', (_req, res) => {
    res.redirect(HLS_STUB);
});

app.get('/series/:username/:password/:streamId.:ext', (_req, res) => {
    res.redirect(HLS_STUB);
});

app.all(
    '/timeshift/:username/:password/:duration/:start/:streamId.ts',
    (_req, res) => {
        res.redirect(HLS_STUB);
    }
);

app.all('/streaming/timeshift.php', (_req, res) => {
    res.redirect(HLS_STUB);
});

// ─── PWA CORS proxy endpoint ────────────────────────────────────────────────────
// IPTVnator PWA routes Xtream calls through:
//   GET /xtream?url=<serverUrl>&action=<action>&username=X&password=Y
// and expects: { payload: <data>, action: <action> }
app.get('/xtream', async (req, res) => {
    const { url: _url, action, ...rest } = req.query as Record<string, string>;

    const syntheticReq = {
        query: { action, ...rest },
        headers: req.headers,
        params: {},
    } as unknown as express.Request;

    // Capture response via monkey-patched json method
    let payload: unknown;
    let statusCode = 200;

    const syntheticRes = {
        json(data: unknown) {
            payload = data;
            return this;
        },
        status(code: number) {
            statusCode = code;
            return this;
        },
    } as unknown as express.Response;

    dispatchAction(syntheticReq, syntheticRes);

    if (statusCode !== 200) {
        res.status(statusCode).json({ error: payload });
        return;
    }

    res.json({ payload, action });
});

// ─── Server lifecycle ──────────────────────────────────────────────────────────
const server = http.createServer(app);

server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[xtream-mock] Port ${PORT} is already in use.`);
    } else {
        console.error('[xtream-mock] Server error:', err.message);
    }
    process.exit(1);
});

server.listen(PORT, () => {
    console.log(`[xtream-mock] Listening on http://localhost:${PORT}`);
    console.log(
        `[xtream-mock] Direct API:  http://localhost:${PORT}/player_api.php?username=user1&password=pass1&action=get_account_info`
    );
    console.log(
        `[xtream-mock] PWA proxy:   http://localhost:${PORT}/xtream?url=http://localhost:${PORT}&username=user1&password=pass1&action=get_account_info`
    );
    console.log(`[xtream-mock] Health:      http://localhost:${PORT}/health`);
});

const shutdown = () => {
    console.log('\n[xtream-mock] Shutting down...');
    server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
    console.error('[xtream-mock] Uncaught exception:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    console.error('[xtream-mock] Unhandled rejection:', reason);
    process.exit(1);
});

// When Nx (or any process manager) closes stdin, prevent auto-exit.
// The HTTP server handle is what keeps the process alive.
process.stdin.resume();
process.stdin.on('end', () => {
    /* ignore stdin close */
});
