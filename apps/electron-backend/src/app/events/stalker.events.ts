/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import { PortalDebugEvent, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { rememberStalkerPlaybackContext } from '../services/stalker-playback-context.service';
import { emitPortalDebugEvent } from './portal-debug.events';
import { buildStalkerIdentityRequestContext } from './stalker-identity';

export default class StalkerEvents {
    static bootstrapStalkerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

/**
 * Handle Stalker API requests with MAC address cookie and optional Bearer token
 */
ipcMain.handle(
    STALKER_REQUEST,
    async (
        event,
        payload: {
            url: string;
            macAddress: string;
            params: Record<string, string | number>;
            token?: string;
            serialNumber?: string;
            requestId?: string;
        }
    ) => {
        const startedAt = Date.now();
        let debugRequest: Record<string, unknown> | undefined;
        try {
            const { url, macAddress, params, token, serialNumber, requestId } =
                payload;
            const { requestParams, headers, effectiveSerialNumber } =
                buildStalkerIdentityRequestContext({
                    macAddress,
                    params,
                    token,
                    serialNumber,
                });

            // Build URL with query parameters
            // Note: For 'cmd' parameter, we need to use encodeURI (not encodeURIComponent)
            // to preserve forward slashes, matching stalker-to-m3u implementation
            const urlObject = new URL(url);
            const queryParts: string[] = [];

            Object.entries(requestParams).forEach(([key, value]) => {
                if (key === 'cmd') {
                    // Don't encode cmd - it's already a path like /media/12345.mpg
                    // Encoding would break the path format expected by the server
                    queryParts.push(`${key}=${String(value)}`);
                } else {
                    // Use encodeURIComponent for other params
                    queryParts.push(
                        `${key}=${encodeURIComponent(String(value))}`
                    );
                }
            });

            // Always add JsHttpRequest parameter if not present (required by Stalker API)
            if (!requestParams['JsHttpRequest']) {
                queryParts.push('JsHttpRequest=1-xml');
            }

            // Build final URL with manually constructed query string
            const fullUrl = `${urlObject.origin}${urlObject.pathname}?${queryParts.join('&')}`;

            // Determine timeout based on action type
            // create_link requests can take longer as server generates stream URL
            const isCreateLink = requestParams.action === 'create_link';
            const requestTimeout = isCreateLink ? 30000 : 15000;

            // Configure axios request
            const config: AxiosRequestConfig = {
                method: 'GET',
                url: fullUrl,
                headers,
                timeout: requestTimeout,
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
            };
            debugRequest = {
                method: config.method ?? 'GET',
                url: fullUrl,
                headers,
                timeout: requestTimeout,
                params: requestParams,
            };

            const response = await axios(config);

            // Check if response is successful
            if (response.status >= 400) {
                console.error(
                    '[StalkerEvents] HTTP Error:',
                    response.status,
                    response.statusText
                );
                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

            // Return the response data
            if (
                params.action === 'create_link' &&
                response.data?.js?.cmd &&
                typeof response.data.js.cmd === 'string'
            ) {
                rememberStalkerPlaybackContext({
                    streamUrl: response.data.js.cmd,
                    portalUrl: url,
                    macAddress,
                    serialNumber: effectiveSerialNumber,
                    token,
                });
            }

            if (requestId) {
                const debugEvent: PortalDebugEvent = {
                    requestId,
                    provider: 'stalker',
                    operation: String(params.action ?? 'unknown'),
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'success',
                    request: debugRequest,
                    response: response.data,
                };
                emitPortalDebugEvent(debugEvent);
            }

            return response.data;
        } catch (error) {
            if (payload.requestId) {
                const debugEvent: PortalDebugEvent = {
                    requestId: payload.requestId,
                    provider: 'stalker',
                    operation: String(payload.params?.action ?? 'unknown'),
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'error',
                    request: debugRequest ?? {
                        method: 'GET',
                        url: payload.url,
                        params: payload.params,
                    },
                    error,
                };
                emitPortalDebugEvent(debugEvent);
            }

            console.error('[StalkerEvents] Request error:', error);

            // Format error response
            if (axios.isAxiosError(error)) {
                const errorResponse = {
                    type: 'ERROR',
                    message:
                        error.response?.data?.message ||
                        error.message ||
                        'Failed to fetch data from Stalker portal',
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
        }
    }
);
