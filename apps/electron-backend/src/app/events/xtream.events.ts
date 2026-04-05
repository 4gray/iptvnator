/**
 * This module handles all Xtream Codes API related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import { PortalDebugEvent, XTREAM_CANCEL_SESSION } from 'shared-interfaces';
import { emitPortalDebugEvent } from './portal-debug.events';

export default class XtreamEvents {
    static bootstrapXtreamEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function formatXtreamError(error: unknown, requestUrl: string, action?: string) {
    const parsedUrl = new URL(requestUrl);
    const base = {
        action,
        host: parsedUrl.host,
        pathname: parsedUrl.pathname,
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
            suppressErrorLog?: boolean;
        }
    ) => {
        const startedAt = Date.now();
        let activeRequestKey: string | null = null;
        try {
            const { url, params, requestId, sessionId } = payload;

            // Build URL with query parameters
            // Xtream API endpoint is always at /player_api.php
            const apiUrl = new URL(`${url}/player_api.php`);
            Object.entries(params).forEach(([key, value]) => {
                apiUrl.searchParams.append(key, value);
            });

            const controller = new AbortController();
            if (requestId || sessionId) {
                activeRequestKey = requestId ?? crypto.randomUUID();
                activeXtreamRequests.set(activeRequestKey, {
                    controller,
                    sessionId,
                });
            }

            // Configure axios request
            const config: AxiosRequestConfig = {
                method: 'GET',
                url: apiUrl.toString(),
                headers: {
                    'User-Agent':
                        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    Accept: 'application/json',
                },
                timeout: 30000, // 30 seconds timeout for Xtream API
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
                signal: controller.signal,
            };

            const response = await axios(config);

            // Check if response is successful
            if (response.status >= 400) {
                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

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
                    },
                    response: response.data,
                };
                emitPortalDebugEvent(debugEvent);
            }

            // Xtream API returns JSON data
            return {
                payload: response.data,
                action: params.action,
            };
        } catch (error) {
            const requestId = payload.requestId;
            if (requestId) {
                const apiUrl = new URL(`${payload.url}/player_api.php`);
                Object.entries(payload.params ?? {}).forEach(([key, value]) => {
                    apiUrl.searchParams.append(key, value);
                });

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
                        url: apiUrl.toString(),
                        headers: {
                            'User-Agent':
                                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            Accept: 'application/json',
                        },
                        timeout: 30000,
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
        }
    ) => {
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
