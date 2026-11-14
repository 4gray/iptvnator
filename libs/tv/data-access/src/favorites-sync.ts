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
    m3uFavoriteIndex,
    mediaFavoriteSnapshot,
    resolveFavoriteMedia,
    resolveM3uFavoriteMedia,
} from './favorites-refs';
import { activeFavoriteEntries } from './favorites-projection';
import { FavoritesError } from './server-favorites';
import { loadM3uItems } from './m3u';
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
        retries: current?.retries ?? 0,
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
                entry.record.pending[0]?.consentGeneration ===
                data.favoritesConsent
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
    const retry =
        result.status === 'conflict' &&
        head.operation.member !== base.member &&
        (entry.retries ?? 0) < 2;
    const pending = retry
        ? [
              {
                  ...head,
                  operation: {
                      ...head.operation,
                      operationId: createRandomId(),
                      expectedRevision: base.revision,
                  },
              },
              ...entry.record.pending.slice(1),
          ]
        : entry.record.pending.slice(1);
    const applied: SharedFavoriteEntry = {
        ...entry,
        retries: retry ? (entry.retries ?? 0) + 1 : 0,
        record: {
            ...entry.record,
            base,
            pending,
            state: projectPending(base, pending),
            conflict: retry ? base : undefined,
        },
    };
    return {
        data: {
            ...data,
            sharedFavorites: { ...data.sharedFavorites, [key]: applied },
        },
        delivered: !retry,
        rebased: retry,
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
    signal = new AbortController().signal
): Promise<Map<string, Media>> {
    const media = new Map<string, Media>();
    const m3uIndex =
        source.provider === 'm3u' && entries.length
            ? await m3uFavoriteIndex(
                  source.m3uItems ??
                      (transport
                          ? await loadM3uItems(source, transport, signal)
                          : []),
                  signal
              )
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
    media: Map<string, Media>
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
            media: media.get(key) ?? current?.media,
            retries: current?.retries ?? 0,
            record: current?.record.pending.length
                ? {
                      ...current.record,
                      base,
                      state: projectPending(base, current.record.pending),
                      ...(current.record.conflict ? { conflict: base } : {}),
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

export function discardFavoriteIntents(data: UserData): UserData {
    const sharedFavorites = { ...data.sharedFavorites };
    for (const [key, entry] of Object.entries(sharedFavorites)) {
        const pending = entry.record.pending;
        const live = pending.filter(
            (intent) => intent.consentGeneration === data.favoritesConsent
        );
        if (live.length === pending.length) continue;
        const base = latestBase(entry);
        sharedFavorites[key] = {
            ...entry,
            retries: 0,
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
