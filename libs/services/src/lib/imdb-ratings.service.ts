import { Injectable } from '@angular/core';
import {
    ImdbMovieRatingRequestItem,
    ImdbMovieRatingsResponse,
} from 'shared-interfaces';

@Injectable({
    providedIn: 'root',
})
export class ImdbRatingsService {
    async resolveMovieRatings(
        items: ImdbMovieRatingRequestItem[]
    ): Promise<ImdbMovieRatingsResponse> {
        const electron = window.electron as typeof window.electron & {
            resolveImdbMovieRatings?: (
                requestItems: ImdbMovieRatingRequestItem[]
            ) => Promise<ImdbMovieRatingsResponse>;
        };

        if (!electron?.resolveImdbMovieRatings || items.length === 0) {
            return {
                status: 'ready',
                matches: {},
            };
        }

        return electron.resolveImdbMovieRatings(items);
    }
}
