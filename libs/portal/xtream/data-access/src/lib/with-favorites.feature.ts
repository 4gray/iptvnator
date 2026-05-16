import { inject } from '@angular/core';
import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';
import { createLogger } from '@iptvnator/portal/shared/util';
import { XTREAM_DATA_SOURCE } from './data-sources/xtream-data-source.interface';

function resolveContentId(content: Record<string, unknown>): number | null {
    const rawId =
        content['id'] ??
        content['stream_id'] ??
        content['series_id'] ??
        content['xtream_id'];
    const id = Number(rawId);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function findLoadedContent(
    store: unknown,
    xtreamId: number,
    contentType: 'live' | 'movie' | 'series'
): Record<string, unknown> | null {
    const storeWithContent = store as {
        liveStreams?: () => Record<string, unknown>[];
        vodStreams?: () => Record<string, unknown>[];
        serialStreams?: () => Record<string, unknown>[];
    };
    const items =
        contentType === 'live'
            ? storeWithContent.liveStreams?.()
            : contentType === 'movie'
              ? storeWithContent.vodStreams?.()
              : storeWithContent.serialStreams?.();

    return (
        items?.find((item) => {
            const itemId = resolveContentId(item);
            return itemId === xtreamId;
        }) ?? null
    );
}

export const withFavorites = function () {
    const logger = createLogger('withFavorites');
    return signalStoreFeature(
        withState({
            isFavorite: false,
        }),
        withMethods((store, dataSource = inject(XTREAM_DATA_SOURCE)) => ({
            async toggleFavorite(
                xtreamId: number | string,
                playlistId: string,
                contentType: 'live' | 'movie' | 'series',
                backdropUrl?: string
            ) {
                const numericXtreamId = Number(xtreamId);
                if (
                    !Number.isFinite(numericXtreamId) ||
                    numericXtreamId <= 0 ||
                    !playlistId
                ) {
                    return false;
                }

                const content =
                    (await dataSource.getContentByXtreamId(
                        numericXtreamId,
                        playlistId,
                        contentType
                    )) ??
                    findLoadedContent(store, numericXtreamId, contentType);
                if (!content) {
                    logger.error(
                        'Content not found for xtream ID',
                        numericXtreamId
                    );
                    return false;
                }
                const contentId = resolveContentId(
                    content as unknown as Record<string, unknown>
                );
                if (!contentId) {
                    logger.error('Content has no favorite id', content);
                    return false;
                }

                const currentStatus = store.isFavorite();

                if (currentStatus) {
                    // Remove from favorites
                    await dataSource.removeFavorite(contentId, playlistId);
                    patchState(store, { isFavorite: false });
                    return false;
                } else {
                    // Add to favorites
                    await dataSource.addFavorite(
                        contentId,
                        playlistId,
                        backdropUrl
                    );
                    patchState(store, { isFavorite: true });
                    return true;
                }
            },

            async checkFavoriteStatus(
                xtreamId: number | string,
                playlistId: string,
                contentType: 'live' | 'movie' | 'series'
            ) {
                const numericXtreamId = Number(xtreamId);
                if (
                    !Number.isFinite(numericXtreamId) ||
                    numericXtreamId <= 0 ||
                    !playlistId
                ) {
                    patchState(store, { isFavorite: false });
                    return;
                }

                const content =
                    (await dataSource.getContentByXtreamId(
                        numericXtreamId,
                        playlistId,
                        contentType
                    )) ??
                    findLoadedContent(store, numericXtreamId, contentType);
                if (!content) {
                    patchState(store, { isFavorite: false });
                    return;
                }
                const contentId = resolveContentId(
                    content as unknown as Record<string, unknown>
                );
                if (!contentId) {
                    patchState(store, { isFavorite: false });
                    return;
                }

                const isFavorite = await dataSource.isFavorite(
                    contentId,
                    playlistId
                );

                patchState(store, { isFavorite });
            },
        }))
    );
};
