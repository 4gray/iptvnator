import { createRandomId } from '@iptvnator/shared/interfaces';
import {
    applyFavoriteOperation,
    assertFavoriteState,
    emptyFavoriteState,
    favoriteAddressKey,
    parseFavoriteAddress,
    parseFavoriteOperation,
    type FavoriteAddress,
    type FavoriteList,
    type FavoriteResult,
    type FavoriteSourceContext,
    type FavoriteState,
} from '@iptvnator/shared/interfaces/favorites-sync';
import type {
    Media,
    SharedFavoriteEntry,
    Source,
    UserData,
} from '@iptvnator/tv/util';
import {
    FavoriteM3uCatalogs,
    mediaFavoriteSnapshot,
    resolveFavoriteMedia,
    resolveM3uFavoriteMedia,
} from './favorites-refs';
import { activeFavoriteEntries } from './favorites-projection';
import { FavoritesError } from './favorites-error';
import type { ProviderTransport } from './transport';

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
    deviceId: string,
    importing = false
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
    const base = current ? latestBase(current) : emptyFavoriteState();
    const pending = (current?.record.pending ?? []).filter(
        (intent) => intent.consentGeneration === consent
    );
    const state = projectPending(base, pending);
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
            base,
            state: {
                revision: state.revision + 1,
                member,
                ...(operation.snapshot ? { snapshot: operation.snapshot } : {}),
            },
            pending: [
                ...pending,
                { address, consentGeneration: consent, operation },
            ],
            conflict: undefined,
            local: undefined,
            localOnly: false,
        },
        media: item,
        importOperations: importing
            ? [...(current?.importOperations ?? []), operation.operationId]
            : current?.importOperations,
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
    return activeFavoriteEntries(data)
        .filter(
            ([, entry]) =>
                !entry.record.conflict &&
                entry.record.pending[0]?.consentGeneration ===
                    data.favoritesConsent
        )
        .map(([key, entry]) => ({ key, entry }));
}

/** Commits one receipt and pauses divergent edits for an explicit choice. */
export function commitFavoriteResult(
    data: UserData,
    key: string,
    operationId: string,
    result: FavoriteResult
): UserData {
    const entry = data.sharedFavorites[key];
    const head = entry?.record.pending[0];
    if (
        !entry ||
        head?.operation.operationId !== operationId ||
        head.consentGeneration !== data.favoritesConsent
    )
        return data;
    const base =
        result.state.revision >= latestBase(entry).revision
            ? result.state
            : latestBase(entry);
    const conflict =
        result.status === 'conflict' &&
        !entry.importOperations?.includes(operationId) &&
        entry.record.state.member !== base.member;
    const pending = entry.record.pending.slice(1);
    const applied: SharedFavoriteEntry = {
        ...entry,
        importOperations: entry.importOperations?.filter(
            (id) => id !== operationId
        ),
        record: {
            ...entry.record,
            base,
            pending,
            state: conflict
                ? entry.record.state
                : projectPending(base, pending),
            conflict: conflict ? base : undefined,
        },
    };
    return {
        ...data,
        sharedFavorites: { ...data.sharedFavorites, [key]: applied },
    };
}

function projectPending(
    base: FavoriteState,
    pending: SharedFavoriteEntry['record']['pending']
): FavoriteState {
    return pending.reduce(
        (state, { operation }) =>
            applyFavoriteOperation(state, {
                ...operation,
                expectedRevision: state.revision,
            }).state,
        base
    );
}

/**
 * Async phase of a refresh: resolves a TV item for every member entry that a
 * sync merge may create or update. Runs outside the persistence update.
 */
export async function resolveFavoriteEntries(
    source: Source,
    entries: FavoriteList['entries'],
    transport?: ProviderTransport,
    signal = new AbortController().signal,
    catalogs = new FavoriteM3uCatalogs(),
    refresh = false
): Promise<Map<string, Media>> {
    const media = new Map<string, Media>();
    const m3uIndex =
        source.provider === 'm3u' && entries.length
            ? await catalogs.index(source, transport, signal, refresh)
            : undefined;
    for (const entry of entries) {
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
    media: Map<string, Media> | undefined,
    localMatches = new Map<string, Media>()
): UserData {
    if (
        source.libraryId !== context.sourceId ||
        source.provider !== context.provider
    )
        throw new FavoritesError('Shared favorite source mismatch.');
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
            media: entry.state.snapshot?.identityConflict
                ? undefined
                : media
                  ? (media.get(key) ??
                    (!entry.state.member ? localMatches.get(key) : undefined) ??
                    (current?.record.pending.length
                        ? current.media
                        : undefined))
                  : (current?.media ??
                    (!entry.state.member ? localMatches.get(key) : undefined)),
            importOperations: current?.importOperations,
            record:
                current?.record.conflict || current?.record.pending.length
                    ? {
                          ...current.record,
                          base,
                          state: current.record.conflict
                              ? current.record.state
                              : projectPending(base, current.record.pending),
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
    return discardFavoriteIntents({
        ...data,
        sharedFavorites,
        sharedFavoriteContexts: {
            ...data.sharedFavoriteContexts,
            [context.sourceId]: context,
        },
    });
}

/** Preserve unsent manual changes locally without granting future delivery. */
export function restoreLocalFavoriteEdits(data: UserData): UserData {
    const favorites = new Map(data.favorites.map((item) => [item.id, item]));
    for (const [, entry] of activeFavoriteEntries(data)) {
        const intent = entry.record.pending
            .filter(
                ({ consentGeneration, operation }) =>
                    consentGeneration === data.favoritesConsent &&
                    !entry.importOperations?.includes(operation.operationId)
            )
            .pop();
        if ((!intent && !entry.record.conflict) || !entry.media) continue;
        if (intent ? intent.operation.member : entry.record.state.member)
            favorites.set(entry.media.id, entry.media);
        else favorites.delete(entry.media.id);
    }
    return { ...data, favorites: [...favorites.values()] };
}

export function resolveFavoriteConflict(
    data: UserData,
    key: string,
    keepLocal: boolean
): UserData {
    const entry = data.sharedFavorites[key];
    if (
        !entry?.record.conflict ||
        !activeFavoriteEntries(data).some(([active]) => active === key)
    )
        return data;
    const base = latestBase(entry);
    const media = entry.media;
    const cleared = {
        ...data,
        sharedFavorites: {
            ...data.sharedFavorites,
            [key]: { ...entry, record: { base, state: base, pending: [] } },
        },
    };
    const context = data.sharedFavoriteContexts[entry.address.sourceId];
    const source = data.sources.find(
        (candidate) => candidate.libraryId === context?.sourceId
    );
    if (
        !keepLocal ||
        !media ||
        !context ||
        !source ||
        base.member === entry.record.state.member
    )
        return cleared;
    return queueFavorite(
        cleared,
        source,
        media,
        entry.record.state.member,
        context,
        entry.address.content,
        data.favoritesConsent,
        data.favoritesDeviceId
    ).data;
}

export function discardFavoriteIntents(data: UserData): UserData {
    const sharedFavorites = { ...data.sharedFavorites };
    for (const [key, entry] of Object.entries(sharedFavorites)) {
        const pending = entry.record.pending;
        const live = pending.filter(
            (intent) => intent.consentGeneration === data.favoritesConsent
        );
        if (
            live.length === pending.length &&
            !(entry.record.conflict && !data.favoritesConsent)
        )
            continue;
        const base = latestBase(entry);
        sharedFavorites[key] = {
            ...entry,
            importOperations: entry.importOperations?.filter((id) =>
                live.some(({ operation }) => operation.operationId === id)
            ),
            record: {
                ...entry.record,
                base,
                state: projectPending(base, live),
                pending: live,
                conflict: undefined,
            },
        };
    }
    return { ...data, sharedFavorites };
}

export type { FavoriteSourceContext };
