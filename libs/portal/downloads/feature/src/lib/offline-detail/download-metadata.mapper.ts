import {
    createMovieDownloadSnapshot,
    createSeriesEpisodeDownloadSnapshot,
} from '@iptvnator/portal/shared/util';
import {
    mergeSerieInfoWithTmdb,
    mergeStalkerInfoWithTmdb,
    mergeVodInfoWithTmdb,
    type TmdbMovieDetails,
    type TmdbTvDetails,
} from '@iptvnator/services';
import type {
    DownloadMetadataPerson,
    DownloadMetadataSnapshot,
} from '@iptvnator/shared/interfaces';
import {
    movieSeed,
    seriesSeed,
    stalkerSeed,
} from './download-metadata-tmdb-seeds';

export type DownloadMetadataProviderSource = 'xtream' | 'stalker';

export interface MapProviderToDownloadSnapshotInput {
    source: DownloadMetadataProviderSource;
    language: string;
    mediaKind: DownloadMetadataSnapshot['mediaKind'];
    fallback: DownloadMetadataSnapshot;
    provider: unknown;
}

type ProviderRecord = Record<string, unknown>;

function record(value: unknown): ProviderRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as ProviderRecord)
        : undefined;
}

function first(
    records: readonly (ProviderRecord | undefined)[],
    keys: readonly string[]
): unknown {
    for (const source of records) {
        for (const key of keys) {
            const value = source?.[key];
            if (value !== undefined && value !== null && value !== '') {
                return value;
            }
        }
    }
    return undefined;
}

function string(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') {
        return undefined;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : undefined;
}

function number(value: unknown): number | undefined {
    const parsed = typeof value === 'number' ? value : Number(string(value));
    return Number.isFinite(parsed) ? parsed : undefined;
}

function integer(value: unknown): number | undefined {
    const parsed = number(value);
    return parsed !== undefined && Number.isSafeInteger(parsed)
        ? parsed
        : undefined;
}

function strings(value: unknown): string[] | undefined {
    const values = Array.isArray(value) ? value : string(value)?.split(',');
    const normalized = values
        ?.map((entry) => string(entry))
        .filter((entry): entry is string => entry !== undefined);
    return normalized && normalized.length > 0 ? normalized : undefined;
}

function people(value: unknown): DownloadMetadataPerson[] | undefined {
    if (!Array.isArray(value)) {
        return strings(value)?.map((name) => ({ name }));
    }
    const normalized = value
        .map((entry): DownloadMetadataPerson | null => {
            const source = record(entry);
            const name = string(source?.['name']);
            if (!name) {
                return null;
            }
            const tmdbPersonId = integer(source?.['tmdbPersonId']);
            const role = string(source?.['character'] ?? source?.['role']);
            const profileUrl = string(source?.['profileUrl']);
            return {
                ...(tmdbPersonId === undefined ? {} : { tmdbPersonId }),
                name,
                ...(role === undefined ? {} : { role }),
                ...(profileUrl === undefined ? {} : { profileUrl }),
            };
        })
        .filter((entry): entry is DownloadMetadataPerson => entry !== null);
    return normalized.length > 0 ? normalized : undefined;
}

function backdrop(value: unknown): string | undefined {
    return string(Array.isArray(value) ? value[0] : value);
}

function releaseYear(value: string | undefined): number | undefined {
    const match = value?.match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
    return match ? Number(match[1]) : undefined;
}

function durationMinutes(
    records: readonly ProviderRecord[]
): number | undefined {
    const seconds = number(first(records, ['duration_secs']));
    if (seconds !== undefined && seconds > 0) {
        return Math.round(seconds / 60);
    }
    const minutes = number(
        first(records, ['durationMinutes', 'episode_run_time', 'runtime'])
    );
    return minutes !== undefined && minutes > 0
        ? Math.round(minutes)
        : undefined;
}

export function mapProviderToDownloadSnapshot({
    source,
    language,
    mediaKind,
    fallback,
    provider,
}: MapProviderToDownloadSnapshotInput): DownloadMetadataSnapshot {
    const root = record(provider) ?? {};
    const info = record(root['info']);
    const editorial = [info, root];
    const identity = [root, info];
    const title =
        (source === 'stalker'
            ? (string(info?.['name']) ??
              string(info?.['o_name']) ??
              string(root['o_name']) ??
              string(root['name']) ??
              string(root['title']))
            : string(first(identity, ['title', 'name']))) ?? fallback.title;
    const originalTitle =
        string(first(editorial, ['o_name', 'originalTitle'])) ??
        fallback.originalTitle;
    const plot =
        string(first(editorial, ['plot', 'description'])) ?? fallback.plot;
    const releaseDate =
        string(
            first(
                editorial,
                source === 'stalker'
                    ? ['releaseDate', 'releasedate', 'year']
                    : ['releaseDate', 'releasedate']
            )
        ) ?? fallback.releaseDate;
    const providerGenres = strings(
        first(
            editorial,
            source === 'stalker'
                ? ['genre', 'genres', 'genres_str']
                : ['genre', 'genres']
        )
    );
    const providerCast = people(
        first(editorial, ['tmdb_cast', 'actors', 'cast'])
    );
    const providerCreators = people(
        first(editorial, ['tmdb_directors', 'director', 'creators'])
    );
    const posterUrl =
        string(
            source === 'stalker'
                ? (info?.['movie_image'] ??
                      root['cover'] ??
                      root['screenshot_uri'] ??
                      root['logo'])
                : first(editorial, [
                      'movie_image',
                      'cover_big',
                      'cover',
                      'poster_url',
                      'posterUrl',
                      'logo',
                  ])
        ) ?? fallback.posterUrl;
    const backdropUrl =
        backdrop(
            first(editorial, ['tmdb_backdrop', 'backdrop_path', 'backdrop_url'])
        ) ?? fallback.backdropUrl;
    const rating =
        number(first(editorial, ['rating', 'rating_imdb'])) ?? fallback.rating;
    const status =
        string(first(editorial, ['tmdb_status', 'status'])) ?? fallback.status;
    const tmdbId =
        integer(first(editorial, ['tmdb_id', 'tmdbId'])) ?? fallback.tmdbId;
    const providerCategoryId =
        string(first(identity, ['category_id', 'providerCategoryId'])) ??
        fallback.providerCategoryId;
    const common = {
        language,
        title,
        originalTitle,
        plot,
        releaseDate,
        year: releaseYear(releaseDate) ?? fallback.year,
        durationMinutes:
            durationMinutes(editorial.filter(Boolean) as ProviderRecord[]) ??
            fallback.durationMinutes,
        genres: providerGenres ?? fallback.genres,
        rating,
        status,
        posterUrl,
        backdropUrl,
        tmdbId,
        providerCategoryId,
        cast: providerCast ?? fallback.cast,
        creators: providerCreators ?? fallback.creators,
    };

    if (mediaKind === 'movie') {
        return createMovieDownloadSnapshot(common);
    }
    if (!fallback.episode) {
        return {
            ...createMovieDownloadSnapshot(common),
            mediaKind: 'series',
        };
    }
    return createSeriesEpisodeDownloadSnapshot({
        ...common,
        episode: fallback.episode,
    });
}

export function mergeSnapshotWithTmdb(
    snapshot: DownloadMetadataSnapshot,
    details: TmdbMovieDetails | TmdbTvDetails,
    source: DownloadMetadataProviderSource
): DownloadMetadataSnapshot {
    const provider =
        source === 'stalker'
            ? mergeStalkerInfoWithTmdb(
                  stalkerSeed(snapshot),
                  details,
                  snapshot.mediaKind === 'movie' ? 'movie' : 'tv'
              )
            : snapshot.mediaKind === 'movie'
              ? mergeVodInfoWithTmdb(
                    movieSeed(snapshot),
                    details as TmdbMovieDetails
                )
              : mergeSerieInfoWithTmdb(
                    seriesSeed(snapshot),
                    details as TmdbTvDetails
                );
    return mapProviderToDownloadSnapshot({
        source,
        language: snapshot.language,
        mediaKind: snapshot.mediaKind,
        fallback: snapshot,
        provider,
    });
}
