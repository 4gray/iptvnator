import type { RecentlyViewedItem } from './with-recent-items';
import {
    type ContentMetadataPatch,
    normalizeContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import type {
    IXtreamDataSource,
    XtreamPlayedContent,
} from './data-sources/xtream-data-source.interface';

/** History writes run after playback confirmation, outside the startup bundle. */
export async function recordXtreamRecent(
    dataSource: IXtreamDataSource,
    sqlite: boolean,
    item: {
        playlistId: string;
        xtreamId: number | string;
        contentType: 'live' | 'movie' | 'series';
        backdropUrl?: string;
        playedContent?: XtreamPlayedContent;
    },
    current: () => boolean
) {
    const { playlistId, contentType, backdropUrl, playedContent } = item;
    const xtreamId = Number(item.xtreamId);
    if (!Number.isFinite(xtreamId) || xtreamId <= 0) return;
    const identity = playedContent
        ? normalizeContentMetadataPatch({
              tmdbId: playedContent.tmdbId ?? undefined,
              releaseYear: playedContent.releaseYear ?? undefined,
          })
        : null;
    const content = await dataSource.getContentByXtreamId(
        xtreamId,
        playlistId,
        contentType,
        ...(sqlite && identity ? [identity] : [])
    );
    const contentId =
        content?.id ??
        (!sqlite || (await dataSource.supportsPortableHistory?.(playlistId))
            ? xtreamId
            : null);
    if (!current() || contentId == null) return;
    await dataSource.addRecentItem(
        { id: contentId, type: contentType, providerId: xtreamId },
        playlistId,
        backdropUrl,
        ...(playedContent ? ([playedContent] as const) : [])
    );
    const rows = await loadXtreamRecent(dataSource, playlistId);
    return current() ? rows : undefined;
}

export async function backfillXtreamRecentMetadata(
    dataSource: IXtreamDataSource,
    sqlite: boolean,
    {
        playlistId,
        xtreamId,
        contentType,
        patch,
    }: {
        playlistId: string;
        xtreamId: number | string;
        contentType: 'live' | 'movie' | 'series';
        patch: ContentMetadataPatch;
    },
    current: () => boolean
): Promise<void> {
    const normalizedXtreamId = Number(xtreamId);
    const normalized = normalizeContentMetadataPatch(patch);
    if (
        !Number.isFinite(normalizedXtreamId) ||
        normalizedXtreamId <= 0 ||
        !normalized
    ) {
        return;
    }

    const content = await dataSource.getContentByXtreamId(
        normalizedXtreamId,
        playlistId,
        contentType,
        ...(sqlite &&
        (normalized.tmdbId != null || normalized.releaseYear != null)
            ? [normalized]
            : [])
    );
    const contentId = content?.id ?? (!sqlite ? normalizedXtreamId : null);
    if (!current() || contentId == null) return;

    await dataSource.setContentMetadataIfMissing(
        { id: contentId, type: contentType },
        playlistId,
        normalized
    );
}

function mapDbRecentItem(
    item: {
        id: number | null;
        title: string;
        type: string;
        poster_url: string;
        backdrop_url?: string | null;
        viewed_at?: string;
        xtream_id: number;
        category_id: number | string;
    },
    playlistId: string
): RecentlyViewedItem {
    return {
        id: item.id ?? `recent:${item.type}:${item.xtream_id}`,
        title: item.title,
        type: item.type as 'live' | 'movie' | 'series',
        poster_url: item.poster_url,
        backdrop_url: item.backdrop_url ?? undefined,
        content_id: item.id,
        playlist_id: playlistId,
        viewed_at: item.viewed_at || '',
        xtream_id: item.xtream_id,
        category_id: item.category_id,
    };
}

export async function loadXtreamRecent(
    dataSource: IXtreamDataSource,
    playlistId: string
) {
    return (await dataSource.getRecentItems(playlistId)).map((row) =>
        mapDbRecentItem(row, playlistId)
    );
}

export async function removeXtreamRecent(
    dataSource: IXtreamDataSource,
    {
        itemId,
        playlistId,
        contentType,
    }: {
        itemId: number;
        playlistId: string;
        contentType?: 'live' | 'movie' | 'series';
    }
) {
    await dataSource.removeRecentItem(
        contentType ? { id: itemId, type: contentType } : itemId,
        playlistId
    );
    return loadXtreamRecent(dataSource, playlistId);
}
