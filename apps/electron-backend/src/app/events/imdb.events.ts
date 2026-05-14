import { ipcMain } from 'electron';
import { ImdbMovieRatingRequestItem } from 'shared-interfaces';
import { imdbRatingsService } from '../services/imdb-ratings.service';

export default class ImdbEvents {
    static bootstrapImdbEvents() {
        ipcMain.handle(
            'IMDB_RESOLVE_MOVIE_RATINGS',
            async (_event, items: ImdbMovieRatingRequestItem[]) =>
                imdbRatingsService.resolveMovieRatings(items)
        );
    }
}
