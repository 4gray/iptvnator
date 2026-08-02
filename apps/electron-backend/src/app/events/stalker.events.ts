/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import {
    PortalDebugEvent,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { rememberStalkerPlaybackContext } from '../services/stalker-playback-context.service';
import { emitPortalDebugEvent } from './portal-debug.events';
import { buildStalkerIdentityRequestContext } from './stalker-identity';
import { buildStalkerRequestUrl } from './stalker-request-url';
import { assertRemoteUrlAllowed } from './url-safety';
import { requestWithValidatedRedirects } from '../util/validated-axios';

export default class StalkerEvents {
    static bootstrapStalkerEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

type StalkerResponseData = {
    js?: {
        cmd?: unknown;
    };
    [key: string]: unknown;
};

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

            // SSRF/LFI guard: block non-http(s)/credentialed portal URLs.
            // Private/LAN targets remain allowed (users run local Stalker servers).
            await assertRemoteUrlAllowed(url, { allowPrivateNetworks: true });

            const fullUrl = buildStalkerRequestUrl(url, requestParams);

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

            const response =
                await requestWithValidatedRedirects<StalkerResponseData>(
                    fullUrl,
                    config,
                    { allowPrivateNetworks: true }
                );

            // Check if response is successful
            if (response.status >= 400) {
                console.error(
                    '[StalkerEvents] HTTP Error:',
                    response.status,
                    response.statusText
                );
                // The numeric code must live in the MESSAGE: ipcRenderer
                // strips custom properties from rejected values, and the
                // renderer's endpoint discovery needs to tell a 404 (probe
                // next candidate) from a network failure (stop probing).
                const httpError = new Error(
                    `HTTP Error ${response.status}: ${response.statusText}`
                ) as Error & { status: number };
                httpError.status = response.status;
                throw httpError;
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

            console.error(
                '[StalkerEvents] Request error:',
                redactSensitiveData(error)
            );

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
