import cors from 'cors';
import express, { Express, Request } from 'express';
import https from 'node:https';
import zlib from 'node:zlib';
import axios from 'axios';
import epgParser from 'epg-parser';
import parser from 'iptv-playlist-parser';

export interface WebBackendHttpGetOptions {
    readonly headers?: Record<string, string>;
    readonly httpsAgent?: unknown;
    readonly params?: Record<string, string>;
    readonly responseType?: 'arraybuffer';
}

export interface WebBackendHttpClient {
    get<T>(
        url: string,
        options?: WebBackendHttpGetOptions
    ): Promise<{ data: T }>;
}

interface ProviderError extends Error {
    readonly response?: {
        readonly status?: number;
        readonly statusText?: string;
    };
}

interface PlaylistParseError {
    readonly message: string;
    readonly status: number;
}

export interface WebBackendAppOptions {
    readonly clientOrigins?: string[];
    readonly guid?: () => string;
    readonly httpClient?: WebBackendHttpClient;
    readonly now?: () => Date;
    readonly runtimeBackendUrl?: string;
}

const defaultHttpsAgent = new https.Agent({
    rejectUnauthorized: false,
});

export function createWebBackendApp(
    options: WebBackendAppOptions = {}
): Express {
    const app = express();
    const httpClient = (options.httpClient ?? axios) as WebBackendHttpClient;
    const guid = options.guid ?? createGuid;
    const now = options.now ?? (() => new Date());
    const clientOrigins = options.clientOrigins ?? getClientOrigins();
    const runtimeBackendUrl =
        options.runtimeBackendUrl ?? process.env['BACKEND_URL'] ?? '/api';

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

    app.get('/parse', corsMiddleware, async (req, res) => {
        const url = getQueryString(req, 'url');
        if (!url) {
            res.status(400).send('Missing url');
            return;
        }

        const result = await handlePlaylistParse({
            guid,
            httpClient,
            now,
            url,
        });

        if (isPlaylistParseError(result)) {
            res.status(result.status).send(result.message);
            return;
        }

        res.json(result);
    });

    app.get('/parse-xml', corsMiddleware, async (req, res) => {
        const url = getQueryString(req, 'url');
        if (!url) {
            res.status(400).send('Missing url');
            return;
        }

        const result = await fetchEpgDataFromUrl(httpClient, url);
        if (!result) {
            res.status(500).send('Error, something went wrong');
            return;
        }

        res.json(result);
    });

    app.get('/xtream', corsMiddleware, async (req, res) => {
        const url = getQueryString(req, 'url');
        if (!url) {
            res.status(400).json({ message: 'Missing url', status: 400 });
            return;
        }

        try {
            const response = await httpClient.get(
                `${trimTrailingSlash(url)}/player_api.php`,
                {
                    params: getProxyParams(req, ['url']),
                }
            );

            res.json({
                action: getQueryString(req, 'action'),
                payload: response.data,
            });
        } catch (error) {
            res.json(normalizeProviderError(error));
        }
    });

    app.get('/stalker', corsMiddleware, async (req, res) => {
        const url = getQueryString(req, 'url');
        const macAddress = getQueryString(req, 'macAddress');
        const token = getQueryString(req, 'token');
        if (!url) {
            res.status(400).json({ message: 'Missing url', status: 400 });
            return;
        }

        try {
            const response = await httpClient.get(url, {
                params: getProxyParams(req, ['url']),
                headers: {
                    ...(macAddress ? { Cookie: `mac=${macAddress}` } : {}),
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });

            res.json({
                action: getQueryString(req, 'action'),
                payload: response.data,
            });
        } catch (error) {
            res.json(normalizeProviderError(error));
        }
    });

    return app;
}

function getClientOrigins(): string[] {
    const configured = process.env['CLIENT_URL']
        ?.split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    if (configured?.length) {
        return configured;
    }

    return process.env['NODE_ENV'] === 'development' ||
        process.env['NODE_ENV'] === 'dev'
        ? ['http://localhost:4200']
        : ['https://iptvnator.vercel.app'];
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

function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, '');
}

async function handlePlaylistParse(options: {
    readonly guid: () => string;
    readonly httpClient: WebBackendHttpClient;
    readonly now: () => Date;
    readonly url: string;
}): Promise<Record<string, unknown> | PlaylistParseError> {
    try {
        const response = await options.httpClient.get<string>(options.url, {
            httpsAgent: defaultHttpsAgent,
        });
        const parsedPlaylist = parsePlaylist(response.data);
        const title = getLastUrlSegment(options.url);
        return createPlaylistObject({
            guid: options.guid,
            now: options.now,
            playlist: parsedPlaylist,
            title,
            url: options.url,
        });
    } catch (error) {
        const providerError = error as ProviderError;
        return {
            status: providerError.response?.status ?? 500,
            message:
                providerError.response?.statusText ??
                'Error, something went wrong',
        };
    }
}

async function fetchEpgDataFromUrl(
    httpClient: WebBackendHttpClient,
    url: string
): Promise<unknown> {
    const response = await httpClient.get<ArrayBuffer | string>(url.trim(), {
        ...(url.endsWith('.gz') ? { responseType: 'arraybuffer' } : {}),
    });
    const xml = url.endsWith('.gz')
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

function parsePlaylist(
    playlist: string
): { items: Array<Record<string, unknown>> } {
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
    return {
        id: options.guid(),
        _id: options.guid(),
        filename: options.title,
        title: options.title,
        count: options.playlist.items.length,
        playlist: {
            ...options.playlist,
            items: options.playlist.items.map((item) => ({
                id: options.guid(),
                ...item,
            })),
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

function normalizeProviderError(error: unknown): {
    readonly message: string;
    readonly status: number;
} {
    const providerError = error as ProviderError;
    return {
        message: providerError.response?.statusText ?? 'Error: not found',
        status: providerError.response?.status ?? 404,
    };
}

function createGuid(): string {
    return Math.random().toString(36).slice(2);
}
