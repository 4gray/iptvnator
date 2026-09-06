import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import epgParser from 'epg-parser';
import parser from 'iptv-playlist-parser';
import {
    HostConnectivityGuard,
    HostRequestToken,
} from '@iptvnator/shared/host-health';
import {
    buildStalkerIdentityRequestContext,
    buildStalkerRequestUrl,
    normalizeXtreamServerUrl,
} from '@iptvnator/shared/interfaces';
import { extractDrmFromRaw } from '@iptvnator/shared/m3u-utils';
import {
    admitProviderRequest,
    observeProviderRequest,
    PROVIDER_REQUEST_TIMEOUT_MS,
    releaseProviderRequest,
    reportProviderRequestFailure,
    reportProviderRequestSuccess,
    resetProviderHost,
} from './host-guard';
import {
    collectProviderErrorCodes,
    logProviderRequestFailure,
    normalizeProviderError,
    ProviderError,
} from './provider-error';

import {
    ValidatedHttpClient,
    WebBackendHttpClient,
} from './validated-http-client';
import { ProviderRequestError } from './provider-request-error';
import {
    ProviderUrlPolicy,
    providerUrlErrorBody,
    resolveHostname,
    validateProviderUrl,
} from './provider-url-policy';
export type {
    WebBackendHttpClient,
    WebBackendHttpGetOptions,
} from './validated-http-client';

interface PlaylistParseError {
    readonly message: string;
    readonly status: number;
    readonly code?: string;
}

export interface WebBackendAppOptions {
    readonly allowPrivateNetworkTargets?: boolean;
    readonly clientOrigins?: string[];
    readonly guid?: () => string;
    /**
     * Per-host circuit breaker for the proxy routes. One per app, so a test can
     * drive it with a fake clock the same way `now` and `guid` are injected.
     */
    readonly hostGuard?: HostConnectivityGuard;
    readonly httpClient?: WebBackendHttpClient;
    readonly now?: () => Date;
    readonly resolveHostname?: (hostname: string) => Promise<readonly string[]>;
    readonly runtimeBackendUrl?: string;
}

type ProviderTargetRegistry = Map<string, URL>;

export function createWebBackendApp(
    options: WebBackendAppOptions = {}
): Express {
    const app = express();
    const guid = options.guid ?? createGuid;
    const now = options.now ?? (() => new Date());
    const hostGuard =
        options.hostGuard ??
        new HostConnectivityGuard({
            // Host and port only — the provider URL's query string routinely
            // carries Xtream credentials and must never reach a log.
            onOpen: (host) =>
                console.warn(
                    `[web-backend] ${host} is not answering; skipping requests to it for a short while`
                ),
        });
    const clientOrigins = options.clientOrigins ?? getClientOrigins();
    const runtimeBackendUrl =
        options.runtimeBackendUrl ?? process.env['BACKEND_URL'] ?? '/api';
    const providerUrlPolicy: ProviderUrlPolicy = {
        allowPrivateNetworkTargets:
            options.allowPrivateNetworkTargets ??
            isPrivateNetworkProxyAllowed(),
        resolveHostname: options.resolveHostname ?? resolveHostname,
    };
    const httpClient = new ValidatedHttpClient(
        providerUrlPolicy,
        options.httpClient
    );
    const providerTargets: ProviderTargetRegistry = new Map();

    const corsMiddleware = cors({
        origin(origin, callback) {
            if (
                !origin ||
                clientOrigins.includes('*') ||
                clientOrigins.includes(origin)
            ) {
                callback(null, true);
                return;
            }
            callback(null, false);
        },
        optionsSuccessStatus: 200,
    });

    app.get('/', (_req, res) => res.send('IPTVnator web backend'));
    app.get('/health', (_req, res) =>
        res.json({ status: 'ok', service: 'iptvnator-web-backend' })
    );

    app.get('/config.js', corsMiddleware, (_req, res) => {
        const config = JSON.stringify({ BACKEND_URL: runtimeBackendUrl });
        res.type('application/javascript').send(
            `window.__IPTVNATOR_CONFIG__ = Object.assign({}, window.__IPTVNATOR_CONFIG__, ${config});\n`
        );
    });

    app.options('/provider-targets', corsMiddleware);
    app.post(
        '/provider-targets',
        corsMiddleware,
        express.json({ limit: '16kb' }),
        async (req, res) => {
            const rawUrl =
                req.body &&
                typeof req.body === 'object' &&
                'url' in req.body &&
                typeof req.body.url === 'string'
                    ? req.body.url
                    : undefined;

            if (!rawUrl) {
                res.status(400).json({ message: 'Missing url', status: 400 });
                return;
            }

            const result = await validateProviderUrl(rawUrl, providerUrlPolicy);
            if ('message' in result) {
                res.status(result.status).json(providerUrlErrorBody(result));
                return;
            }

            const targetId = createProviderTargetId(result.url);
            providerTargets.set(targetId, result.url);
            res.json({ targetId });
        }
    );

    app.options('/connectivity-guard/reset', corsMiddleware);
    app.post(
        '/connectivity-guard/reset',
        corsMiddleware,
        express.json({ limit: '4kb' }),
        (req, res) => {
            // Takes the raw provider URL rather than a registered targetId:
            // callers reset a host precisely when its address may have changed,
            // which is before any target exists for it. Nothing is fetched
            // here — only the host is read, so there is no SSRF surface — and
            // the URL is never logged, since its query string carries the
            // Xtream credentials.
            const rawUrl =
                req.body &&
                typeof req.body === 'object' &&
                'url' in req.body &&
                typeof req.body.url === 'string'
                    ? req.body.url
                    : undefined;

            if (!rawUrl) {
                res.status(400).json({ message: 'Missing url', status: 400 });
                return;
            }

            res.json({ reset: resetProviderHost(hostGuard, rawUrl) });
        }
    );

    app.get('/parse', corsMiddleware, async (req, res) => {
        const url = getRegisteredProviderUrl(req, res, providerTargets);
        if (!url) {
            return;
        }

        // Deliberately unguarded, matching Electron, where the breaker is
        // wired into the two portal IPC handlers and not into the playlist or
        // EPG download path. See "Scope" in the contract doc: a download is one
        // request rather than a catalog fan-out, it is usually the direct
        // result of the user asking for it, and it can legitimately run far
        // longer than any portal call.
        const result = await handlePlaylistParse({
            guid,
            httpClient,
            now,
            url: url.href,
            userAgent:
                typeof req.query.userAgent === 'string'
                    ? req.query.userAgent.trim() || undefined
                    : undefined,
        });

        if (isPlaylistParseError(result)) {
            res.status(result.status).json(result);
            return;
        }

        res.json(result);
    });

    app.get('/parse-xml', corsMiddleware, async (req, res) => {
        const url = getRegisteredProviderUrl(req, res, providerTargets);
        if (!url) {
            return;
        }

        // Unguarded for the same reasons as /parse above.
        try {
            const result = await fetchEpgDataFromUrl(httpClient, url);
            if (!result) {
                res.status(500).json({
                    message: 'Error, something went wrong',
                    status: 500,
                });
                return;
            }

            res.json(result);
        } catch (error) {
            logProviderRequestFailure({ error, route: '/parse-xml', url });
            const providerError = normalizeProviderError(error);
            res.status(providerError.status).json(providerError);
        }
    });

    app.get('/xtream', corsMiddleware, async (req, res) => {
        const registeredUrl = getRegisteredProviderUrl(
            req,
            res,
            providerTargets
        );
        if (!registeredUrl) {
            return;
        }
        const url = new URL(registeredUrl.href);

        let guardToken: HostRequestToken | null = null;
        // The URL actually requested, so a failure on a redirect hop can be
        // told apart from a failure of the endpoint we guarded.
        let requestUrl: string | undefined;
        try {
            // Before URL validation, not after: that step resolves the hostname
            // over DNS, and a dead host is exactly where DNS is slow or failing
            // too. Checking first means an open breaker answers immediately
            // with the fast-fail the caller expects, instead of paying for a
            // lookup and then reporting an unrelated "host could not be
            // resolved". Safe to key on the registered URL because
            // `normalizeXtreamServerUrl` rebuilds from `url.origin`, so
            // normalization can change the path but never the host.
            const admission = admitProviderRequest(hostGuard, url.href);
            if (!admission.allowed) {
                // This route answers provider failures with HTTP 200 and an
                // error body; a fast-fail is one of them.
                res.json(admission.error);
                return;
            }
            guardToken = admission.token;

            url.href = normalizeXtreamServerUrl(url.href);

            requestUrl = appendPathSegment(url, 'player_api.php');

            const response = await httpClient.get(requestUrl, {
                params: getProxyParams(req, ['targetId']),
                timeout: PROVIDER_REQUEST_TIMEOUT_MS.xtream,
            });
            reportProviderRequestSuccess(hostGuard, guardToken);
            guardToken = null;

            res.json({
                action: getQueryString(req, 'action'),
                payload: response.data,
            });
        } catch (error) {
            reportProviderRequestFailure(hostGuard, guardToken, error, {
                requestUrl,
            });
            logProviderRequestFailure({ error, route: '/xtream', url });
            res.json(normalizeProviderError(error));
        } finally {
            releaseProviderRequest(hostGuard, guardToken);
        }
    });

    app.get('/stalker', corsMiddleware, async (req, res) => {
        const url = getRegisteredProviderUrl(req, res, providerTargets);
        const macAddress = getQueryString(req, 'macAddress');
        const token = getQueryString(req, 'token');
        const serialNumber = getQueryString(req, 'serialNumber');
        if (!url) {
            return;
        }

        // Endpoint-discovery probes expect most candidates to fail; counting
        // them would let discovery declare a slow-but-alive portal unreachable.
        const countsTowardsGuard =
            getQueryString(req, 'skipConnectionGuard') !== 'true';
        let guardToken: HostRequestToken | null = null;
        let requestUrl: string | undefined;
        try {
            // `macAddress`, `token` and `serialNumber` are portal credentials,
            // not protocol content: they reach the portal only as the same
            // Cookie / Authorization / SN headers the Electron transport
            // sends, never in the portal's query string (which lands in
            // portal and intermediary access logs). The one protocol
            // exception is `handshake`, which presents its candidate token as
            // a query param and is answered without authentication.
            const params: Record<string, string | number> = getProxyParams(
                req,
                [
                    'targetId',
                    'macAddress',
                    'token',
                    'serialNumber',
                    // Guard control flag, not protocol content — it must never
                    // reach the portal's query string.
                    'skipConnectionGuard',
                ]
            );
            if (params['action'] === 'handshake' && token) {
                params['token'] = token;
            }

            // Shared with the Electron transport: full STB cookie, MAG
            // User-Agent pair, `sn` only on get_profile, `JsHttpRequest`
            // defaulting, and the reference `cmd` encoding (raw slashes,
            // pre-encoded sequences untouched, `&`/`#` still escaped).
            const identity = buildStalkerIdentityRequestContext({
                macAddress: macAddress ?? '',
                params,
                ...(token ? { token } : {}),
                ...(serialNumber ? { serialNumber } : {}),
            });
            const headers = { ...identity.headers };
            if (!macAddress) {
                // Tolerate credential-less calls the way the route always
                // has: no MAC means no session cookie, not an empty `mac=`.
                delete headers['Cookie'];
            }

            requestUrl = buildStalkerRequestUrl(
                url.href,
                identity.requestParams
            );

            if (countsTowardsGuard) {
                const admission = admitProviderRequest(hostGuard, requestUrl);
                if (!admission.allowed) {
                    // This route answers provider failures with HTTP 200 and
                    // an error body; a fast-fail is one of them.
                    res.json(admission.error);
                    return;
                }
                guardToken = admission.token;
            } else {
                // Endpoint discovery: never policed, never counted, but a
                // candidate that answers still clears the record.
                guardToken = observeProviderRequest(hostGuard, requestUrl);
            }

            const response = await httpClient.get(requestUrl, {
                headers,
                // `create_link` gets the longer budget: the portal mints a
                // stream URL before it answers.
                timeout:
                    params['action'] === 'create_link'
                        ? PROVIDER_REQUEST_TIMEOUT_MS.stalkerCreateLink
                        : PROVIDER_REQUEST_TIMEOUT_MS.stalker,
            });
            reportProviderRequestSuccess(hostGuard, guardToken);
            guardToken = null;

            res.json({
                action: getQueryString(req, 'action'),
                payload: response.data,
            });
        } catch (error) {
            // Always reported, even for exempt discovery probes: a failure
            // carrying an HTTP response proves the endpoint answered, and
            // dropping that is what lets the breaker open mid-discovery.
            reportProviderRequestFailure(hostGuard, guardToken, error, {
                countFailures: countsTowardsGuard,
                requestUrl,
            });
            logProviderRequestFailure({ error, route: '/stalker', url });
            res.json(normalizeProviderError(error));
        } finally {
            releaseProviderRequest(hostGuard, guardToken);
        }
    });

    return app;
}

function getRegisteredProviderUrl(
    req: Request,
    res: Response,
    providerTargets: ProviderTargetRegistry
): URL | null {
    const targetId = getQueryString(req, 'targetId');
    if (!targetId) {
        res.status(400).json({ message: 'Missing targetId', status: 400 });
        return null;
    }

    const targetUrl = providerTargets.get(targetId);
    if (!targetUrl) {
        res.status(404).json({
            message: 'Provider target not found',
            status: 404,
        });
        return null;
    }

    return targetUrl;
}

function createProviderTargetId(url: URL): string {
    return createHash('sha256').update(url.href).digest('hex');
}

function isPrivateNetworkProxyAllowed(): boolean {
    const value = process.env['IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS'];
    return value === '1' || value === 'true';
}

function getClientOrigins(): string[] {
    const configured = process.env['CLIENT_URL']
        ?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (configured?.length) {
        return configured;
    }

    // Production default matches the documented self-hosted setup
    // (docker/docker-compose.yml maps the PWA to port 4333). The Docker image
    // sets CLIENT_URL explicitly; this fallback only covers manual runs.
    return process.env['NODE_ENV'] === 'development' ||
        process.env['NODE_ENV'] === 'dev'
        ? ['http://localhost:4200']
        : ['http://localhost:4333'];
}

function getQueryString(req: Request, key: string): string | undefined {
    const value = req.query[key];
    if (Array.isArray(value)) {
        return normalizeQueryValue(value[0]);
    }
    return normalizeQueryValue(value);
}

function normalizeQueryValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function getProxyParams(
    req: Request,
    excludedKeys: string[]
): Record<string, string> {
    const excluded = new Set(excludedKeys);
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
        if (excluded.has(key)) {
            continue;
        }
        const normalized = Array.isArray(value)
            ? normalizeQueryValue(value[0])
            : normalizeQueryValue(value);
        if (normalized) {
            params[key] = normalized;
        }
    }
    return params;
}

function appendPathSegment(url: URL, segment: string): string {
    const nextUrl = new URL(url.href);
    nextUrl.pathname = `${nextUrl.pathname.replace(/\/+$/, '')}/${segment}`;
    nextUrl.search = '';
    nextUrl.hash = '';
    return nextUrl.href;
}

async function handlePlaylistParse(options: {
    readonly guid: () => string;
    readonly httpClient: WebBackendHttpClient;
    readonly now: () => Date;
    readonly url: string;
    readonly userAgent?: string;
}): Promise<Record<string, unknown> | PlaylistParseError> {
    try {
        const response = await options.httpClient.get<string>(options.url, {
            timeout: PROVIDER_REQUEST_TIMEOUT_MS.playlist,
            ...(options.userAgent
                ? { headers: { 'User-Agent': options.userAgent } }
                : {}),
        });
        const parsedPlaylist = parsePlaylist(response.data);
        const title = getLastUrlSegment(options.url);
        return {
            ...createPlaylistObject({
                guid: options.guid,
                now: options.now,
                playlist: parsedPlaylist,
                title,
                url: options.url,
            }),
            ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        };
    } catch (error) {
        logProviderRequestFailure({ error, route: '/parse', url: options.url });
        if (error instanceof ProviderRequestError && error.policyError) {
            return providerUrlErrorBody(error.policyError);
        }
        const providerError = (
            error instanceof ProviderRequestError ? error.cause : error
        ) as ProviderError;
        if (providerError?.response?.statusText !== undefined) {
            return {
                status: providerError.response.status ?? 500,
                message: providerError.response.statusText,
            };
        }
        const code = collectProviderErrorCodes(providerError)[0];
        return {
            status: providerError?.response?.status ?? 500,
            message: code
                ? `Error, something went wrong (${code})`
                : 'Error, something went wrong',
            ...(code ? { code } : {}),
        };
    }
}

async function fetchEpgDataFromUrl(
    httpClient: WebBackendHttpClient,
    url: URL
): Promise<unknown> {
    const href = url.href;
    const response = await httpClient.get<ArrayBuffer | string>(href, {
        timeout: PROVIDER_REQUEST_TIMEOUT_MS.epg,
        ...(url.pathname.endsWith('.gz')
            ? { responseType: 'arraybuffer' }
            : {}),
    });
    const xml = url.pathname.endsWith('.gz')
        ? zlib.gunzipSync(Buffer.from(response.data as ArrayBuffer)).toString()
        : response.data.toString();
    return epgParser.parse(xml);
}

function isPlaylistParseError(
    result: Record<string, unknown> | PlaylistParseError
): result is PlaylistParseError {
    return (
        typeof (result as PlaylistParseError).status === 'number' &&
        typeof (result as PlaylistParseError).message === 'string'
    );
}

function parsePlaylist(playlist: string): {
    items: Array<Record<string, unknown>>;
} {
    return parser.parse(playlist) as unknown as {
        items: Array<Record<string, unknown>>;
    };
}

function createPlaylistObject(options: {
    readonly guid: () => string;
    readonly now: () => Date;
    readonly playlist: { items: Array<Record<string, unknown>> };
    readonly title: string;
    readonly url: string;
}): Record<string, unknown> {
    const timestamp = options.now().toISOString();
    const id = options.guid();
    return {
        id,
        _id: id,
        filename: options.title,
        title: options.title,
        count: options.playlist.items.length,
        playlist: {
            ...options.playlist,
            items: options.playlist.items.map((item) => {
                // Keep this builder aligned with the shared
                // createPlaylistObject() in @iptvnator/shared/m3u-utils:
                // KODIPROP ClearKey DRM must survive the /parse URL-import
                // path too.
                const drm = extractDrmFromRaw(
                    typeof item['raw'] === 'string' ? item['raw'] : undefined
                );
                return {
                    id: options.guid(),
                    ...item,
                    ...(drm ? { drm } : {}),
                };
            }),
        },
        importDate: timestamp,
        lastUsage: timestamp,
        favorites: [],
        autoRefresh: false,
        url: options.url,
    };
}

function getLastUrlSegment(value: string): string {
    const segment = value.slice(value.lastIndexOf('/') + 1).trim();
    return segment.length > 0 ? segment : 'Playlist without title';
}

function createGuid(): string {
    return Math.random().toString(36).slice(2);
}
