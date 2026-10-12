/**
 * Row codec for the `playlists` table. The whole renderer `Playlist`
 * document is stored as JSON in `payload`; the fields that metadata reads
 * need are projected into columns. The Electron database worker and the
 * self-hosted web backend both use this module, so both write the same rows.
 */
import * as schema from './schema';

export const PLAYLIST_TYPES = {
    XTREAM: 'xtream',
    STALKER: 'stalker',
    M3U_FILE: 'm3u-file',
    M3U_TEXT: 'm3u-text',
    M3U_URL: 'm3u-url',
} as const;

export type AppPlaylistType =
    (typeof PLAYLIST_TYPES)[keyof typeof PLAYLIST_TYPES];
const PLAYLIST_TYPE_VALUES = new Set<AppPlaylistType>(
    Object.values(PLAYLIST_TYPES)
);

function getStringValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
}

function getNumericValue(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

export function parseJsonValue<T>(
    value: string | null | undefined,
    fallback: T
): T {
    if (!value) {
        return fallback;
    }

    try {
        return JSON.parse(value) as T;
    } catch (error) {
        // The parser's message quotes the stored text, which can hold
        // portal credentials; the error name is enough to diagnose.
        console.warn(
            'Failed to parse JSON value from DB:',
            error instanceof Error ? error.name : typeof error
        );
        return fallback;
    }
}

function getStringArrayValue(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter((item) => item.length > 0);
}

function inferPlaylistType(playlist: Record<string, unknown>): AppPlaylistType {
    const explicitType = getStringValue(playlist['type']);
    if (
        explicitType &&
        PLAYLIST_TYPE_VALUES.has(explicitType as AppPlaylistType)
    ) {
        return explicitType as AppPlaylistType;
    }

    if (getStringValue(playlist['serverUrl'])) {
        return PLAYLIST_TYPES.XTREAM;
    }

    if (getStringValue(playlist['macAddress'])) {
        return PLAYLIST_TYPES.STALKER;
    }

    if (getStringValue(playlist['filePath'])) {
        return PLAYLIST_TYPES.M3U_FILE;
    }

    if (getStringValue(playlist['url'])) {
        return PLAYLIST_TYPES.M3U_URL;
    }

    return PLAYLIST_TYPES.M3U_TEXT;
}

export function buildPlaylistRow(
    playlist: Record<string, unknown>
): schema.NewPlaylist | null {
    const id =
        getStringValue(playlist['_id']) ?? getStringValue(playlist['id']);
    if (!id) {
        return null;
    }

    const type = inferPlaylistType(playlist);
    const portalUrl = getStringValue(playlist['portalUrl']);
    const url = getStringValue(playlist['url']);
    const nowIso = new Date().toISOString();
    const updateDate = getNumericValue(playlist['updateDate']);

    return {
        id,
        name:
            getStringValue(playlist['title']) ??
            getStringValue(playlist['name']) ??
            id,
        serverUrl: getStringValue(playlist['serverUrl']),
        username: getStringValue(playlist['username']),
        password: getStringValue(playlist['password']),
        lastUpdated:
            typeof updateDate === 'number'
                ? new Date(updateDate).toISOString()
                : getStringValue(playlist['lastUpdated']),
        type,
        userAgent: getStringValue(playlist['userAgent']),
        origin: getStringValue(playlist['origin']),
        referrer: getStringValue(playlist['referrer']),
        filePath: getStringValue(playlist['filePath']),
        epgUrls:
            playlist['epgUrls'] !== undefined
                ? JSON.stringify(getStringArrayValue(playlist['epgUrls']))
                : undefined,
        detectedEpgUrls:
            playlist['detectedEpgUrls'] !== undefined
                ? JSON.stringify(
                      getStringArrayValue(playlist['detectedEpgUrls'])
                  )
                : undefined,
        manualEpgUrls:
            playlist['manualEpgUrls'] !== undefined
                ? JSON.stringify(getStringArrayValue(playlist['manualEpgUrls']))
                : undefined,
        disabledEpgUrls:
            playlist['disabledEpgUrls'] !== undefined
                ? JSON.stringify(
                      getStringArrayValue(playlist['disabledEpgUrls'])
                  )
                : undefined,
        autoRefresh: Boolean(playlist['autoRefresh']),
        macAddress: getStringValue(playlist['macAddress']),
        url: type === PLAYLIST_TYPES.STALKER ? (portalUrl ?? url) : url,
        portalUrl,
        count: getNumericValue(playlist['count']),
        importDate: getStringValue(playlist['importDate']),
        updateDate,
        position: getNumericValue(playlist['position']),
        favorites:
            playlist['favorites'] !== undefined
                ? JSON.stringify(playlist['favorites'])
                : undefined,
        recentlyViewed:
            playlist['recentlyViewed'] !== undefined
                ? JSON.stringify(playlist['recentlyViewed'])
                : undefined,
        payload: JSON.stringify(playlist),
        lastUsage: getStringValue(playlist['lastUsage']) ?? nowIso,
    };
}

export function getPlaylistItemCount(
    playlist: Record<string, unknown>
): number | undefined {
    try {
        const value = playlist['playlist'];
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const items = Reflect.get(value, 'items');
        return Array.isArray(items) ? items.length : undefined;
    } catch {
        return undefined;
    }
}

export function parseAppPlaylist(
    row: schema.Playlist
): Record<string, unknown> {
    const payload = parseJsonValue<Record<string, unknown> | null>(
        row.payload,
        null
    );
    const base = payload && typeof payload === 'object' ? payload : {};
    const favorites = parseJsonValue<unknown[]>(row.favorites, []);
    const recentlyViewed = parseJsonValue<unknown[]>(row.recentlyViewed, []);
    const epgUrls = getStringArrayValue(
        row.epgUrls
            ? parseJsonValue<unknown[]>(row.epgUrls, [])
            : base['epgUrls']
    );
    const detectedEpgUrls = getStringArrayValue(
        row.detectedEpgUrls
            ? parseJsonValue<unknown[]>(row.detectedEpgUrls, [])
            : (base['detectedEpgUrls'] ?? epgUrls)
    );
    const manualEpgUrls = getStringArrayValue(
        row.manualEpgUrls
            ? parseJsonValue<unknown[]>(row.manualEpgUrls, [])
            : base['manualEpgUrls']
    );
    const disabledEpgUrls = getStringArrayValue(
        row.disabledEpgUrls
            ? parseJsonValue<unknown[]>(row.disabledEpgUrls, [])
            : base['disabledEpgUrls']
    );
    const importDate =
        row.importDate ?? row.dateCreated ?? new Date().toISOString();
    const portalUrl =
        row.portalUrl ?? (row.type === PLAYLIST_TYPES.STALKER ? row.url : null);
    const updateDate =
        row.updateDate ??
        (row.lastUpdated ? new Date(row.lastUpdated).getTime() : undefined);

    return {
        ...base,
        _id: row.id,
        title:
            getStringValue(base['title']) ??
            getStringValue(base['name']) ??
            row.name,
        count: row.count ?? getNumericValue(base['count']) ?? 0,
        importDate: getStringValue(base['importDate']) ?? importDate,
        lastUsage:
            row.lastUsage ??
            getStringValue(base['lastUsage']) ??
            getStringValue(base['importDate']) ??
            importDate,
        favorites,
        recentlyViewed,
        autoRefresh: row.autoRefresh ?? Boolean(base['autoRefresh']),
        url:
            row.type === PLAYLIST_TYPES.M3U_URL
                ? (row.url ?? getStringValue(base['url']))
                : getStringValue(base['url']),
        filePath: row.filePath ?? getStringValue(base['filePath']),
        epgUrls,
        detectedEpgUrls,
        manualEpgUrls,
        disabledEpgUrls,
        userAgent: row.userAgent ?? getStringValue(base['userAgent']),
        referrer: row.referrer ?? getStringValue(base['referrer']),
        origin: row.origin ?? getStringValue(base['origin']),
        updateDate,
        position: row.position ?? getNumericValue(base['position']),
        serverUrl: row.serverUrl ?? getStringValue(base['serverUrl']),
        username: row.username ?? getStringValue(base['username']),
        password: row.password ?? getStringValue(base['password']),
        macAddress: row.macAddress ?? getStringValue(base['macAddress']),
        portalUrl: portalUrl ?? getStringValue(base['portalUrl']),
    };
}
