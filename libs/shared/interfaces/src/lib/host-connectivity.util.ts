/**
 * Cross-process contract for the main-process host connectivity guard.
 *
 * The guard fast-fails requests to a portal host that just failed to answer
 * several times in a row, instead of hanging the full axios timeout again.
 *
 * Only the MESSAGE of a rejected IPC handler survives the trip to the
 * renderer — `ipcRenderer.invoke` strips custom properties and re-wraps the
 * value — and the Stalker renderer classifies transport failures purely from
 * that text. The wording below is therefore a contract, not a label:
 *
 * - no `HTTP Error <code>`: `getStalkerRequestErrorStatus` would report a
 *   status, so endpoint discovery would read "this endpoint is absent, probe
 *   the next candidate", and 404/401/403 would additionally fire lazy portal
 *   repair against a host we just declared dead;
 * - no timeout wording: `isStalkerProbeTimeout` would keep discovery walking
 *   every candidate instead of aborting on the first one;
 * - none of the auth phrases `isStalkerAuthFailureMessage` accepts (a bare
 *   `authorization` is one of them) — that would also trigger lazy repair.
 *
 * What is left is the "connection-level failure" slot the renderer already
 * has for ECONNREFUSED/ENOTFOUND: discovery stops probing and reports the
 * host unreachable, which is exactly what a tripped guard means. The message
 * also reaches error snackbars verbatim, so it has to read like a sentence.
 *
 * `endpoint` is the request origin (scheme, host and port), not a bare host: a
 * user with the same panel imported over both HTTP and HTTPS needs to see which
 * of the two was skipped. A scheme is safe here — none of the forbidden
 * substrings above can appear in one.
 */
export function buildHostConnectivityFastFailMessage(endpoint: string): string {
    return `Portal ${endpoint} is not responding; skipped after repeated connection failures`;
}

const FAST_FAIL_MESSAGE_PATTERN =
    /is not responding; skipped after repeated connection failures/;

/**
 * Whether a message came from the guard, bare or in the form Electron wraps
 * it into (`Error invoking remote method 'STALKER_REQUEST': <message>`).
 *
 * Exported so tests and any future renderer-side handling share one
 * definition of the wording instead of re-typing the sentence.
 */
export function isHostConnectivityFastFailMessage(message: unknown): boolean {
    return (
        typeof message === 'string' && FAST_FAIL_MESSAGE_PATTERN.test(message)
    );
}
