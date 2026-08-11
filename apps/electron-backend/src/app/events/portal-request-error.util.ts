import axios from 'axios';

/**
 * Compact, credential-free shape for logging a failed portal request.
 * Only host + pathname of the request URL are retained: Xtream URLs carry
 * username/password in the query string and Stalker URLs carry the session
 * command, so the query must never reach a log line.
 */
export interface PortalRequestErrorLog {
    action?: string;
    host: string;
    pathname: string;
    type: 'AxiosError' | 'ErrorObject' | 'UnknownError';
    code?: string;
    status?: unknown;
    message?: unknown;
    syscall?: string;
    hostname?: string;
}

export function formatPortalRequestError(
    error: unknown,
    requestUrl: string,
    action?: string
): PortalRequestErrorLog {
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
        return {
            ...base,
            type: 'AxiosError',
            code: error.code,
            status: error.response?.status,
            message: error.message,
            syscall: (error as NodeJS.ErrnoException).syscall,
            hostname: (error as { hostname?: string }).hostname,
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
