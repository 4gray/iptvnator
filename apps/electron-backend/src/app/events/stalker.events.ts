/**
 * This module handles all Stalker portal related IPC communications
 * between the frontend and the electron backend.
 */

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import { createHash } from 'crypto';
import { ipcMain } from 'electron';
import { PortalDebugEvent, STALKER_REQUEST } from 'shared-interfaces';
import { rememberStalkerPlaybackContext } from '../services/stalker-playback-context.service';
import { emitPortalDebugEvent } from './portal-debug.events';

const LEGACY_DEFAULT_SERIAL = 'BEDACD4569BAF';
const MAG250_USER_AGENT =
    'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG250';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

    const serialPrefix = serialNumber.toLowerCase().replace(/[^a-f0-9]/g, '');
    const cfduid = `${serialPrefix}${md5.slice(serialPrefix.length)}`.slice(
        0,
        32
    );

    return { serialNumber, cfduid };
}

function appendParamsFromUnknown(
    target: Record<string, string>,
    source: unknown
): void {
    if (!source) {
        return;
    }

    if (source instanceof URLSearchParams) {
        source.forEach((value, key) => {
            target[key] = value;
        });
        return;
    }

    if (Array.isArray(source)) {
        source.forEach((entry) => {
            if (Array.isArray(entry) && entry.length >= 2) {
                const [key, value] = entry;
                if (value !== undefined && value !== null) {
                    target[String(key)] = String(value);
                }
            }
        });
        return;
    }

    if (!isRecord(source)) {
        return;
    }

    Object.entries(source).forEach(([key, value]) => {
        if (value === undefined || value === null) {
            return;
        }

        if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            target[key] = String(value);
            return;
        }

        if (value instanceof URLSearchParams) {
            value.forEach((nestedValue, nestedKey) => {
                target[nestedKey] = nestedValue;
            });
            return;
        }

        if (Array.isArray(value) || isRecord(value)) {
            target[key] = JSON.stringify(value);
        }
    });
}

function buildMergedRequestParams(
    url: string,
    payload: {
        params?: unknown;
        query?: unknown;
        searchParams?: unknown;
        data?: unknown;
        request?: unknown;
        requestParams?: unknown;
        payload?: unknown;
    }
): Record<string, string> {
    const requestParams: Record<string, string> = {};
    const urlObject = new URL(url);

    urlObject.searchParams.forEach((value, key) => {
        requestParams[key] = value;
    });

    appendParamsFromUnknown(requestParams, payload.params);
    appendParamsFromUnknown(requestParams, payload.query);
    appendParamsFromUnknown(requestParams, payload.searchParams);
    appendParamsFromUnknown(requestParams, payload.requestParams);

    if (isRecord(payload.data)) {
        appendParamsFromUnknown(requestParams, payload.data);
        appendParamsFromUnknown(requestParams, payload.data.params);
        appendParamsFromUnknown(requestParams, payload.data.query);
    }

    if (isRecord(payload.request)) {
        appendParamsFromUnknown(requestParams, payload.request);
        appendParamsFromUnknown(requestParams, payload.request.params);
        appendParamsFromUnknown(requestParams, payload.request.query);
    }

    if (isRecord(payload.payload)) {
        appendParamsFromUnknown(requestParams, payload.payload);
        appendParamsFromUnknown(requestParams, payload.payload.params);
        appendParamsFromUnknown(requestParams, payload.payload.query);
    }

    return requestParams;
}

function buildQueryParts(requestParams: Record<string, string>): string[] {
    const queryParts: string[] = [];

    Object.entries(requestParams).forEach(([key, value]) => {
        if (key === 'cmd') {
            queryParts.push(`${key}=${String(value)}`);
        } else {
            queryParts.push(`${key}=${encodeURIComponent(String(value))}`);
        }
    });

    if (!requestParams['JsHttpRequest']) {
        queryParts.push('JsHttpRequest=1-xml');
    }

    return queryParts;
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
            params?: unknown;
            query?: unknown;
            searchParams?: unknown;
            data?: unknown;
            request?: unknown;
            requestParams?: unknown;
            payload?: unknown;
            token?: string;
            serialNumber?: string;
            requestId?: string;
        }
    ) => {
        const startedAt = Date.now();
        let debugRequest: Record<string, unknown> | undefined;

        try {
            const {
                url,
                macAddress,
                token,
                serialNumber,
                requestId,
            } = payload;

            const identity = deriveStalkerIdentity(macAddress, serialNumber);
            const effectiveSerialNumber = identity.serialNumber;
            const requestParams = buildMergedRequestParams(url, payload);

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

            if (!requestParams.action || !requestParams.type) {
                console.warn('[StalkerEvents] Missing normalized params', {
                    payloadKeys: Object.keys(payload ?? {}),
                    normalizedParams: requestParams,
                    url,
                });
            }

            const urlObject = new URL(url);
            const queryParts = buildQueryParts(requestParams);
            const endpointUrl = `${urlObject.origin}${urlObject.pathname}`;
            const fullUrl =
                queryParts.length > 0
                    ? `${endpointUrl}?${queryParts.join('&')}`
                    : endpointUrl;
            const formBody = queryParts.join('&');

            const cookieString = `mac=${macAddress}; stb_lang=en_US@rg=dezzzz; timezone=Europe/Berlin; __cfduid=${identity.cfduid}`;

            const headers: Record<string, string> = {
                Cookie: cookieString,
                'User-Agent': MAG250_USER_AGENT,
                'X-User-Agent': MAG250_USER_AGENT,
                Accept: '*/*',
                Connection: 'keep-alive',
                'Accept-Language': 'en-US,en;q=0.9',
            };

            if (effectiveSerialNumber) {
                headers['SN'] = effectiveSerialNumber;
            }

            if (token) {
                headers['Authorization'] = `Bearer ${token}`;
            }

            const isCreateLink = requestParams.action === 'create_link';
            const requestTimeout = isCreateLink ? 30000 : 15000;
            const validateStatus = (status: number) => status < 500;

            const performRequest = async (
                config: AxiosRequestConfig,
                requestMeta: Record<string, unknown>
            ): Promise<AxiosResponse<any>> => {
                debugRequest = requestMeta;
                return axios(config);
            };

            let response = await performRequest(
                {
                    method: 'GET',
                    url: fullUrl,
                    headers,
                    timeout: requestTimeout,
                    validateStatus,
                },
                {
                    method: 'GET',
                    url: fullUrl,
                    headers,
                    timeout: requestTimeout,
                    params: requestParams,
                }
            );

            if (response.status === 405) {
                console.warn(
                    '[StalkerEvents] GET returned 405, retrying as POST',
                    {
                        action: requestParams.action,
                        type: requestParams.type,
                    }
                );

                const postHeaders = {
                    ...headers,
                    'Content-Type':
                        'application/x-www-form-urlencoded; charset=UTF-8',
                };

                response = await performRequest(
                    {
                        method: 'POST',
                        url: endpointUrl,
                        headers: postHeaders,
                        data: formBody,
                        timeout: requestTimeout,
                        validateStatus,
                    },
                    {
                        method: 'POST',
                        url: endpointUrl,
                        headers: postHeaders,
                        timeout: requestTimeout,
                        params: requestParams,
                        data: formBody,
                        fallbackFrom: 'GET',
                        originalUrl: fullUrl,
                    }
                );

                console.warn(
                    '[StalkerEvents] POST retry status:',
                    response.status,
                    response.statusText,
                    {
                        action: requestParams.action,
                        type: requestParams.type,
                    }
                );
            }

            if (response.status >= 400) {
                console.error(
                    '[StalkerEvents] HTTP Error:',
                    response.status,
                    response.statusText,
                    {
                        action: requestParams.action,
                        type: requestParams.type,
                    }
                );

                throw {
                    message: `HTTP Error: ${response.statusText}`,
                    status: response.status,
                };
            }

            if (
                requestParams.action === 'create_link' &&
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
                    operation: requestParams.action ?? 'unknown',
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
                const fallbackParams = buildMergedRequestParams(
                    payload.url,
                    payload
                );

                const debugEvent: PortalDebugEvent = {
                    requestId: payload.requestId,
                    provider: 'stalker',
                    operation: fallbackParams.action ?? 'unknown',
                    transport: 'electron-main',
                    startedAt: new Date(startedAt).toISOString(),
                    durationMs: Date.now() - startedAt,
                    status: 'error',
                    request: debugRequest ?? {
                        method: 'GET',
                        url: payload.url,
                        params: fallbackParams,
                    },
                    error,
                };

                emitPortalDebugEvent(debugEvent);
            }

            console.error('[StalkerEvents] Request error:', error);

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