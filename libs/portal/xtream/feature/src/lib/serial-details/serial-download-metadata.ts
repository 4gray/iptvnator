import type { DownloadMovieSnapshotInput } from '@iptvnator/portal/shared/util';
import type {
    DownloadMetadataPerson,
    TmdbEnrichedCastMember,
    XtreamSerieInfo,
} from '@iptvnator/shared/interfaces';

function textList(value: string | undefined): string[] | undefined {
    const entries = value
        ?.split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    return entries?.length ? entries : undefined;
}

function finiteNumber(value: number | string | undefined) {
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

export function createXtreamSeriesDownloadMetadataContext(
    info: XtreamSerieInfo,
    language: string
): DownloadMovieSnapshotInput {
    const runtimeMinutes = finiteNumber(info.episode_run_time);
    return {
        language,
        title: info.name?.trim() || 'Series',
        plot: info.plot,
        releaseDate: info.releaseDate,
        year: releaseYear(info.releaseDate),
        durationMinutes:
            runtimeMinutes && runtimeMinutes > 0
                ? Math.round(runtimeMinutes)
                : undefined,
        genres: textList(info.genre),
        rating: finiteNumber(info.rating),
        status: info.tmdb_status,
        posterUrl: info.cover,
        backdropUrl: info.backdrop_path?.[0],
        tmdbId: finiteNumber(info.tmdb_id),
        providerCategoryId: info.category_id,
        cast: people(info.tmdb_cast, info.cast),
        creators: people(info.tmdb_directors, info.director),
    };
}
