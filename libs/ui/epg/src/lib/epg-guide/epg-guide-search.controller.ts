import { computed, signal } from '@angular/core';
import { EpgGuideSearchHit } from './epg-guide-source';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_RESULTS = 20;
/** Shortest query that runs a search — and shows the results panel. */
export const EPG_GUIDE_SEARCH_MIN_LENGTH = 2;

/**
 * Debounced programme search for the guide toolbar. The host's
 * `searchPrograms` is optional, so `enabled` decides whether the field is
 * rendered at all; a response is dropped when the query moved on while it was
 * in flight, and a failing search yields no results rather than an error.
 */
export class EpgGuideSearchController {
    readonly query = signal('');
    readonly results = signal<EpgGuideSearchHit[]>([]);
    readonly enabled: boolean;
    /** True while the query is long enough for the results panel to show. */
    readonly panelVisible = computed(
        () =>
            this.enabled &&
            this.query().trim().length >= EPG_GUIDE_SEARCH_MIN_LENGTH
    );

    private timer?: number;

    constructor(
        private readonly search?: (
            query: string
        ) => Promise<EpgGuideSearchHit[]>
    ) {
        this.enabled = typeof search === 'function';
    }

    setQuery(query: string): void {
        this.query.set(query);
        window.clearTimeout(this.timer);
        const term = query.trim();
        if (term.length < EPG_GUIDE_SEARCH_MIN_LENGTH || !this.search) {
            this.results.set([]);
            return;
        }
        this.timer = window.setTimeout(async () => {
            // The host's search may throw synchronously (before it ever
            // returns a promise), which `.catch()` alone would not contain.
            const hits = await this.runSearch(term);
            if (this.query() === query) {
                this.results.set(hits.slice(0, SEARCH_MAX_RESULTS));
            }
        }, SEARCH_DEBOUNCE_MS);
    }

    destroy(): void {
        window.clearTimeout(this.timer);
    }

    private async runSearch(term: string): Promise<EpgGuideSearchHit[]> {
        try {
            return (await this.search?.(term)) ?? [];
        } catch {
            return [];
        }
    }
}
