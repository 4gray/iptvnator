import { Injectable, inject, signal } from '@angular/core';
import { TmdbEnrichmentService, TmdbTvDetails } from '@iptvnator/services';

export type M3uSeriesMetadataStatus = 'idle' | 'loading' | 'matched' | 'none';

export interface M3uSeriesMetadataState {
    /** The lookup this state belongs to — the staleness anchor. */
    readonly lookupKey: string | null;
    readonly status: M3uSeriesMetadataStatus;
    readonly details: TmdbTvDetails | null;
}

const IDLE_STATE: M3uSeriesMetadataState = {
    lookupKey: null,
    status: 'idle',
    details: null,
};

/**
 * TMDB lookup for an aggregated M3U series — the sibling of the movie
 * detail's metadata service, and deliberately as thin.
 *
 * The enrichment service already normalizes provider titles (brackets,
 * quality tags, language prefixes) and caches its verdicts, so the only
 * work here is supplying the year hint the aggregator recovered and
 * guarding against a stale response landing after the viewer moved on.
 *
 * Component-provided rather than root: the state belongs to one mounted
 * detail page and should die with it.
 */
@Injectable()
export class M3uSeriesMetadataService {
    private readonly tmdb = inject(TmdbEnrichmentService);

    private readonly stateSignal = signal<M3uSeriesMetadataState>(IDLE_STATE);
    readonly state = this.stateSignal.asReadonly();

    /**
     * The title given here is the aggregator's DISPLAY title — the language
     * tag already removed. Sending "TR:MODERN FAMILY" to TMDB would search
     * for a show by that literal name and find nothing.
     */
    load(series: {
        key: string;
        title: string;
        yearHint: number | null;
    }): void {
        const lookupKey = series.key;
        if (this.stateSignal().lookupKey === lookupKey) {
            return;
        }

        if (!series.title.trim() || !this.tmdb.isEnabled()) {
            this.stateSignal.set({ lookupKey, status: 'none', details: null });
            return;
        }

        this.stateSignal.set({ lookupKey, status: 'loading', details: null });

        void this.tmdb
            .enrichTv({
                title: series.title,
                year: series.yearHint ?? undefined,
            })
            .then(
                (details) => this.settle(lookupKey, details),
                () => this.settle(lookupKey, null)
            );
    }

    reset(): void {
        this.stateSignal.set(IDLE_STATE);
    }

    private settle(lookupKey: string, details: TmdbTvDetails | null): void {
        // A response for a series the viewer has already navigated away from
        // must not overwrite the one now on screen.
        if (this.stateSignal().lookupKey !== lookupKey) {
            return;
        }

        this.stateSignal.set({
            lookupKey,
            status: details ? 'matched' : 'none',
            details,
        });
    }
}
