import type { MediaStreamMetadata } from './media-stream-metadata.interface';

export interface XtreamAccountInfoDialogPlaylist {
    id: string;
    name?: string;
    title?: string;
    serverUrl: string;
    username: string;
    password: string;
}

export interface XtreamAccountInfoVodStreamItem {
    added?: string | number;
    audioLanguages?: string[];
    category_id?: string | number;
    container_extension?: string;
    cover?: string;
    cover_big?: string;
    direct_source?: string | null;
    duplicateVariants?: XtreamAccountInfoVodStreamItem[];
    id?: string | number;
    imdbId?: string;
    imdb_id?: string;
    imdbMatchedTitle?: string;
    imdbMatchedYear?: string | number;
    info?:
        | {
              readonly audioLanguages?: string[];
              readonly cover?: string;
              readonly cover_big?: string;
              readonly movie_image?: string;
              readonly name?: string;
              readonly o_name?: string;
              readonly releaseDate?: string;
              readonly releasedate?: string;
              readonly subtitleLanguages?: string[];
              readonly tmdb_id?: string | number;
              readonly title?: string;
              readonly tvdb_id?: string | number;
          }
        | []
        | null;
    mediaMetadata?: MediaStreamMetadata;
    movie_data?: {
        readonly audioLanguages?: string[];
        readonly container_extension?: string;
        readonly name?: string;
        readonly stream_id?: string | number;
        readonly subtitleLanguages?: string[];
        readonly tmdb_id?: string | number;
        readonly title?: string;
        readonly tvdb_id?: string | number;
    };
    movie_image?: string;
    name?: string;
    original_name?: string;
    o_name?: string;
    poster_url?: string;
    releaseDate?: string;
    releasedate?: string;
    stream_id?: string | number;
    stream_icon?: string;
    subtitleLanguages?: string[];
    title?: string;
    tmdbId?: string | number;
    tmdb_id?: string | number;
    tvdbId?: string | number;
    tvdb_id?: string | number;
    xtream_id?: string | number;
    year?: string | number;
}

export interface XtreamAccountInfoDialogData {
    vodStreamsCount?: number;
    liveStreamsCount?: number;
    seriesCount?: number;
    vodStreams?: XtreamAccountInfoVodStreamItem[];
    playlist?: XtreamAccountInfoDialogPlaylist;
}
