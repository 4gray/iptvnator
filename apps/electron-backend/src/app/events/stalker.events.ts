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
 * Handle Stalker API requests with MAC address cookie
 */
ipcMain.handle(
    STALKER_REQUEST,
    async (
        event,
        payload: {
            url: string;
            macAddress: string;
            params: Record<string, string>;
        }
    ) => {
        try {
            const { url, macAddress, params } = payload;

            // Build URL with query parameters
            const urlObject = new URL(url);
            Object.entries(params).forEach(([key, value]) => {
                urlObject.searchParams.append(key, value);
            });

            // Configure axios request with MAC address cookie
            const config: AxiosRequestConfig = {
                method: 'GET',
                url: urlObject.toString(),
                headers: {
                    Cookie: `mac=${macAddress}`,
                    'User-Agent':
                        'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
                    'X-User-Agent': 'Model: MAG250; Link: WiFi',
                },
                timeout: 15000, // 15 seconds timeout
                validateStatus: (status) => status < 500, // Don't throw on 4xx errors
            };

            const response = await axios(config);

            // Check if response is successful
            if (response.status >= 400) {
                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

            // Return the response data
            return response.data;
        } catch (error) {
            console.error('Stalker request error:', error);

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
