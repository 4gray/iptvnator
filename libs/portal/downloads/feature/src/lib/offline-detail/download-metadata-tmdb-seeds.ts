import type {
    DownloadMetadataSnapshot,
    StalkerVodInfo,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';

export function movieSeed(snapshot: DownloadMetadataSnapshot): XtreamVodInfo {
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

export function seriesSeed(
    snapshot: DownloadMetadataSnapshot
): XtreamSerieInfo {
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

export function stalkerSeed(
    snapshot: DownloadMetadataSnapshot
): StalkerVodInfo {
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
