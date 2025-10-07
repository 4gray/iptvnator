export interface StalkerVodDetails {
    id: string;
    cmd: string;
    info: {
        movie_image: string;
        description: string;
        name: string;
        actors: string;
        director: string;
        releasedate: string;
        genre: string;
        rating_imdb: string;
        rating_kinopoisk: string;
    };
}
