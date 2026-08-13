import { Injectable, inject, signal } from '@angular/core';
import { TmdbEnrichmentService, TmdbMovieDetails } from '@iptvnator/services';
import { Channel, releaseTagYear } from '@iptvnator/shared/interfaces';

export type M3uVodMetadataStatus = 'idle' | 'loading' | 'matched' | 'none';

export interface M3uVodMetadataState {
    /**
     * The lookup this state belongs to — the staleness anchor. Both the id
     * AND the title, because the title is what is actually looked up: an id
     * alone would assume it determines the name, and nothing guarantees
     * that (`createChannel` falls back to the URL for a missing id, so two
     * entries pointing at one stream would share it).
     */
    lookupKey: string | null;
    status: M3uVodMetadataStatus;
    details: TmdbMovieDetails | null;
}

const IDLE_STATE: M3uVodMetadataState = {
    lookupKey: null,
    status: 'idle',
    details: null,
};

/** NUL keeps the two parts unambiguous whatever an entry is named. */
function lookupKeyOf(channel: Pick<Channel, 'id' | 'name'>): string {
    return `${channel.id}\u0000${channel.name ?? ''}`;
}

/**
 * TMDB lookup for an M3U entry recognized as a movie. Thin glue over
 * {@link TmdbEnrichmentService}: the resolver already normalizes titles
 * (brackets, quality tags, language prefixes) and caches verdicts, so the
 * only jobs here are the release-year hint and the staleness guard.
 *
 * Component-provided (not root): the state is scoped to one mounted detail
 * host, and dies with it.
 */
@Injectable()
export class M3uVodMetadataService {
    private readonly tmdb = inject(TmdbEnrichmentService);

    private readonly stateSignal = signal<M3uVodMetadataState>(IDLE_STATE);
    readonly state = this.stateSignal.asReadonly();

    /**
     * Resolve TMDB metadata for the channel. Zapping to another channel
     * while a request is in flight makes the stale resolution a no-op —
     * only the response for the channel the state currently tracks lands.
     */
    load(channel: Pick<Channel, 'id' | 'name'>): void {
        const lookupKey = lookupKeyOf(channel);
        if (this.stateSignal().lookupKey === lookupKey) {
            return;
        }

        if (!this.tmdb.isEnabled()) {
            this.stateSignal.set({ lookupKey, status: 'none', details: null });
            return;
        }

        this.stateSignal.set({ lookupKey, status: 'loading', details: null });

        // `releaseTagYear` reads only bracketed/trailing release TAGS, never
        // a year that is part of the film's name ("2001: A Space Odyssey").
        void this.tmdb
            .enrichMovie({
                title: channel.name,
                year: releaseTagYear(channel.name),
            })
            .then(
                (details) => this.settle(lookupKey, details),
                () => this.settle(lookupKey, null)
            );
    }

    reset(): void {
        this.stateSignal.set(IDLE_STATE);
    }

    private settle(lookupKey: string, details: TmdbMovieDetails | null): void {
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
