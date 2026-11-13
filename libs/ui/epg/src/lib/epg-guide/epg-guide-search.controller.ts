import { computed, signal } from '@angular/core';
import { EpgGuideSearchHit, EpgGuideSearchUpdate } from './epg-guide-source';

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MAX_RESULTS = 20;
/** Shortest query that runs a search — and shows the results panel. */
export const EPG_GUIDE_SEARCH_MIN_LENGTH = 2;

/** Debounced programme search. Abandon the old request when the term changes. */
export class EpgGuideSearchController {
    readonly query = signal('');
    readonly results = signal<EpgGuideSearchHit[]>([]);
    readonly progress = signal<{ checked: number; total: number } | null>(null);
    readonly status = signal<'idle' | 'loading' | 'error'>('idle');
    readonly enabled: boolean;
    /** True while the query is long enough for the results panel to show. */
    readonly panelVisible = computed(
        () =>
            this.enabled &&
            this.query().trim().length >= EPG_GUIDE_SEARCH_MIN_LENGTH
    );

    private timer?: number;
    private request?: AbortController;

    constructor(
        private readonly search?: (
            query: string,
            signal: AbortSignal,
            report: (update: EpgGuideSearchUpdate) => void
        ) => Promise<EpgGuideSearchHit[]>
    ) {
        this.enabled = typeof search === 'function';
    }

    setQuery(query: string): void {
        this.query.set(query);
        this.destroy();
        this.results.set([]);
        this.progress.set(null);
        const term = query.trim();
        const search = this.search;
        if (term.length < EPG_GUIDE_SEARCH_MIN_LENGTH || !search) {
            this.status.set('idle');
            return;
        }
        const request = new AbortController();
        this.request = request;
        this.status.set('loading');
        this.timer = window.setTimeout(async () => {
            try {
                const hits = await search(
                    term,
                    request.signal,
                    ({ matches, checked, total }) => {
                        if (request.signal.aborted) return;
                        this.results.set(matches.slice(0, SEARCH_MAX_RESULTS));
                        this.progress.set({ checked, total });
                    }
                );
                if (!request.signal.aborted) {
                    this.results.set(hits.slice(0, SEARCH_MAX_RESULTS));
                    this.progress.set(null);
                    this.status.set('idle');
                }
            } catch {
                if (!request.signal.aborted) {
                    this.progress.set(null);
                    this.status.set('error');
                }
            }
        }, SEARCH_DEBOUNCE_MS);
    }

    destroy(): void {
        window.clearTimeout(this.timer);
        this.request?.abort();
    }
}
