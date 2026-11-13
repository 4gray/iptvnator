import { inject, type Provider } from '@angular/core';
import { MULTIVIEW_CHANNEL_MAPPER } from '@iptvnator/playback/multiview/data-access';
import type { UnifiedCollectionItem } from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import type { XtreamChannelListItem } from './portal-channels-list.component';

/**
 * An Xtream live row as the collection item multiview resolves (R5). The
 * category is the provider's id, as the parental lock keys it; a stored row
 * carries the database id, which the live categories translate.
 */
export function xtreamMultiviewChannelItem(
    playlist: { readonly id: string; readonly name?: string } | null,
    categories: readonly {
        readonly id?: unknown;
        readonly xtream_id?: unknown;
    }[],
    row: XtreamChannelListItem | null
): UnifiedCollectionItem | null {
    if (!playlist?.id || !row || !Number.isFinite(Number(row.xtream_id))) {
        return null;
    }
    if (row.type && row.type !== 'live') return null;
    const category = categories.find(
        (candidate) => Number(candidate.id) === Number(row.category_id)
    );
    return {
        uid: `xtream::${playlist.id}::live:${row.xtream_id}`,
        name: row.title || row.name || '',
        logo: row.stream_icon || row.poster_url || null,
        sourceType: 'xtream',
        contentType: 'live',
        playlistId: playlist.id,
        playlistName: playlist.name ?? '',
        xtreamId: Number(row.xtream_id),
        categoryId: (category?.xtream_id ?? row.category_id) as
            string | number | undefined,
        tvArchive: row.tv_archive ?? null,
    };
}

/** Multiview badges, Alt+click and drag for the Xtream live list. */
export function provideXtreamMultiviewChannels(): Provider {
    return {
        provide: MULTIVIEW_CHANNEL_MAPPER,
        useFactory: () => {
            const store = inject(XtreamStore);
            return (row: unknown) =>
                xtreamMultiviewChannelItem(
                    store.currentPlaylist() ?? null,
                    (store.liveCategories?.() ?? []) as readonly {
                        id?: unknown;
                        xtream_id?: unknown;
                    }[],
                    row as XtreamChannelListItem | null
                );
        },
    };
}
