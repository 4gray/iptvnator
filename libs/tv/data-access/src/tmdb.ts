import {
    enrichedCast,
    enrichedCreators,
    enrichedDirectors,
    limitCast,
    topCast,
    unifiedTvCast,
} from '@iptvnator/shared/tmdb/credits';
import { TmdbSeasonClient } from '@iptvnator/shared/tmdb/season';
import {
    TmdbApiClient,
    TmdbIdResolver,
    TmdbMemoryCache,
    TmdbMetadataClient,
    TmdbPersonClient,
    isGenericEpisodeTitle,
    type TmdbTvDetails,
    type TmdbMovieDetails,
    extractYear,
    toTmdbLanguage,
    tmdbBackdropUrl,
    tmdbPosterUrl,
    tmdbStillUrl,
} from '@iptvnator/shared/tmdb';
import {
    pickSeasonMarkedTitle,
    resolveEnrichmentSeasonNumber,
    parseFacetYear,
} from '@iptvnator/shared/interfaces';
import {
    artwork,
    Media,
    UserData,
    withSeriesContext,
} from '@iptvnator/tv/util';

/** The caller owns cancellation; the deadline also bounds offline/slow API calls. */
async function withDeadline<T>(
    signal: AbortSignal,
    work: (signal: AbortSignal) => Promise<T>
) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel);
    if (signal.aborted) cancel();
    const timer = setTimeout(cancel, 8000);
    try {
        return await work(controller.signal);
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
    }
}

export function checkTmdbKey(key: string, signal: AbortSignal) {
    return withDeadline(signal, (abort) =>
        new TmdbApiClient(abort).validateApiKey(key.trim())
    );
}

/** One settings snapshot owns its cache: replacing/disabling the key retires it. */
export class TvMetadata {
    private readonly cache = new TmdbMemoryCache();
    constructor(private readonly settings: UserData['tmdb']) {}
    private enabled() {
        return this.settings.enabled && !!this.settings.apiKey.trim();
    }
    private runtime() {
        return {
            isEnabled: () => this.enabled(),
            apiKey: () => this.settings.apiKey.trim(),
            appLanguage: () => this.settings.language,
            language: () => toTmdbLanguage(this.settings.language),
        };
    }
    getPerson(personId: number, signal: AbortSignal) {
        return withDeadline(signal, (abort) =>
            new TmdbPersonClient(
                this.runtime(),
                new TmdbApiClient(abort),
                this.cache
            ).getPersonDetails(personId)
        );
    }
    async enrich(
        item: Media,
        signal: AbortSignal
    ): Promise<{ item: Media; failed: boolean }> {
        if (
            !this.enabled() ||
            !(
                ['movie', 'series'].includes(item.kind) ||
                (item.kind === 'episode' && item.seriesTitle)
            ) ||
            signal.aborted
        )
            return { item, failed: false };
        return withDeadline(signal, async (abort) => {
            let failed = false;
            const runtime = this.runtime();
            const api = new TmdbApiClient(abort);
            const client = new TmdbMetadataClient(
                runtime,
                api,
                this.cache,
                new TmdbIdResolver(runtime, api, this.cache),
                () => {
                    failed = true;
                }
            );
            const payload = item.raw.details as
                { info?: Record<string, unknown> } | undefined;
            const info = payload?.info ?? item.raw;
            const query = {
                title: item.seriesTitle || item.title,
                originalTitle:
                    typeof info.original_name === 'string'
                        ? info.original_name
                        : undefined,
                year: extractYear(
                    item.seriesYear || item.year,
                    item.seriesTitle || item.title
                ),
                // Series provider IDs are not show-level TMDB IDs.
                tmdbId:
                    item.kind === 'movie'
                        ? (info.tmdb_id as string | number | undefined)
                        : undefined,
            };
            const details =
                item.kind === 'movie'
                    ? await client.enrichMovie(query)
                    : await client.enrichTv(query);
            if (signal.aborted || abort.aborted || !details)
                return {
                    item,
                    failed: !signal.aborted && (failed || abort.aborted),
                };
            return {
                item: {
                    ...item,
                    poster:
                        artwork(tmdbPosterUrl(details.poster_path)) ??
                        item.poster,
                    backdrop:
                        artwork(tmdbBackdropUrl(details.backdrop_path)) ??
                        item.backdrop,
                    description:
                        item.kind === 'episode'
                            ? item.description || details.overview?.trim()
                            : details.overview?.trim() || item.description,
                    metadata: {
                        tmdbId: details.id,
                        cast: enrichedCast(
                            item.kind === 'movie'
                                ? topCast(details.credits)
                                : limitCast(
                                      unifiedTvCast(details as TmdbTvDetails)
                                  )
                        ),
                        authors:
                            item.kind === 'movie'
                                ? enrichedDirectors(details.credits)
                                : enrichedCreators(details as TmdbTvDetails),
                        authorRole:
                            item.kind === 'movie' ? 'Directors' : 'Creators',
                        year: parseFacetYear(
                            item.kind === 'movie'
                                ? (details as TmdbMovieDetails).release_date
                                : (details as TmdbTvDetails).first_air_date
                        )?.toString(),
                        genres: details.genres?.map((genre) => genre.name),
                        countries: details.production_countries?.length
                            ? details.production_countries.map(
                                  (country) =>
                                      country.name || country.iso_3166_1 || ''
                              )
                            : details.origin_country,
                        durationMinutes:
                            item.kind === 'movie'
                                ? (details as TmdbMovieDetails).runtime
                                : (
                                      details as TmdbTvDetails
                                  ).episode_run_time?.find(
                                      (minutes) =>
                                          Number.isFinite(minutes) &&
                                          minutes > 0
                                  ),
                        rating:
                            details.vote_count && details.vote_count > 0
                                ? details.vote_average
                                : undefined,
                    },
                },
                failed,
            };
        });
    }

    async enrichEpisodes(
        parent: Media,
        episodes: Media[],
        season: number,
        signal: AbortSignal
    ) {
        const owned = episodes.filter(
            (e) => e.parentId === parent.id && e.sourceId === parent.sourceId
        );
        if (
            !this.enabled() ||
            parent.kind !== 'series' ||
            !parent.metadata ||
            !owned.length ||
            signal.aborted
        )
            return { items: episodes, failed: false };
        return withDeadline(signal, async (abort) => {
            let failed = false;
            const number = resolveEnrichmentSeasonNumber({
                rawTitle: pickSeasonMarkedTitle(
                    ...[
                        parent.title,
                        parent.raw.name,
                        parent.raw.o_name,
                        parent.raw.title,
                    ].filter(
                        (title): title is string => typeof title === 'string'
                    )
                ),
                providerSeasonNumber: season,
                providerSeasonCount: new Set(owned.map((e) => e.season ?? 1))
                    .size,
            });
            const payload = await new TmdbSeasonClient(
                this.runtime(),
                new TmdbApiClient(abort),
                this.cache,
                () => {
                    failed = true;
                }
            ).getSeason(parent.metadata!.tmdbId, number);
            if (signal.aborted || abort.aborted || !payload)
                return {
                    items: episodes,
                    failed: !signal.aborted && (failed || abort.aborted),
                };
            const byNumber = new Map(
                (payload.episodes ?? []).map((e) => [e.episode_number, e])
            );
            return {
                failed,
                items: episodes.map((e) => {
                    const match =
                        e.parentId === parent.id &&
                        e.sourceId === parent.sourceId &&
                        (e.season ?? 1) === season
                            ? byNumber.get(e.episode ?? -1)
                            : undefined;
                    return !match
                        ? e
                        : withSeriesContext(
                              {
                                  ...e,
                                  title:
                                      match.name?.trim() &&
                                      isGenericEpisodeTitle(e.title)
                                          ? match.name
                                          : e.title,
                                  description:
                                      match.overview?.trim() || e.description,
                                  episodeStill:
                                      artwork(tmdbStillUrl(match.still_path)) ||
                                      e.episodeStill,
                              },
                              parent
                          );
                }),
            };
        });
    }
}
