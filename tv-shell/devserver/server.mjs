#!/usr/bin/env node
/**
 * Reference implementation of the embedded backend, in plain Node (no deps).
 *
 * It mirrors what the Android app does natively (TvShellServer.java):
 *   - serves the built IPTVnator PWA from a directory, injecting the TV layer
 *     (tvshell/tv.js) into index.html and pointing the PWA at /api
 *   - implements the web-backend contract the PWA expects:
 *       GET  /api/health
 *       GET  /api/config.js
 *       POST /api/provider-targets        { url } -> { targetId }
 *       POST /api/connectivity-guard/reset { url } -> { reset }
 *       GET  /api/parse?targetId=&userAgent=
 *       GET  /api/xtream?targetId=&...params
 *       GET  /api/stalker?targetId=&macAddress=&token=&serialNumber=&...params
 *
 * Usage: node server.mjs --www <dir> [--port 43330] [--tv <tv.js>] [--open-external]
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchText, stalkerHeaders, stalkerUrl, normalizeXtreamServerUrl, extractDrmFromRaw } from './backend-logic.mjs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(name);
    return i === -1 ? def : args[i + 1];
};
const WWW = resolve(opt('--www', join(__dirname, '..', 'www')));
const PORT = Number(opt('--port', '43330'));
const TV_JS = resolve(opt('--tv', join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'tvshell', 'tv.js')));
// The real parser (the fork IPTVnator bundles): from the monorepo's node_modules
// when the shell lives inside the IPTVnator repo, else from a sibling clone.
function findParser() {
    const candidates = [
        opt('--parser', null),
        join(__dirname, '..', '..', 'node_modules', 'iptv-playlist-parser', 'src', 'index.js'),
        join(__dirname, '..', '..', 'iptv-playlist-parser', 'src', 'index.js'),
    ].filter(Boolean);
    for (const candidate of candidates) if (existsSync(candidate)) return resolve(candidate);
    throw new Error('iptv-playlist-parser not found; pass --parser <path to src/index.js> (pnpm install in the IPTVnator repo, or git clone https://github.com/4gray/iptv-playlist-parser)');
}
const parser = require(findParser());

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.txt': 'text/plain; charset=utf-8',
    '.map': 'application/json',
};

const providerTargets = new Map();

function json(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
    });
    res.end(data);
}

function readBody(req) {
    return new Promise((resolvePromise, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function targetId(url) {
    return createHash('sha256').update(url).digest('hex');
}

function guid() {
    return Math.random().toString(36).slice(2);
}

function lastUrlSegment(value) {
    const segment = value.slice(value.lastIndexOf('/') + 1).trim();
    return segment.length > 0 ? segment : 'Playlist without title';
}

function createPlaylistObject(parsed, title, url, userAgent) {
    const timestamp = new Date().toISOString();
    const id = guid();
    return {
        id,
        _id: id,
        filename: title,
        title,
        count: parsed.items.length,
        playlist: {
            ...parsed,
            items: parsed.items.map((item) => {
                const drm = extractDrmFromRaw(typeof item.raw === 'string' ? item.raw : undefined);
                return { id: guid(), ...item, ...(drm ? { drm } : {}) };
            }),
        },
        importDate: timestamp,
        lastUsage: timestamp,
        favorites: [],
        autoRefresh: false,
        url,
        ...(userAgent ? { userAgent } : {}),
    };
}

/** Error body shape of the web backend (`normalizeProviderError`). */
function providerError(error) {
    if (error && error.status !== undefined) {
        return { message: error.statusText ?? 'Bad Gateway', status: error.status };
    }
    const code = error && typeof error.code === 'string' ? error.code : undefined;
    return { message: code ? `Bad Gateway (${code})` : 'Bad Gateway', status: 502, ...(code ? { code } : {}) };
}

function getTarget(query, res) {
    const id = (query.get('targetId') || '').trim();
    if (!id) {
        json(res, 400, { message: 'Missing targetId', status: 400 });
        return null;
    }
    const url = providerTargets.get(id);
    if (!url) {
        json(res, 404, { message: 'Provider target not found', status: 404 });
        return null;
    }
    return url;
}

function proxyParams(query, excluded) {
    const params = {};
    for (const [key, value] of query.entries()) {
        if (excluded.includes(key)) continue;
        const v = value.trim();
        if (v) params[key] = v;
    }
    return params;
}

async function handleApi(req, res, url) {
    const path = url.pathname.replace(/^\/api/, '') || '/';
    const query = url.searchParams;

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
        return json(res, 200, { status: 'ok', service: 'iptvnator-tv-shell-backend' });
    }
    if (req.method === 'GET' && path === '/config.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        return res.end(`window.__IPTVNATOR_CONFIG__ = Object.assign({}, window.__IPTVNATOR_CONFIG__, {"BACKEND_URL":"/api"});\n`);
    }
    if (req.method === 'OPTIONS') {
        res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' });
        return res.end();
    }
    if (req.method === 'POST' && path === '/provider-targets') {
        let body;
        try {
            body = JSON.parse((await readBody(req)) || '{}');
        } catch {
            body = {};
        }
        const raw = typeof body.url === 'string' ? body.url.trim() : '';
        if (!raw) return json(res, 400, { message: 'Missing url', status: 400 });
        let parsed;
        try {
            parsed = new URL(raw);
        } catch {
            return json(res, 400, { message: 'Provider URL is not valid', status: 400 });
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return json(res, 400, { message: 'Only http and https provider URLs are supported', status: 400 });
        }
        const id = targetId(parsed.href);
        providerTargets.set(id, parsed.href);
        return json(res, 200, { targetId: id });
    }
    if (req.method === 'POST' && path === '/connectivity-guard/reset') {
        await readBody(req);
        return json(res, 200, { reset: false });
    }
    if (req.method === 'GET' && path === '/parse') {
        const target = getTarget(query, res);
        if (!target) return;
        const userAgent = (query.get('userAgent') || '').trim() || undefined;
        try {
            const text = await fetchText(target, { headers: userAgent ? { 'User-Agent': userAgent } : {}, timeoutMs: 60000 });
            let parsed;
            try {
                parsed = parser.parse(text);
            } catch (e) {
                return json(res, 422, { message: e.message || 'Playlist is not valid', status: 422 });
            }
            return json(res, 200, createPlaylistObject(parsed, lastUrlSegment(target), target, userAgent));
        } catch (error) {
            const body = providerError(error);
            return json(res, body.status, body);
        }
    }
    if (req.method === 'GET' && path === '/xtream') {
        const target = getTarget(query, res);
        if (!target) return;
        const action = (query.get('action') || '').trim() || undefined;
        const connectionTest = query.get('connectionTest') === 'true';
        try {
            const base = normalizeXtreamServerUrl(target);
            const apiUrl = new URL(`${base.replace(/\/+$/, '')}/player_api.php`);
            for (const [k, v] of Object.entries(proxyParams(query, ['targetId', 'connectionTest']))) apiUrl.searchParams.set(k, v);
            const text = await fetchText(apiUrl.href, { timeoutMs: 30000 });
            let payload;
            try {
                payload = JSON.parse(text);
            } catch {
                payload = text;
            }
            return json(res, 200, { action, payload });
        } catch (error) {
            if (connectionTest) {
                return json(res, 200, { connectionFailure: describeConnectionFailure(error) });
            }
            return json(res, 200, providerError(error));
        }
    }
    if (req.method === 'GET' && path === '/stalker') {
        const target = getTarget(query, res);
        if (!target) return;
        const macAddress = (query.get('macAddress') || '').trim();
        const token = (query.get('token') || '').trim();
        const serialNumber = (query.get('serialNumber') || '').trim();
        const action = (query.get('action') || '').trim() || undefined;
        try {
            const params = proxyParams(query, ['targetId', 'macAddress', 'token', 'serialNumber', 'skipConnectionGuard']);
            if (params.action === 'handshake' && token) params.token = token;
            const { headers, requestParams } = stalkerHeaders({ macAddress, params, token, serialNumber });
            if (!macAddress) delete headers.Cookie;
            const requestUrl = stalkerUrl(target, requestParams);
            const text = await fetchText(requestUrl, { headers, timeoutMs: params.action === 'create_link' ? 60000 : 30000 });
            let payload;
            try {
                payload = JSON.parse(text);
            } catch {
                payload = text;
            }
            return json(res, 200, { action, payload });
        } catch (error) {
            return json(res, 200, providerError(error));
        }
    }
    if (req.method === 'GET' && path === '/parse-xml') {
        return json(res, 501, { message: 'EPG is not supported in the TV shell', status: 501 });
    }
    return json(res, 404, { message: 'Not found', status: 404 });
}

function describeConnectionFailure(error) {
    const status = error && error.status;
    if (typeof status === 'number' && status >= 100 && status <= 599) return { kind: 'http', status, canTryHttp: false };
    const code = error && typeof error.code === 'string' ? error.code : '';
    if (!code) return { kind: 'unknown', canTryHttp: false };
    const tls = /CERT|TLS|SSL|CRL/.test(code);
    return { kind: tls ? 'tls' : 'connection', canTryHttp: code === 'ECONNREFUSED' };
}

function serveStatic(req, res, url) {
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/tvshell/tv.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        return res.end(readFileSync(TV_JS));
    }
    if (pathname === '/assets/app-config.js') {
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
        return res.end(`window.__IPTVNATOR_CONFIG__ = {"BACKEND_URL":"/api"};\n`);
    }
    if (pathname === '/ngsw-worker.js' || pathname === '/ngsw.json') {
        // The service worker is deliberately disabled in the shell: the
        // bundle ships inside the APK, caching would only add staleness.
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('disabled');
    }
    let file = join(WWW, pathname);
    if (!file.startsWith(WWW)) {
        res.writeHead(403);
        return res.end();
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
        file = join(WWW, 'index.html');
    }
    const ext = extname(file).toLowerCase();
    if (file.endsWith('index.html')) {
        let html = readFileSync(file, 'utf8');
        html = injectTvLayer(html);
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        return res.end(html);
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
}

/**
 * Same transformation as TvShellServer.java: load the TV layer before the
 * Angular bundle (defer keeps document order), widen the layout viewport so
 * the desktop layout is used on a TV, and neutralise the base href.
 */
export function injectTvLayer(html, layoutWidth = 1280) {
    html = html.replace(/<base href="[^"]*"\s*\/?>/, '<base href="/">');
    html = html.replace(
        /<meta name="viewport"[^>]*>/,
        `<meta name="viewport" content="width=${layoutWidth}">`
    );
    html = html.replace('<script src="assets/app-config.js"', '<script src="tvshell/tv.js" defer></script>\n        <script src="assets/app-config.js"');
    return html;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
        try {
            if (url.pathname.startsWith('/api')) await handleApi(req, res, url);
            else serveStatic(req, res, url);
        } catch (error) {
            console.error('[devserver]', error);
            if (!res.headersSent) json(res, 500, { message: 'Internal error', status: 500 });
        }
    });
    server.listen(PORT, '127.0.0.1', () => console.log(`IPTVnator TV shell dev server: http://127.0.0.1:${PORT}  (www=${WWW})`));
}
