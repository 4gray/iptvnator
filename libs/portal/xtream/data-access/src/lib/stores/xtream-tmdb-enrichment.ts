import {
    TmdbEnrichmentService,
    extractYear,
    loadTmdbMergers,
    mergeEpisodesWithTmdb,
    tmdbSeasonPosterUrl,
    type TmdbMatchIdentity,
} from '@iptvnator/services';
import {
    XtreamSerieDetails,
    XtreamVodDetails,
    getXtreamVodInfo,
    resolveEnrichmentSeasonNumber,
} from '@iptvnator/shared/interfaces';
import { preserveXtreamProviderIdentity } from '../xtream-content-metadata.util';

/**
 * Async TMDB enrichment of the currently selected Xtream detail item.
 *
 * The detail view renders provider data immediately; these helpers run
 * afterwards and patch the selection with a field-level merge once TMDB
 * responds. A staleness guard drops the result if the user has navigated
 * to a different item in the meantime. All failures are swallowed by the
 * enrichment service — provider data is never degraded.
 */

interface EnrichableSelectionStore<TItem> {
    selectedItem: () => TItem | null;
    setSelectedItem: (item: TItem | null) => void;
    currentPlaylist?: () => { id: string } | null;
    resetTmdbSeasonMetadata?: (seriesId: string | number) => void;
}

type SelectionRecord = { readonly [key: string]: unknown };

export async function enrichVodSelectionWithTmdb<TItem extends SelectionRecord>(
    store: EnrichableSelectionStore<TItem>,
    enrichment: TmdbEnrichmentService,
    vodId: string | number,
    isCurrentRequest: () => boolean = () => true
): Promise<void> {
    if (!enrichment.isEnabled()) {
        return;
    }

    const playlistId = store.currentPlaylist?.()?.id;
    const matchIdentity: TmdbMatchIdentity | undefined = playlistId
        ? {
              provider: 'xtream',
              playlistId,
              mediaType: 'movie',
              itemId: String(vodId),
          }
        : undefined;
    const matches = matchIdentity ? await enrichment.getMatches?.() : null;
    if (matchIdentity && !matches) return;
    const version = matchIdentity ? matches?.version(matchIdentity) : undefined;

    const isCurrent = (): TItem | null => {
        if (
            !isCurrentRequest() ||
            (matchIdentity &&
                (matches?.version(matchIdentity) !== version ||
                    store.currentPlaylist?.()?.id !== playlistId))
        ) {
            return null;
        }
        const item = store.selectedItem();
        return item && String(item['stream_id']) === String(vodId)
            ? item
            : null;
    };

    const selected = isCurrent();
    const info = getXtreamVodInfo(
        selected as unknown as XtreamVodDetails | null
    );
    if (!info) {
        return;
    }

    if (matchIdentity && matches)
        matches.register(store, matchIdentity, async () => {
            const current = store.selectedItem();
            if (
                !isCurrentRequest() ||
                store.currentPlaylist?.()?.id !== playlistId ||
                String(current?.['stream_id']) !== String(vodId)
            )
                return;
            store.setSelectedItem({ ...current, info } as unknown as TItem);
            await enrichVodSelectionWithTmdb(
                store,
                enrichment,
                vodId,
                isCurrentRequest
            );
        });

    const details = await enrichment.enrichMovie({
        tmdbId: info.tmdb_id,
        title: info.name,
        originalTitle: info.o_name,
        year: extractYear(info.releasedate, info.name),
        ...(matchIdentity ? { matchIdentity } : {}),
    });
    if (!details) {
        return;
    }

    const mergers = await loadTmdbMergers().catch(() => null);
    if (!mergers) return;

    const current = isCurrent();
    const currentInfo = getXtreamVodInfo(
        current as unknown as XtreamVodDetails | null
    );
    if (!current || !currentInfo) {
        return;
    }

    try {
        store.setSelectedItem({
            ...current,
            info: preserveXtreamProviderIdentity(
                info,
                mergers.mergeVodInfoWithTmdb(currentInfo, details),
                !!matchIdentity &&
                    matches?.read(matchIdentity)?.mode === 'manual'
            ),
        } as unknown as TItem);
    } catch (error) {
        // Never degrade provider data over a malformed payload shape
        console.warn('[TMDB] VOD merge failed:', error);
    }
}

export async function enrichSerialSelectionWithTmdb<
    TItem extends SelectionRecord,
>(
    store: EnrichableSelectionStore<TItem>,
    enrichment: TmdbEnrichmentService,
    serialId: string | number,
    isCurrentRequest: () => boolean = () => true
): Promise<void> {
    if (!enrichment.isEnabled()) {
        return;
    }

    const playlistId = store.currentPlaylist?.()?.id;
    const matchIdentity: TmdbMatchIdentity | undefined = playlistId
        ? {
              provider: 'xtream',
              playlistId,
              mediaType: 'tv',
              itemId: String(serialId),
          }
        : undefined;
    const matches = matchIdentity ? await enrichment.getMatches?.() : null;
    if (matchIdentity && !matches) return;
    const version = matchIdentity ? matches?.version(matchIdentity) : undefined;

    const isCurrent = (): TItem | null => {
        if (
            !isCurrentRequest() ||
            (matchIdentity &&
                (matches?.version(matchIdentity) !== version ||
                    store.currentPlaylist?.()?.id !== playlistId))
        ) {
            return null;
        }
        const item = store.selectedItem();
        return item && String(item['series_id']) === String(serialId)
            ? item
            : null;
    };

    const selected = isCurrent() as unknown as XtreamSerieDetails | null;
    const info = selected?.info;
    if (!info || Array.isArray(info)) {
        return;
    }

    if (matchIdentity && matches)
        matches.register(store, matchIdentity, async () => {
            const current = store.selectedItem();
            if (
                !isCurrentRequest() ||
                store.currentPlaylist?.()?.id !== playlistId ||
                String(current?.['series_id']) !== String(serialId)
            )
                return;
            store.resetTmdbSeasonMetadata?.(serialId);
            store.setSelectedItem({
                ...current,
                info,
                episodes: selected.episodes,
                tmdb_season_overviews: undefined,
                tmdb_season_posters: undefined,
            } as unknown as TItem);
            await enrichSerialSelectionWithTmdb(
                store,
                enrichment,
                serialId,
                isCurrentRequest
            );
        });

    if (
        !info.name?.trim() &&
        (!matchIdentity || matches?.read(matchIdentity)?.mode !== 'manual')
    )
        return;

    const details = await enrichment.enrichTv({
        title: info.name ?? '',
        year: extractYear(info.releaseDate, info.name),
        ...(matchIdentity ? { matchIdentity } : {}),
    });
    if (!details) {
        return;
    }

    const mergers = await loadTmdbMergers().catch(() => null);
    if (!mergers) return;

    const current = isCurrent();
    const currentInfo = (current as unknown as XtreamSerieDetails | null)?.info;
    if (!current || !currentInfo || Array.isArray(currentInfo)) {
        return;
    }

    try {
        store.setSelectedItem({
            ...current,
            info: preserveXtreamProviderIdentity(
                info,
                mergers.mergeSerieInfoWithTmdb(currentInfo, details),
                !!matchIdentity &&
                    matches?.read(matchIdentity)?.mode === 'manual'
            ),
        } as unknown as TItem);
    } catch (error) {
        console.warn('[TMDB] series merge failed:', error);
    }
}

/**
 * Lazy per-season enrichment, fired when the user opens a season.
 * Requires a prior show-level match (`info.tmdb_id` set by
 * enrichSerialSelectionWithTmdb). Merges real episode names, overviews and
 * stills into `episodes[seasonKey]` by episode number, and stores the
 * TMDB season overview in `tmdb_season_overviews[seasonKey]` — the detail
 * view's fallback when the provider season overview is empty or URL junk.
 */
export async function enrichSerialSeasonWithTmdb<TItem extends SelectionRecord>(
    store: EnrichableSelectionStore<TItem>,
    enrichment: TmdbEnrichmentService,
    seasonKey: string,
    isCurrentSelection: () => boolean = () => true
): Promise<void> {
    if (!enrichment.isEnabled() || !isCurrentSelection()) {
        return;
    }

    const selected = store.selectedItem() as unknown as
        (XtreamSerieDetails & { series_id?: string | number }) | null;
    const serialId = selected?.series_id;
    const info = selected?.info;
    const episodes = selected?.episodes?.[seasonKey];
    if (
        serialId === undefined ||
        !info ||
        Array.isArray(info) ||
        !info.tmdb_id ||
        !episodes?.length
    ) {
        return;
    }

    const providerSeasonNumber = Number(episodes[0]?.season ?? seasonKey);
    const playlistId = store.currentPlaylist?.()?.id;
    const matchIdentity: TmdbMatchIdentity | undefined = playlistId
        ? {
              provider: 'xtream',
              playlistId,
              mediaType: 'tv',
              itemId: String(serialId),
          }
        : undefined;
    const matches = matchIdentity ? await enrichment.getMatches?.() : null;
    if (!isCurrentSelection() || (matchIdentity && !matches)) return;
    const version = matchIdentity ? matches?.version(matchIdentity) : undefined;
    const isCurrentChoice = () => {
        if (!matchIdentity) return true;
        const choice = matches?.read(matchIdentity);
        return (
            store.currentPlaylist?.()?.id === playlistId &&
            matches?.version(matchIdentity) === version &&
            choice?.mode !== 'provider' &&
            (choice?.mode !== 'manual' || choice.tmdbId === info.tmdb_id)
        );
    };
    if (!isCurrentChoice()) return;

    if (!Number.isFinite(providerSeasonNumber)) {
        return;
    }

    // Per-season provider slices ("The Mandalorian (2 season)") renumber
    // their single season to 1 — the title marker names the real TMDB season
    const seasonNumber = resolveEnrichmentSeasonNumber({
        rawTitle: info.name,
        providerSeasonNumber,
        providerSeasonCount: Object.keys(selected?.episodes ?? {}).length,
    });

    const season = await enrichment.getSeason(info.tmdb_id, seasonNumber);
    const tmdbEpisodes = season?.episodes ?? [];
    const seasonOverview = season?.overview?.trim() || null;
    const seasonPoster = tmdbSeasonPosterUrl(season?.poster_path);
    if (
        (!tmdbEpisodes.length && !seasonOverview && !seasonPoster) ||
        !isCurrentSelection() ||
        !isCurrentChoice()
    ) {
        return;
    }

    const current = store.selectedItem() as unknown as
        (XtreamSerieDetails & { series_id?: string | number }) | null;
    const currentEpisodes = current?.episodes?.[seasonKey];
    if (
        !current ||
        current.info?.tmdb_id !== info.tmdb_id ||
        String(current.series_id) !== String(serialId) ||
        !currentEpisodes?.length
    ) {
        return;
    }

    try {
        const mergedEpisodes = tmdbEpisodes.length
            ? mergeEpisodesWithTmdb(currentEpisodes, tmdbEpisodes)
            : null;
        // The detail view re-fires enrichment on every selection write, so
        // a repeat cache-served run must converge: write only what actually
        // changed, or each write would schedule the next run forever.
        const episodesChanged =
            mergedEpisodes !== null &&
            JSON.stringify(mergedEpisodes) !== JSON.stringify(currentEpisodes);
        const overviewChanged =
            seasonOverview !== null &&
            current.tmdb_season_overviews?.[seasonKey] !== seasonOverview;
        const posterChanged =
            seasonPoster !== null &&
            current.tmdb_season_posters?.[seasonKey] !== seasonPoster;
        if (!episodesChanged && !overviewChanged && !posterChanged) {
            return;
        }
        store.setSelectedItem({
            ...current,
            ...(episodesChanged
                ? {
                      episodes: {
                          ...current.episodes,
                          [seasonKey]: mergedEpisodes,
                      },
                  }
                : {}),
            ...(overviewChanged
                ? {
                      tmdb_season_overviews: {
                          ...current.tmdb_season_overviews,
                          [seasonKey]: seasonOverview,
                      },
                  }
                : {}),
            ...(posterChanged
                ? {
                      tmdb_season_posters: {
                          ...current.tmdb_season_posters,
                          [seasonKey]: seasonPoster,
                      },
                  }
                : {}),
        } as unknown as TItem);
    } catch (error) {
        console.warn('[TMDB] season merge failed:', error);
    }
}
