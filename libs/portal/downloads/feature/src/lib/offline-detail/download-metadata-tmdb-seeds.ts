import type {
    DownloadMetadataSnapshot,
    StalkerVodInfo,
    TmdbEnrichedCastMember,
    XtreamSerieInfo,
    XtreamVodInfo,
} from '@iptvnator/shared/interfaces';

const MAX_PEOPLE = 30;

interface SeedPeopleFields {
    tmdb_cast?: TmdbEnrichedCastMember[];
    tmdb_directors?: TmdbEnrichedCastMember[];
}

function seedPeople(
    people: DownloadMetadataSnapshot['cast']
): TmdbEnrichedCastMember[] | undefined {
    const seeded = people?.slice(0, MAX_PEOPLE).map((person) => ({
        name: person.name,
        ...(person.role === undefined ? {} : { character: person.role }),
        profileUrl: person.profileUrl ?? null,
        ...(person.tmdbPersonId === undefined
            ? {}
            : { tmdbPersonId: person.tmdbPersonId }),
    }));
    return seeded && seeded.length > 0 ? seeded : undefined;
}

function seedPeopleFields(
    snapshot: DownloadMetadataSnapshot
): SeedPeopleFields {
    const cast = seedPeople(snapshot.cast);
    const directors = seedPeople(snapshot.creators);
    return {
        ...(cast === undefined ? {} : { tmdb_cast: cast }),
        ...(directors === undefined ? {} : { tmdb_directors: directors }),
    };
}

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
        ...seedPeopleFields(snapshot),
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
        ...seedPeopleFields(snapshot),
    };
}

export function stalkerSeed(snapshot: DownloadMetadataSnapshot): {
    info: StalkerVodInfo;
} {
    return {
        info: {
            movie_image: snapshot.posterUrl ?? '',
            description: snapshot.plot ?? '',
            name: snapshot.title,
            o_name: snapshot.originalTitle,
            actors: snapshot.cast?.map(({ name }) => name).join(', ') ?? '',
            director:
                snapshot.creators?.map(({ name }) => name).join(', ') ?? '',
            releasedate: snapshot.releaseDate ?? '',
            genre: snapshot.genres?.join(', ') ?? '',
            rating_imdb:
                snapshot.rating === undefined ? '' : String(snapshot.rating),
            rating_kinopoisk: '',
            tmdb_id: snapshot.tmdbId,
            ...seedPeopleFields(snapshot),
        },
    };
}
