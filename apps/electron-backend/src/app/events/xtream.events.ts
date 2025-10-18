/**
 * This module handles all Xtream Codes API related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig } from 'axios';
import { ipcMain } from 'electron';
import { XTREAM_REQUEST } from 'shared-interfaces';

export default class XtreamEvents {
    static bootstrapXtreamEvents(): Electron.IpcMain {
        return ipcMain;
    }
}

/**
 * Handle Xtream Codes API requests
 */
ipcMain.handle(
    XTREAM_REQUEST,
    async (
        event,
        payload: {
            url: string;
            params: Record<string, string>;
        }
    ) => {
        try {
            const { url, params } = payload;

            // Build URL with query parameters
            // Xtream API endpoint is always at /player_api.php
            const apiUrl = new URL(`${url}/player_api.php`);
            Object.entries(params).forEach(([key, value]) => {
                apiUrl.searchParams.append(key, value);
            });

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
            };

            const response = await axios(config);

            // Check if response is successful
            if (response.status >= 400) {
                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

            // Xtream API returns JSON data
            return {
                payload: response.data,
                action: params.action,
            };
        } catch (error) {
            console.error('Xtream request error:', error);

            // Format error response
            if (axios.isAxiosError(error)) {
                const errorResponse = {
                    type: 'ERROR',
                    message:
                        error.response?.data?.message ||
                        error.message ||
                        'Failed to fetch data from Xtream server',
                    status: error.response?.status || 500,
                };
                throw errorResponse;
            } else if (error && typeof error === 'object' && 'message' in error) {
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
