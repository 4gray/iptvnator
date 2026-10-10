import {
    isExpectedPortalHttpStatus,
    PortalRequestFailure,
} from '@iptvnator/shared/interfaces';
import { redactSensitiveData } from '@iptvnator/shared/logging';
import { isRendererApiTraceEnabled, trace } from '../services/debug-trace';
import { formatPortalRequestError } from './portal-request-error.util';

/**
 * Decides, once for both portal IPC handlers, whether a failed request is a
 * routine outcome the renderer asked for or can handle (see
 * `portal-request-failure.util.ts` in `shared/interfaces`) and logs it at
 * the matching level.
 *
 * Routine outcomes are resolved by the handler as a structured envelope, so
 * Electron does not print `Error occurred in handler for '<channel>'` with a
 * stack trace for every navigation away from a portal or every expired
 * credential. Real failures — network errors, 5xx, parse errors, every other
 * status — keep rejecting and keep their error log.
 */

/**
 * Whether the transport gave up because the request's abort signal fired.
 * axios rejects with `CanceledError` (`code: 'ERR_CANCELED'`); the name check
 * covers an abort raised before axios was reached.
 */
export function isCancelledPortalRequest(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }

    const { code, name } = error as { code?: unknown; name?: unknown };
    return (
        code === 'ERR_CANCELED' ||
        name === 'CanceledError' ||
        name === 'AbortError'
    );
}

/**
 * HTTP status of a failure that is a portal answer. The handlers throw the
 * `validateStatus`-accepted 4xx as an error carrying `status`; a 5xx arrives
 * as an axios error with a `response`.
 */
function readHttpStatus(
    error: unknown
): { status: number; statusText?: string } | null {
    if (!error || typeof error !== 'object') {
        return null;
    }

    const own = error as {
        status?: unknown;
        statusText?: unknown;
        response?: { status?: unknown; statusText?: unknown };
    };
    const source = typeof own.status === 'number' ? own : own.response;
    if (!source || typeof source.status !== 'number') {
        return null;
    }

    return {
        status: source.status,
        statusText:
            typeof source.statusText === 'string'
                ? source.statusText
                : undefined,
    };
}

/**
 * The expected failure a request ended in, or null for a real failure.
 */
export function classifyExpectedPortalFailure(
    error: unknown
): PortalRequestFailure | null {
    if (isCancelledPortalRequest(error)) {
        return { kind: 'cancelled' };
    }

    const http = readHttpStatus(error);
    if (http && isExpectedPortalHttpStatus(http.status)) {
        return http.statusText
            ? { kind: 'http', status: http.status, statusText: http.statusText }
            : { kind: 'http', status: http.status };
    }

    return null;
}

/**
 * One line per failed request, at the level its outcome deserves.
 *
 * - cancelled: nothing, unless `IPTVNATOR_TRACE_IPC` (or the startup trace)
 *   is on — the renderer asked for it;
 * - HTTP 401/403: one `console.warn`, so an expired or wrong credential stays
 *   visible without a stack trace;
 * - anything else: `console.error`, as before.
 *
 * Every level goes through the compact credential-free shape (host and
 * pathname only, never the query string) and the shared redactor.
 */
export function logPortalRequestFailure(
    channel: string,
    expected: PortalRequestFailure | null,
    error: unknown,
    requestUrl: string,
    action?: string
): void {
    const details = () =>
        redactSensitiveData(
            formatPortalRequestError(error, requestUrl, action)
        );

    if (expected?.kind === 'cancelled') {
        if (isRendererApiTraceEnabled()) {
            trace(channel, 'cancelled', details());
        }
        return;
    }

    if (expected?.kind === 'http') {
        console.warn(`[${channel}] Refused`, details());
        return;
    }

    console.error(`[${channel}] Failed`, details());
}
