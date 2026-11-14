import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    assertFavoriteState,
    emptyFavoriteState,
    favoriteAddressKey,
    favoriteReferenceKey,
    parseFavoriteAddress,
    parseFavoriteOperation,
    type FavoriteAddress,
    type FavoriteList,
    type FavoriteOperation,
    type FavoriteResult,
    type FavoriteSourceContext,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    Media,
    SharedFavoriteEntry,
    Source,
    UserData,
} from '@iptvnator/tv/util';
import {
    m3uFavoriteIndex,
    mediaFavoriteSnapshot,
    resolveFavoriteMedia,
    resolveM3uFavoriteMedia,
} from './favorites-refs';
import { backendUrl } from './backend';

export class FavoritesError extends Error {}

/** `/v1/favorites` client; transport errors stay retryable, record writes stay local. */
export class ServerFavorites {
    readonly url: string;
    constructor(
        url: string,
        private token: string,
        private instanceId: string
    ) {
        this.url = backendUrl(url);
    }
    private async request(
        path: string,
        signal: AbortSignal,
        init: RequestInit = {}
    ) {
        const response = await fetch(`${this.url}/v1${path}`, {
            ...init,
            signal,
            cache: 'no-store',
            redirect: 'error',
            headers: {
                ...(this.token
                    ? { Authorization: `Bearer ${this.token}` }
                    : {}),
                'x-iptvnator-instance-id': this.instanceId,
                ...init.headers,
            },
        });
        if (!response.ok)
            throw new FavoritesError(
                response.status === 401
                    ? 'Server access denied. Check the library access token.'
                    : 'The shared favorites request failed.'
            );
        return response.json();
    }
    async context(sourceId: string, signal: AbortSignal) {
        const context = (await this.request(
            `/favorites/sources/${encodeURIComponent(sourceId)}`,
            signal
        )) as FavoriteSourceContext;
        if (
            context.sourceId !== sourceId ||
            !context.sourceIncarnation ||
            !['m3u', 'xtream', 'stalker'].includes(context.provider)
        )
            throw new FavoritesError('Invalid shared favorite source.');
        return context;
    }
    async list(sourceId: string, signal: AbortSignal, cursor?: string) {
        const page = (await this.request(
            `/favorites/sources/${encodeURIComponent(sourceId)}/items${
                cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
            }`,
            signal
        )) as FavoriteList;
        if (!Array.isArray(page.entries))
            throw new FavoritesError('Invalid shared favorite list.');
        return page;
    }
    async apply(
        address: FavoriteAddress,
        operation: FavoriteOperation,
        signal: AbortSignal
    ) {
        const result = (await this.request(`/favorites/operations`, signal, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, operation }),
        })) as FavoriteResult;
        assertFavoriteState(result.state);
        if (!['applied', 'conflict'].includes(result.status))
            throw new FavoritesError('Invalid shared favorite receipt.');
        return result;
    }
}

const latestBase = (entry: SharedFavoriteEntry) =>
    entry.record.conflict &&
    entry.record.conflict.revision > entry.record.base.revision
        ? entry.record.conflict
        : entry.record.base;

/** Queues an optimistic member edit. Returns the pending intent for delivery. */
export function queueFavorite(
    data: UserData,
    source: Source,
    item: Media,
    member: boolean,
    context: FavoriteSourceContext,
    content: FavoriteAddress['content'],
    consent: string,
    deviceId: string
): { data: UserData; entry: SharedFavoriteEntry } {
    if (!data.library)
        throw new FavoritesError('The server library is not connected.');
    const address: FavoriteAddress = {
        instanceId: data.library.instanceId,
        scope: 'shared',
        sourceId: context.sourceId,
        sourceIncarnation: context.sourceIncarnation,
        content,
    };
    const key = favoriteAddressKey(address);
    const current = data.sharedFavorites[key];
    const state = current?.record.state ?? emptyFavoriteState();
    const operation = parseFavoriteOperation({
        operationId: createRandomId(),
        deviceId,
        expectedRevision: state.revision,
        member,
        snapshot: mediaFavoriteSnapshot(item, content),
    });
    const entry: SharedFavoriteEntry = {
        ...current,
        address,
        record: {
            ...current?.record,
            base: current?.record.base ?? emptyFavoriteState(),
            state: {
                revision: state.revision + 1,
                member,
                ...(operation.snapshot
                    ? { snapshot: operation.snapshot }
                    : {}),
            },
            pending: [
                ...(current?.record.pending ?? []),
                { address, consentGeneration: consent, operation },
            ],
            conflict: undefined,
            local: undefined,
            localOnly: false,
        },
        media: member ? item : current?.media,
        retries: 0,
    };
    return {
        data: {
            ...data,
            sharedFavorites: { ...data.sharedFavorites, [key]: entry },
        },
        entry,
    };
}

/** Deliverable head intents for the current consent generation. */
export function pendingFavorites(data: UserData): {
    key: string;
    entry: SharedFavoriteEntry;
}[] {
    return Object.entries(data.sharedFavorites)
        .filter(
            ([, entry]) =>
                entry.record.pending[0]?.consentGeneration ===
                    data.favoritesConsent &&
                entry.address.sourceIncarnation ===
                    data.sharedFavoriteContexts[entry.address.sourceId]
                        ?.sourceIncarnation
        )
        .map(([key, entry]) => ({ key, entry }));
}

/** Commits one apply receipt; conflicts rebase the intent twice before the server wins. */
export function commitFavoriteResult(
    data: UserData,
    key: string,
    operationId: string,
    result: FavoriteResult
): { data: UserData; delivered: boolean; rebased: boolean } {
    const entry = data.sharedFavorites[key];
    const head = entry?.record.pending[0];
    if (
        !entry ||
        head?.operation.operationId !== operationId ||
        head.consentGeneration !== data.favoritesConsent
    )
        return { data, delivered: false, rebased: false };
    const base =
        result.state.revision >= latestBase(entry).revision
            ? result.state
            : latestBase(entry);
    if (result.status === 'conflict') {
        const retries = entry.retries ?? 0;
        if (head.operation.member !== result.state.member && retries < 2) {
            const rebased: SharedFavoriteEntry = {
                ...entry,
                retries: retries + 1,
                record: {
                    ...entry.record,
                    base,
                    conflict: base,
                    pending: [
                        {
                            ...head,
                            operation: {
                                ...head.operation,
                                expectedRevision: base.revision,
                            },
                        },
                        ...entry.record.pending.slice(1),
                    ],
                },
            };
            return {
                data: {
                    ...data,
                    sharedFavorites: {
                        ...data.sharedFavorites,
                        [key]: rebased,
                    },
                },
                delivered: false,
                rebased: true,
            };
        }
        const adopted: SharedFavoriteEntry = {
            ...entry,
            retries: 0,
            record: {
                ...entry.record,
                base,
                state: base,
                pending: [],
                conflict: undefined,
            },
        };
        return {
            data: {
                ...data,
                sharedFavorites: { ...data.sharedFavorites, [key]: adopted },
            },
            delivered: true,
            rebased: false,
        };
    }
    const pending = entry.record.pending.slice(1);
    const applied: SharedFavoriteEntry = {
        ...entry,
        retries: 0,
        record: {
            ...entry.record,
            base,
            pending,
            state: pending.length ? entry.record.state : base,
            conflict: undefined,
        },
    };
    return {
        data: {
            ...data,
            sharedFavorites: { ...data.sharedFavorites, [key]: applied },
        },
        delivered: true,
        rebased: false,
    };
}

/**
 * Async phase of a refresh: resolves a TV item for every member entry that a
 * sync merge may create or update. Runs outside the persistence update.
 */
export async function resolveFavoriteEntries(
    source: Source,
    entries: FavoriteList['entries']
): Promise<Map<string, Media>> {
    const media = new Map<string, Media>();
    const m3uIndex =
        source.provider === 'm3u'
            ? await m3uFavoriteIndex(source.m3uItems ?? [])
            : undefined;
    for (const entry of entries) {
        if (!entry.state.member) continue;
        try {
            const address = parseFavoriteAddress(entry.address);
            const item =
                resolveFavoriteMedia(source, address, entry.state.snapshot) ??
                (m3uIndex
                    ? resolveM3uFavoriteMedia(source, address, m3uIndex)
                    : null);
            if (item) media.set(favoriteAddressKey(address), item);
        } catch {
            /* Rows outside the contract are rejected by the merge. */
        }
    }
    return media;
}

/** Merges one source's server page state; must run inside `update()`. */
export function mergeFavoriteSource(
    data: UserData,
    source: Source,
    context: FavoriteSourceContext,
    entries: FavoriteList['entries'],
    media: Map<string, Media>
): UserData {
    const sharedFavorites = { ...data.sharedFavorites };
    for (const entry of entries) {
        const address = parseFavoriteAddress(entry.address);
        assertFavoriteState(entry.state);
        if (
            address.instanceId !== data.library?.instanceId ||
            address.sourceId !== context.sourceId ||
            address.sourceIncarnation !== context.sourceIncarnation ||
            address.content.provider !== context.provider
        )
            throw new FavoritesError('Shared favorite scope mismatch.');
        const key = favoriteAddressKey(address);
        const current = sharedFavorites[key];
        if (current && latestBase(current).revision > entry.state.revision)
            continue;
        const base = entry.state;
        sharedFavorites[key] = {
            address,
            media: media.get(key) ?? current?.media,
            retries: current?.retries ?? 0,
            record: current?.record.pending.length
                ? {
                      ...current.record,
                      base,
                      ...(current.record.conflict
                          ? { conflict: base }
                          : {}),
                  }
                : {
                      ...current?.record,
                      state: base,
                      base,
                      pending: [],
                      conflict: undefined,
                  },
        };
    }
    // Intents from another consent generation can never be delivered;
    // revert their rows to the verified state so they cannot wedge the
    // queue or display phantom shared favorites.
    for (const [key, entry] of Object.entries(sharedFavorites)) {
        const pending = entry.record.pending;
        if (!pending.length) continue;
        const live = pending.filter(
            (intent) => intent.consentGeneration === data.favoritesConsent
        );
        if (live.length === pending.length) continue;
        const base = latestBase(entry);
        sharedFavorites[key] = {
            ...entry,
            record: {
                ...entry.record,
                base,
                state: live.length ? entry.record.state : base,
                pending: live,
                conflict: live.length ? entry.record.conflict : undefined,
            },
        };
    }
    return { ...data, sharedFavorites };
}

/** Server member references, for import deduplication. */
export function serverMemberKeys(entries: FavoriteList['entries']): Set<string> {
    const keys = new Set<string>();
    for (const entry of entries) {
        if (!entry.state.member) continue;
        try {
            keys.add(
                favoriteReferenceKey(
                    parseFavoriteAddress(entry.address).content
                )
            );
        } catch {
            /* Foreign rows are ignored by the merge anyway. */
        }
    }
    return keys;
}

export type { FavoriteSourceContext };
