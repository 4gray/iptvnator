/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { createHash } from 'crypto';
import { ipcMain } from 'electron';
import { PortalDebugEvent, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import { rememberStalkerPlaybackContext } from '../services/stalker-playback-context.service';
import { emitPortalDebugEvent } from './portal-debug.events';

const LEGACY_DEFAULT_SERIAL = 'BEDACD4569BAF';

function deriveStalkerIdentity(
    macAddress: string,
    providedSerial?: string
): { serialNumber: string; cfduid: string } {
    const normalizedMac = String(macAddress ?? '').trim().toUpperCase();
    const md5 = createHash('md5').update(normalizedMac).digest('hex');
    const derivedSerial = md5.slice(0, 13).toUpperCase();

    const normalizedProvided = String(providedSerial ?? '')
        .trim()
        .toUpperCase();
    const useProvidedSerial =
        normalizedProvided.length > 0 &&
        normalizedProvided !== LEGACY_DEFAULT_SERIAL;

    const serialNumber = useProvidedSerial ? normalizedProvided : derivedSerial;

    // Keep serial and __cfduid coherent: serial as prefix + stable MAC hash tail.
    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');
    const cfduid = `${serialPrefix}${md5.slice(serialPrefix.length)}`.slice(
        0,
        32
    );

    return { serialNumber, cfduid };
}

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
            params: Record<string, string>;
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
            const identity = deriveStalkerIdentity(macAddress, serialNumber);
            const effectiveSerialNumber = identity.serialNumber;
            const requestParams = { ...params };

            // Some providers validate sn/metrics strongly in get_profile.
            if (
                requestParams.type === 'stb' &&
                requestParams.action === 'get_profile'
            ) {
                requestParams.sn = effectiveSerialNumber;

                if (typeof requestParams.metrics === 'string') {
                    try {
                        const parsedMetrics = JSON.parse(requestParams.metrics);
                        requestParams.metrics = JSON.stringify({
                            ...(parsedMetrics ?? {}),
                            sn: effectiveSerialNumber,
                        });
                    } catch {
                        // Keep original metrics payload when malformed.
                    }
                }
            }

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

            // Build cookie string matching the working curl example format
            // Format: mac=XX:XX:XX:XX:XX:XX; stb_lang=de_DE; timezone=Europe/Berlin; __cfduid=...
            // The __cfduid cookie uses the serial number lowercase + random suffix
            const cookieString = `mac=${macAddress}; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin; __cfduid=${identity.cfduid}`;

            // Build headers - using MAG250 User-Agent that stalker-to-m3u uses
            const headers: Record<string, string> = {
                Cookie: cookieString,
                // Use MAG250 User-Agent matching stalker-to-m3u implementation
                'User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
                'X-User-Agent':
                    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250',
                Accept: '*/*',
                Connection: 'keep-alive',
                'Accept-Language': 'en-US,en;q=0.9',
            };

            // Add SN (serial number) header if provided - required by some portals
            if (effectiveSerialNumber) {
                headers['SN'] = effectiveSerialNumber;
            }

            // Add Authorization header if token is provided
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

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
                    operation: params.action ?? 'unknown',
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
                    operation: payload.params?.action ?? 'unknown',
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
