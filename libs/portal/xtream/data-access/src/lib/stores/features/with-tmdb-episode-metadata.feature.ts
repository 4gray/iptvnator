import {
    patchState,
    signalStoreFeature,
    withMethods,
    withState,
} from '@ngrx/signals';

export type TmdbEpisodeMetadataStatus = 'pending' | 'settled';

/**
 * Progress of the TMDB lookups that can still change a series page's
 * episode rows: the show-level match (`show:<seriesId>`) and each season's
 * episode enrichment (`season:<seriesId>:<seasonKey>`). The detail view
 * keeps a season's rows as skeletons while a lookup that could upgrade them
 * is outstanding, instead of rendering bare rows that would grow later.
 */
export interface TmdbEpisodeMetadataState {
    tmdbEpisodeMetadata: Readonly<Record<string, TmdbEpisodeMetadataStatus>>;
}

export const tmdbShowMetadataKey = (seriesId: string | number): string =>
    `show:${seriesId}`;

export const tmdbSeasonMetadataKey = (
    seriesId: string | number,
    seasonKey: string
): string => `season:${seriesId}:${seasonKey}`;

export function withTmdbEpisodeMetadata() {
    return signalStoreFeature(
        withState<TmdbEpisodeMetadataState>({ tmdbEpisodeMetadata: {} }),
        withMethods((store) => {
            const mark = (key: string, status: TmdbEpisodeMetadataStatus) =>
                patchState(store, {
                    tmdbEpisodeMetadata: {
                        ...store.tmdbEpisodeMetadata(),
                        [key]: status,
                    },
                });
            return {
                /** Marks `key` pending until `work` settles, either way. */
                trackTmdbEpisodeMetadata(
                    key: string,
                    work: Promise<void>
                ): Promise<void> {
                    mark(key, 'pending');
                    return work.finally(() => mark(key, 'settled'));
                },
            };
        })
    );
}
