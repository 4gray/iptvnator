import { Injectable, signal } from '@angular/core';

@Injectable()
export class LiveStreamAutoOpenStateService {
    readonly pendingItemId = signal<number | null>(null);
    /**
     * Playlist the pending item belongs to (`openXtreamLivePlaylistId`).
     * The shared XtreamStore still holds the previous playlist's catalog when
     * NavigationEnd fires, so a "not found" verdict counts only once the store
     * serves this playlist; `null` for legacy state without the key.
     */
    readonly pendingPlaylistId = signal<string | null>(null);

    captureFromHistoryState(): void {
        const state = window.history.state as Record<string, unknown> | null;
        const requestedItemId = Number(state?.['openXtreamLiveItemId']);
        if (Number.isFinite(requestedItemId) && requestedItemId > 0) {
            const playlistId = state?.['openXtreamLivePlaylistId'];
            this.pendingPlaylistId.set(
                typeof playlistId === 'string' && playlistId.trim()
                    ? playlistId.trim()
                    : null
            );
            this.pendingItemId.set(requestedItemId);
            return;
        }

        this.clearPendingItem();
    }

    clearPendingItem(): void {
        this.pendingItemId.set(null);
        this.pendingPlaylistId.set(null);
    }

    clearHistoryState(): void {
        try {
            const state = (window.history.state ?? {}) as Record<
                string,
                unknown
            >;
            if (!('openXtreamLiveItemId' in state)) {
                return;
            }

            const nextState = { ...state };
            delete nextState['openXtreamLiveItemId'];
            delete nextState['openXtreamLivePlaylistId'];
            delete nextState['openXtreamLiveTitle'];
            delete nextState['openXtreamLivePoster'];
            window.history.replaceState(nextState, document.title);
        } catch {
            // Browser history state can be unavailable in restricted contexts.
        }
    }
}
