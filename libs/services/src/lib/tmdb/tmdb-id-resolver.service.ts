import { Injectable, inject } from '@angular/core';
import { TmdbIdResolver } from '@iptvnator/shared/tmdb';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TmdbRuntimeService } from './tmdb-runtime.service';

@Injectable({ providedIn: 'root' })
export class TmdbIdResolverService extends TmdbIdResolver {
    constructor() {
        super(
            inject(TmdbRuntimeService),
            inject(TmdbApiService),
            inject(TmdbCacheService)
        );
    }
}
