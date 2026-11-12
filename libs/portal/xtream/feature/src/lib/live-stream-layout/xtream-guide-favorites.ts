import { isCatalogUnavailable } from '@iptvnator/shared/interfaces';
import { effect, inject, signal, untracked, type Signal } from '@angular/core';
import {
    type FavoriteItem,
    type TypedXtreamCollectionRef,
    FavoritesService,
} from '@iptvnator/portal/xtream/data-access';
import { firstValueFrom } from 'rxjs';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

function xtreamGuideFavoriteRows(
    items: readonly FavoriteItem[],
    sqlite: boolean
): ReadonlyMap<number, number> {
    const rows = new Map<number, number>();
    for (const item of items) {
        if (
            item.type === 'live' &&
            item.content_id != null &&
            !isCatalogUnavailable({ catalogStatus: item.catalog_status })
        ) {
            rows.set(
                item.xtream_id,
                sqlite ? item.content_id : item.category_id
            );
        }
    }
    return rows;
}

/** Collection reads may resolve a stream to a hidden or locked copy. */
async function resolveVisibleXtreamFavoriteCopies(
    favorites: ReadonlyMap<number, number>,
    rows: readonly XtreamLiveChannelItem[],
    sqlite: boolean,
    isFavorite: (ref: TypedXtreamCollectionRef) => Promise<boolean>,
    signal: AbortSignal
): Promise<ReadonlyMap<number, XtreamLiveChannelItem>> {
    const resolved = new Map<number, XtreamLiveChannelItem>();
    if (!favorites.size) return resolved;
    for (const row of rows) {
        const copy = Number(sqlite ? row.id : (row.category_id ?? 0));
        if (
            favorites.get(row.xtream_id) === copy &&
            !resolved.has(row.xtream_id)
        )
            resolved.set(row.xtream_id, row);
    }
    for (const row of rows) {
        if (signal.aborted) break;
        if (!favorites.has(row.xtream_id) || resolved.has(row.xtream_id))
            continue;
        const id = Number(row.id ?? (sqlite ? undefined : row.xtream_id));
        if (
            Number.isSafeInteger(id) &&
            (await isFavorite({
                id,
                providerId: row.xtream_id,
                type: 'live',
                identity: {
                    tmdbId: row.tmdb_id ?? undefined,
                    releaseYear: row.release_year ?? undefined,
                },
            }).catch(() => false))
        )
            resolved.set(row.xtream_id, row);
    }
    return resolved;
}

async function loadXtreamGuideFavorites(
    service: FavoritesService,
    playlistId: string,
    visible: readonly XtreamLiveChannelItem[],
    sqlite: boolean,
    signal: AbortSignal
): Promise<ReadonlyMap<number, XtreamLiveChannelItem>> {
    const items = await firstValueFrom(service.getFavorites(playlistId, false));
    const favorites = xtreamGuideFavoriteRows(items, sqlite);
    return resolveVisibleXtreamFavoriteCopies(
        favorites,
        visible,
        sqlite,
        (id) => service.isFavorite(id, playlistId),
        signal
    );
}

export function injectXtreamGuideFavorites(
    session: Signal<AbortController | null>,
    playlistId: () => string | undefined,
    rows: Signal<readonly XtreamLiveChannelItem[]>,
    sqlite: () => boolean
) {
    const service = inject(FavoritesService);
    const favorites = signal<ReadonlyMap<number, XtreamLiveChannelItem>>(
        new Map()
    );
    const revision = signal(0);
    effect((onCleanup) => {
        const owner = session();
        const id = playlistId();
        if (!owner || !id) return;
        const visible = rows();
        const requestedRevision = revision();
        const refresh = new AbortController();
        const { signal } = refresh;
        onCleanup(() => refresh.abort());
        owner.signal.addEventListener('abort', () => refresh.abort(), {
            once: true,
            signal,
        });
        window.addEventListener(
            'iptvnator-favorites-changed',
            () => revision.update((value) => value + 1),
            { signal }
        );
        untracked(() => {
            void loadXtreamGuideFavorites(
                service,
                id,
                visible,
                sqlite(),
                signal
            ).then(
                (items) => {
                    if (
                        !signal.aborted &&
                        visible === rows() &&
                        requestedRevision === revision()
                    )
                        favorites.set(items);
                },
                () => undefined
            );
        });
    });
    return favorites;
}
