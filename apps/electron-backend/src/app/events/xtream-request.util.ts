/**
 * Pure helpers for the Xtream Codes IPC handlers: request-URL construction,
 * structured error responses, and debug-log error formatting. Kept separate
 * from `xtream.events.ts` so that file stays focused on IPC registration.
 */

import axios from 'axios';
import {
    ElectronBridgeXtreamErrorResponse,
    normalizeXtreamServerUrl,
} from '@iptvnator/shared/interfaces';

/**
 * Builds a structured, log-safe summary of an Xtream request failure. Never
 * throws on an unparseable URL — falls back to the raw request string.
 */
export function formatXtreamError(
    error: unknown,
    requestUrl: string,
    action?: string
) {
    let parsedUrl: URL | null = null;
    try {
        parsedUrl = new URL(requestUrl);
    } catch {
        parsedUrl = null;
    }
    const base = {
        action,
        host: parsedUrl?.host ?? 'unknown',
        pathname: parsedUrl?.pathname ?? requestUrl,
    };

    if (axios.isAxiosError(error)) {
        const networkError = error as NodeJS.ErrnoException & {
            hostname?: string;
        };
        return {
            ...base,
            type: 'AxiosError',
            code: error.code,
            status: error.response?.status,
            message: error.message,
            syscall: networkError.syscall,
            hostname: networkError.hostname,
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
 * Converts a thrown error into the structured IPC failure envelope the
 * renderer expects, preserving cancellation (`AbortError`/499) and status.
 */
export function createXtreamErrorResponse(
    error: unknown
): ElectronBridgeXtreamErrorResponse {
    if (axios.isAxiosError(error)) {
        if (error.code === 'ERR_CANCELED') {
            return {
                type: 'ERROR',
                name: 'AbortError',
                message: 'Xtream request cancelled',
                status: 499,
            };
        }

        return {
            type: 'ERROR',
            message:
                error.response?.data?.message ||
                error.message ||
                'Failed to fetch data from Xtream server',
            status: error.response?.status || 500,
        };
    }

    if (error && typeof error === 'object') {
        const errorRecord = error as Record<string, unknown>;
        return {
            type: 'ERROR',
            ...(typeof errorRecord.name === 'string'
                ? { name: errorRecord.name }
                : {}),
            message:
                typeof errorRecord.message === 'string'
                    ? errorRecord.message
                    : 'An unknown error occurred',
            status:
                typeof errorRecord.status === 'number'
                    ? errorRecord.status
                    : 500,
        };
    }

    return {
        type: 'ERROR',
        message: 'An unknown error occurred',
        status: 500,
    };
}

/**
 * Normalizes a (possibly full) Xtream server URL and appends the canonical
 * `player_api.php` endpoint with trimmed credential params.
 */
export function buildXtreamApiUrl(
    url: string,
    params: Record<string, string>
): URL {
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
