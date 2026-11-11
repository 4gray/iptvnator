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

/** Native collection reads may resolve a stream to its hidden category copy. */
async function resolveVisibleXtreamFavoriteCopies(
    favorites: ReadonlyMap<number, number>,
    rows: readonly XtreamLiveChannelItem[],
    isFavorite: (ref: TypedXtreamCollectionRef) => Promise<boolean>,
    signal: AbortSignal
): Promise<ReadonlyMap<number, number>> {
    if (!favorites.size) return favorites;
    const visibleIds = new Set(rows.map((row) => Number(row.id)));
    let resolved: Map<number, number> | undefined;
    for (const row of rows) {
        if (signal.aborted) return favorites;
        const savedId = (resolved ?? favorites).get(row.xtream_id);
        if (savedId === undefined || visibleIds.has(savedId)) continue;
        const id = Number(row.id);
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
        ) {
            resolved ??= new Map(favorites);
            resolved.set(row.xtream_id, id);
        }
    }
    return resolved ?? favorites;
}

async function loadXtreamGuideFavorites(
    service: FavoritesService,
    playlistId: string,
    visible: readonly XtreamLiveChannelItem[],
    sqlite: boolean,
    signal: AbortSignal
): Promise<ReadonlyMap<number, number>> {
    const items = await firstValueFrom(service.getFavorites(playlistId));
    const favorites = xtreamGuideFavoriteRows(items, sqlite);
    return sqlite
        ? resolveVisibleXtreamFavoriteCopies(
              favorites,
              visible,
              (id) => service.isFavorite(id, playlistId),
              signal
          )
        : favorites;
}

export function injectXtreamGuideFavorites(
    session: Signal<AbortController | null>,
    playlistId: () => string | undefined,
    rows: Signal<readonly XtreamLiveChannelItem[]>,
    sqlite: () => boolean
) {
    const service = inject(FavoritesService);
    const favorites = signal<ReadonlyMap<number, number>>(new Map());
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
