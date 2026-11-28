export const SOURCE_SYNC_CAPABILITY = 'sources-v1';
// The hosted pairing page selects the same browser profile as the web player.
export const SOURCE_SERVER_CONNECTION_KEY = 'iptvnator:source-server';
export const SOURCE_SERVER_DISABLED_KEY = 'iptvnator:source-server-disabled';
export const HOSTED_BROWSER_TOKEN_PREFIX = 'iptvnator:paired-browser:';

export interface SourceDefinition {
    id: string;
    title: string;
    kind: 'm3u-url' | 'm3u-text' | 'xtream' | 'stalker';
    url?: string;
    serverUrl?: string;
    portalUrl?: string;
    username?: string;
    password?: string;
    macAddress?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    isFullStalkerPortal?: boolean;
    stalkerSerialNumber?: string;
    stalkerDeviceId1?: string;
    stalkerDeviceId2?: string;
    stalkerSignature1?: string;
    stalkerSignature2?: string;
    rawM3u?: string;
}

export interface SourceInventoryEntry {
    source: SourceDefinition;
    revision: string;
}

export interface SourceInventory {
    entries: SourceInventoryEntry[];
}

/** Persisted selection contains no access token. */
export interface SourceServerConnection {
    apiUrl: string;
    instanceId: string;
}

export interface SavedSourceServerConnection extends SourceServerConnection {
    hasToken: boolean;
}

export const TMDB_TRANSFER_CODE_LENGTH = 4;
export const TMDB_TRANSFER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const tmdbTransferCodePattern = new RegExp(
    `^[${TMDB_TRANSFER_CODE_ALPHABET}]{${TMDB_TRANSFER_CODE_LENGTH}}$`
);

export function isTmdbTransferCode(value: unknown): value is string {
    return typeof value === 'string' && tmdbTransferCodePattern.test(value);
}

export function isTmdbTransferCapability(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

export function isTmdbTransferKey(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 2048 &&
        !/[^!-~]/.test(value)
    );
}

// The shared trace redactor recognizes credential fields ending in Token.
export type TmdbTransferRequest =
    | { action: 'start'; codeFormat?: 'short' }
    | { action: 'check' | 'status' | 'claim' | 'cancel'; transferToken: string }
    | { action: 'send'; transferToken: string; apiKey: string };

export interface TmdbTransferSession {
    senderToken: string;
    receiverToken: string;
    expiresInMs: number;
}

/** Narrow IPC surface; paths and arbitrary headers are never caller-supplied. */
export interface SourceServerRequest {
    operation:
        | 'instance'
        | 'list'
        | 'get'
        | 'create'
        | 'update'
        | 'delete'
        | 'clear'
        | 'activity-context'
        | 'activity-list'
        | 'activity-read'
        | 'activity-apply'
        | 'history-read'
        | 'history-apply'
        | 'favorites-context'
        | 'favorites-list'
        | 'favorites-read'
        | 'favorites-apply'
        | 'tmdb-transfer'
        | 'profiles-list'
        | 'profiles-set-enabled'
        | 'profiles-order'
        | 'profile-create'
        | 'profile-update'
        | 'profile-delete'
        | 'profile-unlock';
    tmdbTransfer?: {
        connection: SourceServerConnection;
        request: TmdbTransferRequest;
    };
    favorite?: {
        address: import('./favorites-sync/favorites-sync.contract').FavoriteAddress;
        operation?: import('./favorites-sync/favorites-sync.contract').FavoriteOperation;
    };
    history?: {
        scope: import('./history-sync/history.contract').HistoryScope;
        operation: import('./history-sync/history.contract').HistoryOperation;
    };
    cursor?: string;
    /** Whose personal state a list or read returns; absent is the Default profile. */
    scope?: import('./profiles/profile-scope').PersonalScope;
    activity?: {
        address: import('./activity-sync/activity-sync.contract').ActivityAddress;
        operation?: import('./activity-sync/activity-sync.contract').ActivityOperation;
    };
    profile?:
        | import('./profiles/profiles.contract').UpdateServerProfilesRequest
        | import('./profiles/profiles.contract').ReorderServerProfilesRequest
        | import('./profiles/profiles.contract').CreateServerProfileRequest
        | import('./profiles/profiles.contract').UpdateServerProfileRequest
        | import('./profiles/profiles.contract').DeleteServerProfileRequest
        | import('./profiles/profiles.contract').UnlockServerProfileRequest;
    id?: string;
    source?: SourceDefinition;
    revision?: string;
}

export interface SourceServerResponse {
    status: number;
    etag?: string;
    /**
     * Whole seconds parsed from a `Retry-After` delta-seconds header
     * (`pin_locked`, `pin_rate_limited`); absent when it is missing or not a
     * non-negative integer.
     */
    retryAfter?: number;
    body?: unknown;
}
