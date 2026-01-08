/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import { STALKER_REQUEST } from 'shared-interfaces';

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
        }
    ) => {
        try {
            const { url, macAddress, params, token, serialNumber } = payload;

            // Build URL with query parameters
            // Note: For 'cmd' parameter, we need to use encodeURI (not encodeURIComponent)
            // to preserve forward slashes, matching stalker-to-m3u implementation
            const urlObject = new URL(url);
            const queryParts: string[] = [];

            Object.entries(params).forEach(([key, value]) => {
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
            if (!params['JsHttpRequest']) {
                queryParts.push('JsHttpRequest=1-xml');
            }

            // Build final URL with manually constructed query string
            const fullUrl = `${urlObject.origin}${urlObject.pathname}?${queryParts.join('&')}`;

            // Build cookie string matching the working curl example format
            // Format: mac=XX:XX:XX:XX:XX:XX; stb_lang=de_DE; timezone=Europe/Berlin; __cfduid=...
            // The __cfduid cookie uses the serial number lowercase + random suffix
            let cookieString = `mac=${macAddress}; stb_lang=de_DE; timezone=Europe/Berlin`;
            if (serialNumber) {
                // Generate __cfduid from serial number (lowercase) + random suffix
                const cfduidBase = serialNumber.toLowerCase();
                const cfduidSuffix = 'e030245495acd6ebfc1'; // Static suffix matching working app
                cookieString += `; __cfduid=${cfduidBase}${cfduidSuffix}`;
            }

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
            if (serialNumber) {
                headers['SN'] = serialNumber;
            }

            // Add Authorization header if token is provided
            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            // Determine timeout based on action type
            // create_link requests can take longer as server generates stream URL
            const isCreateLink = params.action === 'create_link';
            const requestTimeout = isCreateLink ? 30000 : 15000;

            // Configure axios request
            const config: AxiosRequestConfig = {
                method: 'GET',
                url: fullUrl,
                headers,
                timeout: requestTimeout,
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
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
            return response.data;
        } catch (error) {
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
