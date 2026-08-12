import axios from 'axios';

/**
 * Stand-in for a request URL that could not be parsed. The raw string must
 * never be retained: a caller reaches this branch precisely when the URL is
 * malformed (`http://user:secret@`, missing host), and `redactSensitiveData`
 * only sanitizes userinfo of URLs it can parse — a malformed one is passed
 * through verbatim, password included.
 */
const UNPARSEABLE_URL_VALUE = '[unparseable-url]';

/**
 * Compact, credential-free shape for logging a failed portal request.
 * Only host + pathname of the request URL are retained: Xtream URLs carry
 * username/password in the query string and Stalker URLs carry the session
 * command, so the query must never reach a log line.
 *
 * Callers must pass a portal API endpoint (`/player_api.php`,
 * `/stalker_portal/server/load.php`). Xtream STREAM URLs embed credentials in
 * the path itself (`/live/<user>/<pass>/id.ts`), which this shape retains.
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
        pathname: parsedUrl?.pathname ?? UNPARSEABLE_URL_VALUE,
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
