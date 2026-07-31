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
    StalkerVodInfo,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';

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
    language,
    mediaKind,
    fallback,
    provider,
}: MapProviderToDownloadSnapshotInput): DownloadMetadataSnapshot {
    const root = record(provider) ?? {};
    const info = record(root['info']);
    const editorial = [info, root];
    const identity = [root, info];
    const title = string(first(identity, ['title', 'name'])) ?? fallback.title;
    const originalTitle =
        string(first(editorial, ['o_name', 'originalTitle'])) ??
        fallback.originalTitle;
    const plot =
        string(first(editorial, ['plot', 'description'])) ?? fallback.plot;
    const releaseDate =
        string(first(editorial, ['releaseDate', 'releasedate'])) ??
        fallback.releaseDate;
    const providerGenres = strings(first(editorial, ['genre', 'genres']));
    const providerCast = people(
        first(editorial, ['tmdb_cast', 'actors', 'cast'])
    );
    const providerCreators = people(
        first(editorial, ['tmdb_directors', 'director', 'creators'])
    );
    const posterUrl =
        string(
            first(editorial, [
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

function movieSeed(snapshot: DownloadMetadataSnapshot): XtreamVodInfo {
    const cast = snapshot.cast?.map(({ name }) => name).join(', ') ?? '';
    return {
        kinopoisk_url: '',
        tmdb_id: snapshot.tmdbId ?? 0,
        name: snapshot.title,
        o_name: snapshot.originalTitle ?? '',
        cover_big: snapshot.posterUrl ?? '',
        movie_image: snapshot.posterUrl ?? '',
        releasedate: snapshot.releaseDate ?? '',
        episode_run_time: snapshot.durationMinutes ?? 0,
        youtube_trailer: '',
        director: snapshot.creators?.map(({ name }) => name).join(', ') ?? '',
        actors: cast,
        cast,
        description: snapshot.plot ?? '',
        plot: snapshot.plot ?? '',
        age: '',
        mpaa_rating: '',
        rating_count_kinopoisk: 0,
        country: '',
        genre: snapshot.genres?.join(', ') ?? '',
        backdrop_path: snapshot.backdropUrl ? [snapshot.backdropUrl] : [],
        duration_secs: (snapshot.durationMinutes ?? 0) * 60,
        duration: '',
        video: [],
        audio: [],
        bitrate: 0,
        rating: snapshot.rating ?? 0,
    };
}

function seriesSeed(snapshot: DownloadMetadataSnapshot): XtreamSerieInfo {
    return {
        name: snapshot.title,
        cover: snapshot.posterUrl ?? '',
        plot: snapshot.plot ?? '',
        cast: snapshot.cast?.map(({ name }) => name).join(', ') ?? '',
        director: snapshot.creators?.map(({ name }) => name).join(', ') ?? '',
        genre: snapshot.genres?.join(', ') ?? '',
        releaseDate: snapshot.releaseDate ?? '',
        last_modified: '',
        rating: snapshot.rating === undefined ? '' : String(snapshot.rating),
        rating_5based: 0,
        backdrop_path: snapshot.backdropUrl ? [snapshot.backdropUrl] : [],
        youtube_trailer: '',
        episode_run_time:
            snapshot.durationMinutes === undefined
                ? ''
                : String(snapshot.durationMinutes),
        category_id: snapshot.providerCategoryId ?? '',
        tmdb_id: snapshot.tmdbId,
    };
}

function stalkerSeed(snapshot: DownloadMetadataSnapshot): StalkerVodInfo {
    return {
        movie_image: snapshot.posterUrl ?? '',
        description: snapshot.plot ?? '',
        name: snapshot.title,
        o_name: snapshot.originalTitle,
        actors: snapshot.cast?.map(({ name }) => name).join(', ') ?? '',
        director: snapshot.creators?.map(({ name }) => name).join(', ') ?? '',
        releasedate: snapshot.releaseDate ?? '',
        genre: snapshot.genres?.join(', ') ?? '',
        rating_imdb:
            snapshot.rating === undefined ? '' : String(snapshot.rating),
        rating_kinopoisk: '',
        tmdb_id: snapshot.tmdbId,
    };
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
