/**
 * This module handles all Xtream Codes API related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { ipcMain } from 'electron';
import {
    decodeTextBytes,
    normalizeTextValuesDeep,
    PortalDebugEvent,
    SourceVpnRequestContext,
    XTREAM_CANCEL_SESSION,
} from 'shared-interfaces';
import {
    ensureSourceNetworkReady,
    getSourceAxiosAgents,
} from '../services/source-network-options';
import { emitPortalDebugEvent } from './portal-debug.events';

const XTREAM_REQUEST_MAX_ATTEMPTS = 3;
const XTREAM_REQUEST_RETRY_DELAYS_MS = [500, 1500];
const XTREAM_REQUEST_TIMEOUT_MS = 30000;

export default class XtreamEvents {
    static bootstrapXtreamEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function getHeaderValue(
    headers: unknown,
    name: string
): string | undefined {
    if (!headers || typeof headers !== 'object') {
        return undefined;
    }

    const lowerName = name.toLowerCase();
    const record = headers as Record<string, unknown>;
    const key = Object.keys(record).find(
        (entry) => entry.toLowerCase() === lowerName
    );
    const value = key ? record[key] : undefined;

    return typeof value === 'string' ? value : undefined;
}

function normalizeJsonResponseData(data: unknown, contentType?: string): unknown {
    const normalizeTextPayload = (text: string): unknown => {
        const normalizedText = text.trim();
        if (!normalizedText) {
            return null;
        }

        try {
            return normalizeTextValuesDeep(JSON.parse(normalizedText));
        } catch {
            return normalizeTextValuesDeep(normalizedText);
        }
    };

    if (
        data instanceof ArrayBuffer ||
        ArrayBuffer.isView(data as ArrayBufferView)
    ) {
        const text = decodeTextBytes(
            data as ArrayBuffer | ArrayBufferView,
            contentType
        );
        return normalizeTextPayload(text);
    }

    if (typeof data === 'string') {
        return normalizeTextPayload(data);
    }

    return normalizeTextValuesDeep(data);
}

function normalizeXtreamBaseUrl(rawUrl: string): URL {
    const trimmed = String(rawUrl ?? '').trim();
    if (!trimmed) {
        throw new Error('Xtream server URL is empty');
    }

    const withProtocol = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `http://${trimmed}`;
    const parsed = new URL(withProtocol);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    parsed.pathname = /\/player_api\.php$/i.test(normalizedPath)
        ? normalizedPath.replace(/\/+player_api\.php$/i, '/player_api.php')
        : `${normalizedPath}/player_api.php`;
    parsed.search = '';
    parsed.hash = '';

    return parsed;
}

function buildXtreamApiUrl(
    rawUrl: string,
    params?: Record<string, string>
): URL {
    const apiUrl = normalizeXtreamBaseUrl(rawUrl);
    Object.entries(params ?? {}).forEach(([key, value]) => {
        apiUrl.searchParams.append(key, value);
    });
    return apiUrl;
}

function buildXtreamRequestConfig(
    apiUrl: URL,
    signal: AbortSignal
): AxiosRequestConfig {
    return {
        method: 'GET',
        url: apiUrl.toString(),
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Accept: 'application/json',
        },
        timeout: XTREAM_REQUEST_TIMEOUT_MS,
        validateStatus: (status) => status < 500,
        signal,
        responseType: 'arraybuffer',
        ...getSourceAxiosAgents(),
    };
}

function getErrorStatus(error: unknown): number | undefined {
    if (axios.isAxiosError(error)) {
        return error.response?.status;
    }

    if (error && typeof error === 'object') {
        const status = (error as { status?: unknown }).status;
        return typeof status === 'number' ? status : undefined;
    }

    return undefined;
}

function getErrorCode(error: unknown): string | undefined {
    if (axios.isAxiosError(error)) {
        return error.code;
    }

    if (error && typeof error === 'object') {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : undefined;
    }

    return undefined;
}

function isRetryableXtreamError(error: unknown): boolean {
    const code = getErrorCode(error);
    if (code === 'ERR_CANCELED') {
        return false;
    }

    const status = getErrorStatus(error);
    if (status) {
        return (
            status === 408 ||
            status === 425 ||
            status === 429 ||
            status === 599 ||
            status >= 500
        );
    }

    if (axios.isAxiosError(error)) {
        return true;
    }

    return false;
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestXtreamWithRetries(
    apiUrl: URL,
    sourceVpn: SourceVpnRequestContext | undefined,
    controller: AbortController
): Promise<{
    attempts: number;
    config: AxiosRequestConfig;
    response: AxiosResponse;
}> {
    let lastConfig = buildXtreamRequestConfig(apiUrl, controller.signal);

    for (let attempt = 1; attempt <= XTREAM_REQUEST_MAX_ATTEMPTS; attempt += 1) {
        try {
            await ensureSourceNetworkReady(sourceVpn);
            lastConfig = buildXtreamRequestConfig(apiUrl, controller.signal);
            const response = await axios(lastConfig);

            if (response.status >= 400) {
                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

            return {
                attempts: attempt,
                config: lastConfig,
                response,
            };
        } catch (error) {
            if (
                attempt >= XTREAM_REQUEST_MAX_ATTEMPTS ||
                !isRetryableXtreamError(error)
            ) {
                throw error;
            }

            await delay(XTREAM_REQUEST_RETRY_DELAYS_MS[attempt - 1] ?? 1000);
        }
    }

    throw new Error('Xtream request failed');
}

function formatXtreamError(error: unknown, requestUrl: string, action?: string) {
    let parsedUrl: URL | null = null;
    try {
        parsedUrl = buildXtreamApiUrl(requestUrl);
    } catch {
        parsedUrl = null;
    }
    const base = {
        action,
        host: parsedUrl?.host ?? 'invalid-url',
        pathname: parsedUrl?.pathname ?? '',
    };

    if (axios.isAxiosError(error)) {
        return {
            ...base,
            type: 'AxiosError',
            code: error.code,
            status: error.response?.status,
            message: error.message,
            syscall: (error as NodeJS.ErrnoException).syscall,
            hostname: (error as any).hostname,
        };
    }

    if (error && typeof error === 'object') {
        const errObj = error as Record<string, unknown>;
        return {
            ...base,
            type: 'ErrorObject',
            status: errObj.status,
            message: errObj.message,
        };
    }

    return {
        ...base,
        type: 'UnknownError',
        message: String(error),
    };
}

/**
 * Handle Xtream Codes API requests
 */
ipcMain.handle(
    'XTREAM_REQUEST',
    async (
        event,
        payload: {
            url: string;
            params: Record<string, string>;
            requestId?: string;
            sessionId?: string;
            sourceVpn?: SourceVpnRequestContext;
            suppressErrorLog?: boolean;
        }
    ) => {
        const startedAt = Date.now();
        let activeRequestKey: string | null = null;
        try {
            const { url, params, requestId, sessionId } = payload;

            const apiUrl = buildXtreamApiUrl(url, params);

            const controller = new AbortController();
            if (requestId || sessionId) {
                activeRequestKey = requestId ?? crypto.randomUUID();
                activeXtreamRequests.set(activeRequestKey, {
                    controller,
                    sessionId,
                });
            }

            const { attempts, config, response } =
                await requestXtreamWithRetries(
                    apiUrl,
                    payload.sourceVpn,
                    controller
                );

            const responseData = normalizeJsonResponseData(
                response.data,
                getHeaderValue(response.headers, 'content-type')
            );

            if (requestId) {
                const debugEvent: PortalDebugEvent = {
                    requestId,
                    provider: 'xtream',
                    operation: params.action ?? 'unknown',
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'success',
                    request: {
                        method: config.method ?? 'GET',
                        url: apiUrl.toString(),
                        headers: config.headers,
                        timeout: config.timeout,
                        params,
                        attempts,
                    },
                    response: responseData,
                };
                emitPortalDebugEvent(debugEvent);
            }

            // Xtream API returns JSON data
            return {
                payload: responseData,
                action: params.action,
            };
        } catch (error) {
            const requestId = payload.requestId;
            if (requestId) {
                let apiUrl: URL | null = null;
                try {
                    apiUrl = buildXtreamApiUrl(payload.url, payload.params);
                } catch {
                    apiUrl = null;
                }

                const debugEvent: PortalDebugEvent = {
                    requestId,
                    provider: 'xtream',
                    operation: payload.params?.action ?? 'unknown',
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'error',
                    request: {
                        method: 'GET',
                        url: apiUrl?.toString() ?? payload.url,
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            Accept: 'application/json',
                        },
                        timeout: XTREAM_REQUEST_TIMEOUT_MS,
                        params: payload.params,
                    },
                    error,
                };
                emitPortalDebugEvent(debugEvent);
            }

            if (!payload.suppressErrorLog) {
                console.error(
                    '[XTREAM_REQUEST] Failed',
                    formatXtreamError(error, payload.url, payload.params?.action)
                );
            }

            // Format error response
            if (axios.isAxiosError(error)) {
                if (error.code === 'ERR_CANCELED') {
                    throw {
                        type: 'ERROR',
                        name: 'AbortError',
                        message: 'Xtream request cancelled',
                        status: 499,
                    };
                }
                const errorResponse = {
                    type: 'ERROR',
                    message:
                        error.response?.data?.message ||
                        error.message ||
                        'Failed to fetch data from Xtream server',
                    status: error.response?.status || 500,
                };
                throw errorResponse;
            } else if (
                error &&
                typeof error === 'object' &&
                'message' in error
            ) {
                throw error;
            } else {
                throw {
                    type: 'ERROR',
                    message: 'An unknown error occurred',
                    status: 500,
                };
            }
        } finally {
            if (activeRequestKey) {
                activeXtreamRequests.delete(activeRequestKey);
            }
        }
    }
);

ipcMain.handle(
    XTREAM_CANCEL_SESSION,
    async (_event, sessionId: string): Promise<{ success: boolean; cancelled: number }> => {
        if (!sessionId) {
            return { success: false, cancelled: 0 };
        }

        let cancelled = 0;
        for (const activeRequest of activeXtreamRequests.values()) {
            if (activeRequest.sessionId !== sessionId) {
                continue;
            }

            activeRequest.controller.abort();
            cancelled += 1;
        }

        return {
            success: cancelled > 0,
            cancelled,
        };
    }
);
type ActiveXtreamRequest = {
    controller: AbortController;
    sessionId?: string;
};

const activeXtreamRequests = new Map<string, ActiveXtreamRequest>();

ipcMain.handle(
    'XTREAM_PROBE_URL',
    async (
        _event,
        payload: {
            url: string;
            method?: 'GET' | 'HEAD';
            sourceVpn?: SourceVpnRequestContext;
        }
    ) => {
        await ensureSourceNetworkReady(payload.sourceVpn);
        const config: AxiosRequestConfig = {
            method: payload.method ?? 'HEAD',
            url: payload.url,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true,
            ...getSourceAxiosAgents(),
        };

        try {
            const response = await axios(config);
            return {
                status: response.status,
                url: payload.url,
            };
        } catch (error) {
            if (axios.isAxiosError(error) && error.response) {
                return {
                    status: error.response.status,
                    url: payload.url,
                };
            }

            return {
                status: 0,
                url: payload.url,
            };
        }
    }
);
