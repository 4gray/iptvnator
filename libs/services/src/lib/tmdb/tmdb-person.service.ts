import { Injectable, inject } from '@angular/core';
import { TmdbPersonClient } from '@iptvnator/shared/tmdb';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';

/** Angular facade for the shared person/combined-credits client. */
@Injectable({ providedIn: 'root' })
export class TmdbPersonService {
    private readonly client = new TmdbPersonClient(
        inject(TmdbRuntimeService),
        inject(TmdbApiService),
        inject(TmdbCacheService),
        (message) => console.warn(message)
    );
    getPersonDetails(personId: number) {
        return this.client.getPersonDetails(personId);
    }
}
