import { Injectable, inject, signal } from '@angular/core';
import { TmdbEnrichmentService, TmdbMovieDetails } from '@iptvnator/services';
import { Channel, releaseTagYear } from '@iptvnator/shared/interfaces';

export type M3uVodMetadataStatus = 'idle' | 'loading' | 'matched' | 'none';

export interface M3uVodMetadataState {
    /** Channel the current state belongs to — staleness anchor */
    channelId: string | null;
    status: M3uVodMetadataStatus;
    details: TmdbMovieDetails | null;
}

const IDLE_STATE: M3uVodMetadataState = {
    channelId: null,
    status: 'idle',
    details: null,
};

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
        const channelId = channel.id;
        if (this.stateSignal().channelId === channelId) {
            return;
        }

        if (!this.tmdb.isEnabled()) {
            this.stateSignal.set({ channelId, status: 'none', details: null });
            return;
        }

        this.stateSignal.set({ channelId, status: 'loading', details: null });

        // `releaseTagYear` reads only bracketed/trailing release TAGS, never
        // a year that is part of the film's name ("2001: A Space Odyssey").
        void this.tmdb
            .enrichMovie({
                title: channel.name,
                year: releaseTagYear(channel.name),
            })
            .then(
                (details) => this.settle(channelId, details),
                () => this.settle(channelId, null)
            );
    }

    reset(): void {
        this.stateSignal.set(IDLE_STATE);
    }

    private settle(channelId: string, details: TmdbMovieDetails | null): void {
        if (this.stateSignal().channelId !== channelId) {
            return;
        }

        this.stateSignal.set({
            channelId,
            status: details ? 'matched' : 'none',
            details,
        });
    }
}
