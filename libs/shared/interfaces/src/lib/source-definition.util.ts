import type { Playlist } from './playlist.interface';
import type { SourceDefinition } from './source-sync.interface';

export const SOURCE_CONNECTION_FIELDS = [
    'url',
    'serverUrl',
    'portalUrl',
    'username',
    'password',
    'macAddress',
    'userAgent',
    'referrer',
    'origin',
    'isFullStalkerPortal',
    'stalkerSerialNumber',
    'stalkerDeviceId1',
    'stalkerDeviceId2',
    'stalkerSignature1',
    'stalkerSignature2',
] as const;

export function sourceFromPlaylist(
    playlist: Playlist,
    payload = true
): SourceDefinition {
    const kind = playlist.macAddress
        ? 'stalker'
        : playlist.serverUrl
          ? 'xtream'
          : playlist.url
            ? 'm3u-url'
            : 'm3u-text';
    const source: SourceDefinition = {
        id: playlist._id,
        title: playlist.title,
        kind,
    };
    for (const key of SOURCE_CONNECTION_FIELDS) {
        if (playlist[key] !== undefined)
            Object.assign(source, { [key]: playlist[key] });
    }
    if (kind === 'stalker')
        source.portalUrl = playlist.portalUrl ?? playlist.url;
    if (kind === 'm3u-text' && payload) {
        source.rawM3u =
            playlist.sourceRawM3u ??
            [
                playlist.playlist?.header?.raw ?? '#EXTM3U',
                ...(playlist.playlist?.items ?? []).map(
                    (item: { raw: string }) => item.raw
                ),
            ].join('\n');
    }
    return source;
}

/** Replaces only definition fields; local activity and caches survive. */
export function applySourceDefinition(
    source: SourceDefinition,
    current?: Playlist
): Playlist {
    const next: Playlist = {
        importDate: new Date().toISOString(),
        lastUsage: new Date().toISOString(),
        count: 0,
        autoRefresh: false,
        favorites: [],
        recentlyViewed: [],
        ...current,
        _id: source.id,
        title: source.title,
    };
    for (const key of SOURCE_CONNECTION_FIELDS) {
        delete next[key];
        if (source[key] !== undefined)
            Object.assign(next, { [key]: source[key] });
    }
    delete next.filePath;
    if (source.kind === 'm3u-text')
        next.sourceRawM3u = source.rawM3u ?? current?.sourceRawM3u;
    else delete next.sourceRawM3u;
    return next;
}

export function sameSource(a: SourceDefinition, b: SourceDefinition): boolean {
    return (
        ['id', 'title', 'kind', 'rawM3u', ...SOURCE_CONNECTION_FIELDS] as const
    ).every((key) => a[key] === b[key]);
}

/** Accept only portable connection fields, never runtime/user-state fields. */
export function validateSource(value: unknown): SourceDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Invalid source');
    const input = value as Record<string, unknown>;
    const allowed = new Set([
        'id',
        'title',
        'kind',
        'rawM3u',
        ...SOURCE_CONNECTION_FIELDS,
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key)))
        throw new Error('Invalid source field');
    for (const [key, field] of Object.entries(input)) {
        if (
            key === 'isFullStalkerPortal'
                ? typeof field !== 'boolean'
                : typeof field !== 'string'
        ) {
            throw new Error('Invalid source field');
        }
    }
    const source = input as unknown as SourceDefinition;
    if (
        (source.kind !== 'xtream' && source.serverUrl !== undefined) ||
        (source.kind !== 'stalker' &&
            (source.macAddress !== undefined ||
                source.portalUrl !== undefined)) ||
        (source.kind !== 'm3u-text' && source.rawM3u !== undefined) ||
        (source.kind === 'm3u-text' && source.url !== undefined)
    ) {
        throw new Error('Invalid source kind fields');
    }
    if (
        !source.id?.trim() ||
        source.id !== source.id.trim() ||
        source.id.length > 200 ||
        !source.title?.trim() ||
        !['m3u-url', 'm3u-text', 'xtream', 'stalker'].includes(source.kind)
    ) {
        throw new Error('Invalid source');
    }
    const url =
        source.kind === 'xtream'
            ? source.serverUrl
            : source.kind === 'stalker'
              ? source.portalUrl
              : source.url;
    if (source.kind !== 'm3u-text') {
        const parsed = new URL(url ?? '');
        if (
            !['http:', 'https:'].includes(parsed.protocol) ||
            parsed.username ||
            parsed.password
        ) {
            throw new Error('Invalid source URL');
        }
    }
    if (
        source.kind === 'm3u-text' &&
        !source.rawM3u?.trim().startsWith('#EXTM3U')
    )
        throw new Error('Invalid M3U');
    if (source.kind === 'stalker' && !source.macAddress?.trim())
        throw new Error('Missing MAC');
    if (
        source.kind === 'xtream' &&
        (!source.username?.trim() || !source.password)
    )
        throw new Error('Missing credentials');
    return { ...source };
}

export function sourceFingerprint(source: SourceDefinition): string {
    const normalize = (url: string) => {
        const value = new URL(url);
        value.hash = '';
        return value.toString().replace(/\/$/, '');
    };
    switch (source.kind) {
        case 'xtream':
            return JSON.stringify([
                source.kind,
                normalize(source.serverUrl!),
                source.username,
            ]);
        case 'stalker':
            return JSON.stringify([
                source.kind,
                normalize(source.portalUrl!),
                source.macAddress?.toUpperCase(),
            ]);
        case 'm3u-url':
            return JSON.stringify([source.kind, normalize(source.url!)]);
        case 'm3u-text':
            return JSON.stringify([
                source.kind,
                source.rawM3u?.replace(/\r\n?/g, '\n').trim(),
            ]);
    }
}

export function normalizeSourceServerUrl(value: string, base?: string): string {
    const url = new URL(value, base);
    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
    ) {
        throw new Error('Invalid server URL');
    }
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/api') ? path : `${path}/api`;
    return url.toString().replace(/\/$/, '');
}
