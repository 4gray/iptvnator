import {
    isStalkerAuthFailureMessage,
    isStalkerAuthFailureResponse,
} from '@iptvnator/shared/interfaces';

/**
 * Checks whether a response or thrown error indicates a Stalker authorization
 * failure.
 *
 * Every signal here is structural. `isStalkerAuthFailureResponse` covers the
 * complete set of portal auth failures — the plain-text bodies, the transport
 * marker Electron mints from them, and the JSON-envelope forms — and is
 * shared with endpoint discovery and the lazy repair, so a phrase one layer
 * classifies as an auth failure cannot be ignored by another: the session
 * would otherwise keep an expired token and every later request fails.
 *
 * What is deliberately gone: the old `JSON.stringify(response)` regex sweep.
 * It matched the phrase anywhere in an arbitrary payload — including inside
 * legitimate catalog data — and existed only because the raw body reached the
 * renderer unclassified. The transports classify now, so the shapes are known.
 */
export function isStalkerAuthorizationFailure(
    responseOrError: unknown
): boolean {
    if (!responseOrError) {
        return false;
    }

    const response = responseOrError as Record<string, unknown>;
    const message = response?.['message'];

    if (
        isStalkerAuthFailureResponse(responseOrError) ||
        isStalkerAuthFailureMessage(message)
    ) {
        return true;
    }

    // HTTP auth codes survive the IPC boundary only as message text
    // (`HTTP Error 401: …`): the custom `status` property is stripped by
    // ipcRenderer, so the numeric code must be read from the message.
    if (typeof message === 'string' && /HTTP Error 40[13]\b/.test(message)) {
        return true;
    }

    // Same code on a response object that never crossed IPC.
    return response?.['status'] === 401 || response?.['status'] === 403;
}
