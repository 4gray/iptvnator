import { Injectable, inject } from '@angular/core';
import { TmdbApiService } from './tmdb-api.service';
import { TmdbCacheService } from './tmdb-cache.service';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import { TmdbRuntimeService } from './tmdb-runtime.service';
import { TmdbPersonDetails } from './tmdb.types';

/**
 * Person details with the full combined filmography, in the app language.
 * Cached like details payloads under the 'person' media type. Any failure
 * returns `null` — actor pages then show their empty state.
 */
@Injectable({ providedIn: 'root' })
export class TmdbPersonService {
    private readonly runtime = inject(TmdbRuntimeService);
    private readonly api = inject(TmdbApiService);
    private readonly cache = inject(TmdbCacheService);

    async getPersonDetails(
        personId: number
    ): Promise<TmdbPersonDetails | null> {
        if (
            !this.runtime.isEnabled() ||
            !Number.isInteger(personId) ||
            personId <= 0
        ) {
            return null;
        }

        try {
            const language = this.runtime.language();
            const lookupKey = `person:${personId}`;

            const cached = await this.cache.get('person', lookupKey, language);
            if (
                this.cache.isFresh(cached, TMDB_DETAILS_CACHE_TTL_MS) &&
                cached?.payload
            ) {
                try {
                    return JSON.parse(cached.payload) as TmdbPersonDetails;
                } catch {
                    // Corrupt cache row — fall through to a fresh fetch
                }
            }

            const person = await this.api.getPersonDetails(
                personId,
                language,
                this.runtime.apiKey()
            );

            await this.cache.set({
                mediaType: 'person',
                lookupKey,
                language,
                tmdbId: personId,
                payload: JSON.stringify(person),
            });

            return person;
        } catch (error) {
            console.warn('TMDB person enrichment failed:', error);
            return null;
        }
    }
}
