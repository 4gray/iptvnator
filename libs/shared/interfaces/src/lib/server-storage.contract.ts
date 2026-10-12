/**
 * HTTP contract between the PWA and the self-hosted server storage. Routes
 * live under `/v1` of the web backend (`/api/v1` behind the Docker nginx).
 */
export const SERVER_STORAGE_API_VERSION = 1;

/** Xtream PWA user-data maps that the server stores per playlist id. */
export const SERVER_USER_STATE_NAMESPACES = [
    'xtream-favorites',
    'xtream-recent-items',
    'xtream-collection-items',
    'xtream-playback-positions',
] as const;

export type ServerUserStateNamespace =
    (typeof SERVER_USER_STATE_NAMESPACES)[number];

export function isServerUserStateNamespace(
    value: string
): value is ServerUserStateNamespace {
    return (SERVER_USER_STATE_NAMESPACES as readonly string[]).includes(value);
}

/**
 * Document fields that carry an M3U payload. An upsert with
 * `keepPayload=1` omits them and the server keeps the stored ones.
 */
export const SERVER_PAYLOAD_FIELDS = ['playlist', 'items', 'header'] as const;

export interface ServerInstanceInfo {
    readonly service: 'iptvnator';
    readonly apiVersion: number;
    /** Stable per database; `null` without server storage. */
    readonly instanceId: string | null;
    readonly storage: 'server' | 'none';
    readonly auth: 'none' | 'token';
}

/**
 * `WWW-Authenticate` value of the access guard's 401. A provider error the
 * proxy passes on never carries it, so a client can tell the two apart.
 */
export const SERVER_ACCESS_CHALLENGE = 'Bearer realm="iptvnator"';

/**
 * Sent with every `PUT /v1/playlists/:id`: the document's ETag before that
 * write. A client that kept the stored payload (`keepPayload=1`) may cache
 * its copy under the new ETag only if its payload came from this one.
 */
export const SERVER_REPLACED_ETAG_HEADER = 'X-Replaced-ETag';

export interface ServerStorageStatusResponse {
    readonly playlists: number;
    readonly databaseBytes: number;
    readonly databasePath: string;
    readonly startedAt: string;
}

export interface ServerUserStateResponse {
    readonly entries: Record<ServerUserStateNamespace, Record<string, unknown>>;
    /**
     * Version tag of every entry. A write sends the tag it is based on
     * (`If-Match: "<tag>"`, or `If-None-Match: *` for an entry the client
     * saw absent); a stale tag gets `412` with the current entry.
     */
    readonly tags?: Record<ServerUserStateNamespace, Record<string, string>>;
}

/** Answer to a user-state write: the entry's new tag, `null` once deleted. */
export interface ServerUserStateWriteResponse {
    readonly tag: string | null;
}

/** The entry as the server has it, sent with a `412` conflict. */
export interface ServerUserStateCurrent {
    /** Absent when the entry does not exist. */
    readonly value?: unknown;
    readonly tag: string | null;
}

export interface ServerStorageErrorBody {
    readonly message: string;
    readonly status: number;
    readonly code?: string;
    /** With `code: 'conflict'` (412): the user-state entry as it is now. */
    readonly current?: ServerUserStateCurrent;
}
