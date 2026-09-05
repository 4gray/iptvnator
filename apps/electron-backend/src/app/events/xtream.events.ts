/**
 * This module handles all Xtream Codes API related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import {
    PortalDebugEvent,
    XTREAM_CANCEL_SESSION,
    XTREAM_CLIENT_USER_AGENT,
    XTREAM_MAIN_PERFORMANCE_PHASE,
    normalizeXtreamServerUrl,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { emitPortalDebugEvent } from './portal-debug.events';
import { formatPortalRequestError } from './portal-request-error.util';
import { requestWithValidatedRedirects } from '../util/validated-axios';
import {
    HostConnectivityGuardError,
    HostRequestToken,
    beginGuardedHostRequest,
    reportGuardedHostFailure,
    reportGuardedHostSuccess,
    releaseGuardedHostRequest,
} from '../util/host-connectivity-guard';
import {
    createXtreamMainPerformanceCaptureForRequest,
    createXtreamMeasuredTransformResponse,
} from './xtream-performance';
import { cancelXtreamSessionRequests } from './xtream-session-cancellation';

export default class XtreamEvents {
    static bootstrapXtreamEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

function buildXtreamApiUrl(url: string, params: Record<string, string>): URL {
    const baseUrl = normalizeXtreamServerUrl(url);
    const apiUrl = new URL(`${baseUrl}/player_api.php`);
    Object.entries(params).forEach(([key, value]) => {
        apiUrl.searchParams.append(
            key,
            key === 'username' || key === 'password' ? value.trim() : value
        );
    });

    return apiUrl;
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
        const performanceCapture = createXtreamMainPerformanceCaptureForRequest(
            payload.requestId
        );
        let activeRequestKey: string | null = null;
        let requestUrlForLog = payload.url;
        let guardToken: HostRequestToken | null = null;
        try {
            const { url, params, requestId, sessionId } = payload;

            // Build URL with query parameters
            // Xtream API endpoint is always at /player_api.php
            const apiUrl = buildXtreamApiUrl(url, params);
            requestUrlForLog = apiUrl.toString();

            // Browsing a dead portal would otherwise queue dozens of 30-second
            // timeouts in a row. Throws once the host has stopped answering.
            guardToken = beginGuardedHostRequest(requestUrlForLog);

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
                    'User-Agent': XTREAM_CLIENT_USER_AGENT,
                    Accept: 'application/json',
                },
                timeout: 30000, // 30 seconds timeout for Xtream API
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
                signal: controller.signal,
            };
            if (performanceCapture) {
                config.transformResponse =
                    createXtreamMeasuredTransformResponse(
                        performanceCapture,
                        axios.defaults.transformResponse
                    );
            }

            const response = performanceCapture
                ? await performanceCapture.measureAsync(
                      XTREAM_MAIN_PERFORMANCE_PHASE.NETWORK_TOTAL,
                      () =>
                          requestWithValidatedRedirects<unknown>(
                              apiUrl.toString(),
                              config,
                              { allowPrivateNetworks: true }
                          )
                  )
                : await requestWithValidatedRedirects<unknown>(
                      apiUrl.toString(),
                      config,
                      { allowPrivateNetworks: true }
                  );

            // The host answered — whatever the status says, it is reachable.
            reportGuardedHostSuccess(guardToken);
            guardToken = null;

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
            const result = {
                payload: response.data,
                action: params.action,
            };
            return performanceCapture
                ? performanceCapture.measure(
                      XTREAM_MAIN_PERFORMANCE_PHASE.RESPONSE_READY,
                      () => result
                  )
                : result;
        } catch (error) {
            const requestId = payload.requestId;
            if (requestId) {
                const apiUrl = (() => {
                    try {
                        return buildXtreamApiUrl(
                            payload.url,
                            payload.params ?? {}
                        ).toString();
                    } catch {
                        return requestUrlForLog;
                    }
                })();

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
                        url: apiUrl,
                        headers: {
                            'User-Agent': XTREAM_CLIENT_USER_AGENT,
                            Accept: 'application/json',
                        },
                        timeout: 30000,
                        params: payload.params,
                    },
                    error,
                };
                emitPortalDebugEvent(debugEvent);
            }

            if (error instanceof HostConnectivityGuardError) {
                // The failures that tripped the guard were logged when they
                // happened; a line per skipped request would be the very log
                // spam the guard exists to stop.
                throw error;
            }

            reportGuardedHostFailure(guardToken, error, {
                requestUrl: requestUrlForLog,
            });

            if (!payload.suppressErrorLog) {
                console.error(
                    '[XTREAM_REQUEST] Failed',
                    redactSensitiveData(
                        formatPortalRequestError(
                            error,
                            requestUrlForLog,
                            payload.params?.action
                        )
                    )
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
            releaseGuardedHostRequest(guardToken);
            if (activeRequestKey) {
                activeXtreamRequests.delete(activeRequestKey);
            }
        }
    }
);

ipcMain.handle(
    XTREAM_CANCEL_SESSION,
    async (
        _event,
        sessionId: string
    ): Promise<{ success: boolean; cancelled: number }> => {
        const capture = createXtreamMainPerformanceCaptureForRequest();
        return capture
            ? capture.measure(
                  XTREAM_MAIN_PERFORMANCE_PHASE.CANCEL_SESSION,
                  () =>
                      cancelXtreamSessionRequests(
                          activeXtreamRequests.values(),
                          sessionId
                      )
              )
            : cancelXtreamSessionRequests(
                  activeXtreamRequests.values(),
                  sessionId
              );
    }
);
type ActiveXtreamRequest = {
    controller: AbortController;
    sessionId?: string;
};

const activeXtreamRequests = new Map<string, ActiveXtreamRequest>();
