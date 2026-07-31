import type {
    DownloadMetadataPerson,
    DownloadMetadataSnapshot,
    TmdbEnrichedCastMember,
    XtreamSerieEpisode,
    XtreamSerieEpisodeInfo,
} from '@iptvnator/shared/interfaces';
import type { StalkerSelectedVodItem } from '@iptvnator/portal/stalker/data-access';
import {
    createMovieDownloadSnapshot,
    createSeriesEpisodeDownloadSnapshot,
} from '@iptvnator/portal/shared/util';

interface StalkerSeriesDownloadSnapshotInput {
    item: StalkerSelectedVodItem;
    episode: XtreamSerieEpisode;
    language: string;
    seriesTitle: string;
    /** Values already selected for the persisted download row. */
    seasonNumber: unknown;
    episodeNumber: unknown;
}

function textList(value: string | undefined): string[] | undefined {
    const entries = value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries?.length ? entries : undefined;
}

function finiteNumber(value: string | number | undefined) {
    if (value === undefined || String(value).trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function releaseYear(value: string | undefined): number | undefined {
    const match = value?.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
}

function people(
    enriched: TmdbEnrichedCastMember[] | undefined,
    fallback: string | undefined
): DownloadMetadataPerson[] | undefined {
    return enriched?.length
        ? enriched.map((person) => ({
              name: person.name,
              role: person.character,
              profileUrl: person.profileUrl ?? undefined,
              tmdbPersonId: person.tmdbPersonId,
          }))
        : textList(fallback)?.map((name) => ({ name }));
}

function rowCoordinate(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function createStalkerSeriesDownloadSnapshot(
    input: StalkerSeriesDownloadSnapshotInput
): DownloadMetadataSnapshot {
    const info = input.item.info;
    const common = {
        language: input.language,
        title: input.seriesTitle.trim() || 'Series',
        originalTitle: info?.o_name,
        plot: info?.description,
        releaseDate: info?.releasedate,
        year: releaseYear(info?.releasedate),
        genres: textList(info?.genre),
        rating: finiteNumber(info?.rating_imdb),
        status: info?.tmdb_status,
        posterUrl: info?.movie_image,
        backdropUrl: info?.tmdb_backdrop,
        tmdbId: info?.tmdb_id,
        providerCategoryId: input.item.category_id,
        cast: people(info?.tmdb_cast, info?.actors),
        creators: people(info?.tmdb_directors, info?.director),
    };
    const seasonNumber = rowCoordinate(input.seasonNumber);
    const episodeNumber = rowCoordinate(input.episodeNumber);
    if (seasonNumber === undefined || episodeNumber === undefined) {
        return { ...createMovieDownloadSnapshot(common), mediaKind: 'series' };
    }

    const episodeInfo = Array.isArray(input.episode.info)
        ? undefined
        : (input.episode.info as XtreamSerieEpisodeInfo);
    return createSeriesEpisodeDownloadSnapshot({
        ...common,
        episode: {
            seasonNumber,
            episodeNumber,
            title: input.episode.title,
            plot: episodeInfo?.plot,
            stillUrl: episodeInfo?.movie_image,
        },
    });
}
