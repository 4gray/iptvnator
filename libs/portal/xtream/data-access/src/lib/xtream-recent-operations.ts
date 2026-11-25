import type { RecentlyViewedItem } from './with-recent-items';
import {
    type ContentMetadataPatch,
    normalizeContentMetadataPatch,
} from '@iptvnator/shared/interfaces';
import type {
    IXtreamDataSource,
    XtreamPlayedContent,
} from './data-sources/xtream-data-source.interface';

interface RecentPlayback {
    playlistId: string;
    xtreamId: number | string;
    contentType: 'live' | 'movie' | 'series';
    backdropUrl?: string;
    playedContent?: XtreamPlayedContent;
}

/** History writes run after playback confirmation, outside the startup bundle. */
export async function saveXtreamRecent(
    dataSource: IXtreamDataSource,
    sqlite: boolean,
    item: RecentPlayback,
    current: () => boolean
): Promise<boolean> {
    const { playlistId, contentType, backdropUrl, playedContent } = item;
    const xtreamId = Number(item.xtreamId);
    if (!current() || !Number.isFinite(xtreamId) || xtreamId <= 0) return false;
    const identity = playedContent
        ? normalizeContentMetadataPatch({
              tmdbId: playedContent.tmdbId ?? undefined,
              releaseYear: playedContent.releaseYear ?? undefined,
          })
        : null;
    const lookup: Parameters<IXtreamDataSource['getContentByXtreamId']> = [
        xtreamId,
        playlistId,
        contentType,
    ];
    if (sqlite && identity) lookup[3] = identity;
    const categoryId = playedContent?.categoryId;
    if (sqlite && contentType === 'live' && typeof categoryId === 'number') {
        lookup[4] = categoryId;
        lookup[6] = true;
    }
    const content = await dataSource.getContentByXtreamId(...lookup);
    const contentId =
        content?.id ??
        (!sqlite || (await dataSource.supportsPortableHistory?.(playlistId))
            ? xtreamId
            : null);
    if (!current() || contentId == null) return false;
    await dataSource.addRecentItem(
        { id: contentId, type: contentType, providerId: xtreamId },
        playlistId,
        backdropUrl,
        ...(playedContent ? ([playedContent] as const) : [])
    );
    return true;
}

export async function recordXtreamRecent(
    dataSource: IXtreamDataSource,
    sqlite: boolean,
    item: RecentPlayback,
    current: () => boolean
) {
    if (!(await saveXtreamRecent(dataSource, sqlite, item, current))) return;
    const rows = await loadXtreamRecent(dataSource, item.playlistId);
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
