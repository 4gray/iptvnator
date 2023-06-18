export interface XtreamVodDetails {
    info: {
        kinopoisk_url: string;
        tmdb_id: number;
        name: string;
        o_name: string;
        cover_big: string;
        movie_image: string;
        releasedate: string;
        episode_run_time: number;
        youtube_trailer: string;
        director: string;
        actors: string;
        cast: string;
        description: string;
        plot: string;
        age: string;
        mpaa_rating: string;
        rating_count_kinopoisk: number;
        country: string;
        genre: string;
        backdrop_path: string[];
        duration_secs: number;
        duration: string;
        video: string[];
        audio: string[];
        bitrate: number;
        rating: number;
    };
    movie_data: {
        stream_id: number;
        name: string;
        added: string;
        category_id: string;
        container_extension: string;
        custom_sid: string;
        direct_source: string;
    };
}
