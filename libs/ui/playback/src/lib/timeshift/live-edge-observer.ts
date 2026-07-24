import { signal } from '@angular/core';
import { observeMediaLiveEdge } from './live-edge';

/**
 * Tracks whether a media element plays at the live edge and exposes the
 * result as a signal for the LIVE button. `sync(false)` detaches the media
 * listeners and resets the state.
 */
export class LiveEdgeObserver {
    readonly atLiveEdge = signal(false);
    private dispose: (() => void) | null = null;

    constructor(private readonly media: () => HTMLMediaElement | null) {}

    sync(active: boolean): void {
        this.dispose?.();
        this.dispose = null;
        const media = active ? this.media() : null;
        if (!media) {
            this.atLiveEdge.set(false);
            return;
        }
        this.dispose = observeMediaLiveEdge(media, (atLiveEdge) =>
            this.atLiveEdge.set(atLiveEdge)
        );
    }

    disconnect(): void {
        this.sync(false);
    }
}
