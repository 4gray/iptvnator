import type { ServerUserStateWriteResponse } from '@iptvnator/shared/interfaces';
import {
    type KeepaliveOutcome,
    PLAYLIST_MISSING,
    ServerApiError,
    type ServerApiClient,
} from './server-api-client';
import {
    entryPath,
    type PendingEntry,
    preconditionHeaders,
} from './server-user-data-entries';

/** What the queue needs of the API client. */
export type ServerApi = Pick<
    ServerApiClient,
    'readJson' | 'sendJson' | 'request' | 'sendKeepalive'
>;

/** How a write was answered; a failed normal write carries its error. */
export type WriteOutcome =
    KeepaliveOutcome | { readonly status: 'failed'; readonly error: unknown };

/**
 * Sends one entry on the server version it is based on: saved with the
 * new tag (unknown when the body was cut off), a `412` with the server's
 * current value, gone with its playlist, or failed.
 */
export async function sendEntry(
    api: ServerApi,
    entry: PendingEntry
): Promise<WriteOutcome> {
    const headers = preconditionHeaders(entry.tag);
    try {
        const response =
            entry.value === undefined
                ? await api.request(entryPath(entry), {
                      method: 'DELETE',
                      headers,
                  })
                : await api.sendJson(
                      'PUT',
                      entryPath(entry),
                      { value: entry.value },
                      headers
                  );
        const { tag } = await api
            .readJson<Partial<ServerUserStateWriteResponse>>(response)
            .catch(() => ({ tag: undefined }));
        return { status: 'saved', tag };
    } catch (error) {
        if (
            error instanceof ServerApiError &&
            error.status === 412 &&
            error.current
        ) {
            return { status: 'conflict', current: error.current };
        }
        if (
            error instanceof ServerApiError &&
            error.code === PLAYLIST_MISSING
        ) {
            return { status: 'gone' };
        }
        return { status: 'failed', error };
    }
}

/**
 * The same write as a `keepalive` request, which survives the page. The
 * request starts before this returns, while the hiding page still runs.
 */
export function sendEntryKeepalive(
    api: ServerApi,
    entry: PendingEntry
): Promise<KeepaliveOutcome> {
    const path = entryPath(entry);
    const headers = preconditionHeaders(entry.tag);
    return entry.value === undefined
        ? api.sendKeepalive('DELETE', path, undefined, headers)
        : api.sendKeepalive('PUT', path, { value: entry.value }, headers);
}
