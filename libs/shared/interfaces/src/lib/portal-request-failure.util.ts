/**
 * Expected portal-request failures, carried across the Electron IPC boundary
 * as a RESOLVED value.
 *
 * `ipcMain.handle` logs every rejected handler as
 * `Error occurred in handler for '<channel>'` with a stack trace, and
 * `ipcRenderer.invoke` keeps nothing of the rejection but its message. Two
 * outcomes of a portal request are routine rather than errors, so they must
 * not take that path:
 *
 * - a **cancelled** request — the renderer navigated away, superseded it, or
 *   let its probe deadline pass; and
 * - an HTTP **401/403** — the portal answered and refused, which the renderer
 *   already classifies structurally (`isStalkerAuthorizationFailure`,
 *   `sourceHealthError`, the lazy portal repair).
 *
 * The main process resolves them as this envelope. The renderer's Electron
 * data service is the only consumer of the raw bridge result; it turns the
 * envelope back into the thrown error its callers already understand — an
 * `AbortError`, or an `HTTP Error <status>` message with a numeric `status` —
 * so a cancelled request can never be mistaken for a successful empty answer.
 *
 * This lives in `shared/interfaces` for the same reason as the Stalker
 * auth-failure marker: the main process cannot import renderer libraries, and
 * two copies would drift.
 */

export const PORTAL_REQUEST_FAILURE_KEY = 'portalRequestFailure';

/** HTTP statuses that mean "the portal answered and refused", not "broken". */
export const EXPECTED_PORTAL_HTTP_STATUSES: readonly number[] = [401, 403];

export type PortalRequestFailure =
    | { kind: 'cancelled' }
    | { kind: 'http'; status: number; statusText?: string };

export interface PortalRequestFailureEnvelope {
    [PORTAL_REQUEST_FAILURE_KEY]: PortalRequestFailure;
}

export type PortalRequestProvider = 'stalker' | 'xtream';

const PROVIDER_LABEL: Record<PortalRequestProvider, string> = {
    stalker: 'Stalker',
    xtream: 'Xtream',
};

export function isExpectedPortalHttpStatus(status: unknown): status is number {
    return (
        typeof status === 'number' &&
        EXPECTED_PORTAL_HTTP_STATUSES.includes(status)
    );
}

export function createPortalRequestFailureEnvelope(
    failure: PortalRequestFailure
): PortalRequestFailureEnvelope {
    return { [PORTAL_REQUEST_FAILURE_KEY]: failure };
}

/**
 * The failure a bridge result carries, or null for an ordinary response.
 * Strict on shape: a portal payload that happens to contain the key with
 * anything else in it is still a payload.
 */
export function readPortalRequestFailure(
    value: unknown
): PortalRequestFailure | null {
    if (!value || typeof value !== 'object') {
        return null;
    }

    const failure = (value as Record<string, unknown>)[
        PORTAL_REQUEST_FAILURE_KEY
    ];
    if (!failure || typeof failure !== 'object') {
        return null;
    }

    const { kind, status, statusText } = failure as Record<string, unknown>;
    if (kind === 'cancelled') {
        return { kind };
    }

    if (kind !== 'http' || typeof status !== 'number') {
        return null;
    }

    // `statusText` must be a string or absent: the guard below vouches for the
    // whole shape, and a caller that reads the original value must not meet a
    // number where the type promises a string.
    if (statusText === undefined) {
        return { kind, status };
    }

    return typeof statusText === 'string' ? { kind, status, statusText } : null;
}

/**
 * Type guard for a bridge result: narrows the union the bridge promises
 * (`ElectronBridgeXtreamResult`) so success fields cannot be read off an
 * envelope without checking first.
 */
export function isPortalRequestFailureEnvelope(
    value: unknown
): value is PortalRequestFailureEnvelope {
    return readPortalRequestFailure(value) !== null;
}

/**
 * The message shape the renderer classifies HTTP failures from
 * (`getStalkerRequestErrorStatus`, `isStalkerAuthorizationFailure`,
 * `sourceHealthError`): `HTTP Error <status>`, with the status text when the
 * portal sent one.
 */
export function formatPortalHttpErrorMessage(
    status: number,
    statusText?: string
): string {
    const text = statusText?.trim();
    return text ? `HTTP Error ${status}: ${text}` : `HTTP Error ${status}`;
}

/**
 * Rebuilds the error the renderer expects from a resolved envelope.
 *
 * A cancellation is an `AbortError`, the convention the database and refresh
 * paths already use (`isDbAbortError`). An HTTP refusal carries the numeric
 * `status` — which the old rejection lost at the IPC boundary — and the
 * message the classifiers parse.
 */
export function createPortalRequestError(
    failure: PortalRequestFailure,
    provider: PortalRequestProvider
): Error {
    if (failure.kind === 'cancelled') {
        const error = new Error(
            `${PROVIDER_LABEL[provider]} request cancelled`
        );
        error.name = 'AbortError';
        return error;
    }

    const error = new Error(
        formatPortalHttpErrorMessage(failure.status, failure.statusText)
    ) as Error & { status: number };
    error.status = failure.status;
    return error;
}

/** Whether an error is a cancelled portal request (or any other abort). */
export function isPortalRequestCancelledError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}
