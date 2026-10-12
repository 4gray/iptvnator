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

export interface ServerStorageStatusResponse {
    readonly playlists: number;
    readonly databaseBytes: number;
    readonly databasePath: string;
    readonly startedAt: string;
}

export interface ServerUserStateResponse {
    readonly entries: Record<ServerUserStateNamespace, Record<string, unknown>>;
}

export interface ServerStorageErrorBody {
    readonly message: string;
    readonly status: number;
    readonly code?: string;
}
