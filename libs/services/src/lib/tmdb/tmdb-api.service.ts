import { Injectable } from '@angular/core';
import { TmdbApiClient } from '@iptvnator/shared/tmdb';
export { TmdbApiError, isTmdbNotFound } from '@iptvnator/shared/tmdb';

@Injectable({ providedIn: 'root' })
export class TmdbApiService extends TmdbApiClient {
    constructor() {
        super();
    }
}
