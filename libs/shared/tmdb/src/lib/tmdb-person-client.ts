import { TmdbApiClient } from './tmdb-api-client';
import { TmdbClientCache, TmdbClientRuntime } from './tmdb-client-contracts';
import { TMDB_DETAILS_CACHE_TTL_MS } from './tmdb-config';
import { TmdbPersonDetails } from './tmdb.types';

/** Shared, opt-in person/combined-credits lookup with sanitized failures. */
export class TmdbPersonClient {
    constructor(
        private readonly runtime: TmdbClientRuntime,
        private readonly api: TmdbApiClient,
        private readonly cache: TmdbClientCache,
        private readonly report: (message: string) => void = () => undefined
    ) {}
    async getPersonDetails(
        personId: number
    ): Promise<TmdbPersonDetails | null> {
        if (
            !this.runtime.isEnabled() ||
            !Number.isInteger(personId) ||
            personId <= 0
        )
            return null;
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
                    /* Refetch corrupt cache rows. */
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
        } catch {
            this.report('TMDB person enrichment failed.');
            return null;
        }
    }
}
