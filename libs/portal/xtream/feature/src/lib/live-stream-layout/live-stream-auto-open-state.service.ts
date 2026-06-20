import { Injectable, signal } from '@angular/core';

@Injectable()
export class LiveStreamAutoOpenStateService {
    readonly pendingItemId = signal<number | null>(null);

    captureFromHistoryState(): void {
        const requestedItemId = Number(
            (window.history.state as Record<string, unknown> | null)?.[
                'openXtreamLiveItemId'
            ]
        );
        if (Number.isFinite(requestedItemId) && requestedItemId > 0) {
            this.pendingItemId.set(requestedItemId);
            return;
        }

        this.pendingItemId.set(null);
    }

    clearPendingItem(): void {
        this.pendingItemId.set(null);
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
            delete nextState['openXtreamLiveTitle'];
            delete nextState['openXtreamLivePoster'];
            window.history.replaceState(nextState, document.title);
        } catch {
            // Browser history state can be unavailable in restricted contexts.
        }
    }
}
