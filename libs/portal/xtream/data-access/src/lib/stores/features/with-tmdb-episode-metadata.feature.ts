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
            // The latest tracked lookup per key: only it may settle the key,
            // so a superseded one (the same series reopened) cannot clear a
            // newer lookup's pending state.
            const latest = new Map<string, number>();
            let nextToken = 0;
            const mark = (key: string, status: TmdbEpisodeMetadataStatus) =>
                patchState(store, {
                    tmdbEpisodeMetadata: {
                        ...store.tmdbEpisodeMetadata(),
                        [key]: status,
                    },
                });
            return {
                /**
                 * Marks `key` pending until `work` settles, either way. With
                 * `keepSettled`, a key that already settled stays settled:
                 * season enrichment re-runs on every selection write and only
                 * re-reads the cache, which must not turn rendered rows back
                 * into skeletons.
                 */
                trackTmdbEpisodeMetadata(
                    key: string,
                    work: Promise<void>,
                    options: { keepSettled?: boolean } = {}
                ): Promise<void> {
                    const token = ++nextToken;
                    latest.set(key, token);
                    if (
                        !options.keepSettled ||
                        store.tmdbEpisodeMetadata()[key] !== 'settled'
                    ) {
                        mark(key, 'pending');
                    }
                    return work.finally(() => {
                        if (latest.get(key) === token) {
                            latest.delete(key);
                            mark(key, 'settled');
                        }
                    });
                },

                /**
                 * Forgets a series' season statuses: a new visit loads fresh
                 * provider data that its seasons must be enriched again.
                 */
                resetTmdbSeasonMetadata(seriesId: string | number): void {
                    const prefix = tmdbSeasonMetadataKey(seriesId, '');
                    // A lookup of the previous visit still in flight must not
                    // settle the new visit's season.
                    for (const key of [...latest.keys()]) {
                        if (key.startsWith(prefix)) {
                            latest.delete(key);
                        }
                    }
                    const status = store.tmdbEpisodeMetadata();
                    if (
                        !Object.keys(status).some((key) =>
                            key.startsWith(prefix)
                        )
                    ) {
                        return;
                    }
                    const kept: Record<string, TmdbEpisodeMetadataStatus> = {};
                    for (const [key, value] of Object.entries(status)) {
                        if (!key.startsWith(prefix)) {
                            kept[key] = value;
                        }
                    }
                    patchState(store, { tmdbEpisodeMetadata: kept });
                },
            };
        })
    );
}
