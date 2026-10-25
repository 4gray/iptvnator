import { sourceIdentity, type Playlist } from '@iptvnator/shared/interfaces';
import {
    httpUrl,
    rows,
    type Source,
    type UserData,
    type LibrarySettings,
} from '@iptvnator/tv/util';

const identityFields = {
    serialNumber: 'stalkerSerialNumber',
    deviceId1: 'stalkerDeviceId1',
    deviceId2: 'stalkerDeviceId2',
    signature1: 'stalkerSignature1',
    signature2: 'stalkerSignature2',
} as const;

/** Map source configuration only; provider sessions belong to this device. */
export function librarySource(document: Playlist, instanceId: string): Source {
    if (
        !document ||
        typeof document._id !== 'string' ||
        !document._id ||
        typeof document.title !== 'string'
    )
        throw new Error('Invalid server source.');
    const source: Source = {
        id: JSON.stringify(['library', instanceId, document._id]),
        libraryId: document._id,
        name: document.title,
        provider: document.serverUrl
            ? 'xtream'
            : document.macAddress
              ? 'stalker'
              : 'm3u',
        url: '',
    };
    const url = document.serverUrl || document.portalUrl || document.url;
    if (url) source.url = httpUrl(url);
    if (source.provider === 'm3u' && !url) {
        const payload = document.playlist as { items?: unknown } | undefined;
        const items = payload?.items ?? document.items;
        if (!Array.isArray(items))
            throw new Error('Server playlist has no channels.');
        source.m3uItems = rows(items);
    } else if (!url) throw new Error('Server source has no address.');
    for (const field of [
        'username',
        'password',
        'macAddress',
        'userAgent',
        'referrer',
        'origin',
    ] as const) {
        if (document[field] !== undefined) {
            if (typeof document[field] !== 'string')
                throw new Error('Invalid server source field.');
            source[field] = document[field];
        }
    }
    if (source.provider === 'stalker') {
        for (const field of Object.keys(
            identityFields
        ) as (keyof typeof identityFields)[]) {
            const value = document[identityFields[field]];
            if (value !== undefined && typeof value !== 'string')
                throw new Error('Invalid MAG identity.');
            source[field] = value;
        }
        // Keep explicit observed portal mode; never share another device's token.
        if (typeof document.isFullStalkerPortal === 'boolean') {
            source.full = document.isFullStalkerPortal;
            source.endpoint = source.url;
        }
    }
    return source;
}

export function sourceDocument(source: Source): Playlist {
    const document: Playlist = {
        _id: source.id,
        title: source.name,
        count: source.m3uItems?.length ?? 0,
        importDate: new Date().toISOString(),
        lastUsage: new Date().toISOString(),
        autoRefresh: false,
        userAgent: source.userAgent,
        referrer: source.referrer,
        origin: source.origin,
    };
    if (source.provider === 'xtream') {
        document.serverUrl = source.url;
        document.username = source.username;
        document.password = source.password;
    } else if (source.provider === 'stalker') {
        document.portalUrl = source.endpoint || source.url;
        document.macAddress = source.macAddress;
        document.username = source.username;
        document.password = source.password;
        document.isFullStalkerPortal = source.full;
        for (const field of Object.keys(
            identityFields
        ) as (keyof typeof identityFields)[])
            document[identityFields[field]] = source[field];
    } else {
        document.url = source.url || undefined;
        if (source.m3uItems) document.playlist = { items: source.m3uItems };
    }
    return document;
}

export function sameLibrarySource(a: Source, b: Source): boolean {
    const key = sourceIdentity(sourceDocument(a));
    return !!key && key === sourceIdentity(sourceDocument(b));
}

/** Preserve local media IDs and the original local config when linking accounts. */
export function mergeLibrary(
    data: UserData,
    settings: LibrarySettings,
    incoming: Source[]
): UserData {
    const originals = { ...settings.originals };
    let activeId = data.activeId;
    const available = data.sources.slice();
    const sources = incoming.map((remote) => {
        const existing =
            available.find((s) => s.libraryId === remote.libraryId) ??
            available.find((s) => !s.libraryId && sameLibrarySource(s, remote));
        if (!existing) return remote;
        const sameAccount =
            sameLibrarySource(existing, remote) ||
            (existing.provider === 'm3u' &&
                remote.provider === 'm3u' &&
                !existing.url &&
                !remote.url);
        if (existing.libraryId && !sameAccount) {
            // A library row can be repointed to another account. Keep old viewing
            // data under its old ID; never interpret it through the replacement.
            const next = {
                ...remote,
                id: `tv-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            };
            if (activeId === existing.id) activeId = next.id;
            // Leave the old entry available so a linked local original is restored below.
            return next;
        }
        available.splice(available.indexOf(existing), 1);
        if (!existing.libraryId) originals[existing.id] = existing;
        const next = { ...remote, id: existing.id };
        // Preserve this TV's negotiated session only while connection inputs match.
        const config = (s: Source) =>
            JSON.stringify([
                s.url,
                s.username,
                s.password,
                s.macAddress,
                s.serialNumber,
                s.deviceId1,
                s.deviceId2,
                s.signature1,
                s.signature2,
            ]);
        if (
            config(existing) === config(remote) &&
            (remote.full === undefined || existing.full === remote.full)
        ) {
            next.token = existing.token;
            next.endpoint = existing.endpoint ?? next.endpoint;
            next.full = existing.full ?? next.full;
        }
        if (
            existing.m3uItems &&
            JSON.stringify(existing.m3uItems) ===
                JSON.stringify(remote.m3uItems)
        )
            next.m3uItems = existing.m3uItems;
        return next;
    });
    for (const old of available) {
        if (!old.libraryId) sources.push(old);
        else if (originals[old.id]) {
            sources.push(originals[old.id]);
            delete originals[old.id];
        }
    }
    return {
        ...data,
        sources,
        library: { ...settings, originals, lastSync: Date.now() },
        activeId: sources.some((s) => s.id === activeId)
            ? activeId
            : (sources[0]?.id ?? ''),
    };
}

/** Disconnect keeps downloaded sources and viewing data; linked locals regain their config. */
export function disconnectLibrary(data: UserData): UserData {
    return {
        ...data,
        library: undefined,
        sources: data.sources.map((s) => {
            const original = data.library?.originals[s.id];
            if (original) return original;
            const { libraryId: _link, ...local } = s;
            return local;
        }),
    };
}
