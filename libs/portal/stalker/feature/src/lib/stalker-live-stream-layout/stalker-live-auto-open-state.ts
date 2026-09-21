import { signal } from '@angular/core';
import { normalizeStalkerEntityId } from '@iptvnator/portal/stalker/data-access';
import {
    OPEN_STALKER_LIVE_CATEGORY_STATE_KEY,
    OPEN_STALKER_LIVE_ITEM_STATE_KEY,
    OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY,
    OPEN_STALKER_LIVE_POSTER_STATE_KEY,
    OPEN_STALKER_LIVE_TITLE_STATE_KEY,
} from '@iptvnator/portal/shared/util';

/**
 * The live handoff carried by the arrival's history state, and nothing else:
 * which channel, in which portal, with which remembered genre. The
 * counterpart of Xtream's `LiveStreamAutoOpenStateService`, kept apart from
 * the coordinator that decides WHEN to act on it
 * (`StalkerLiveAutoOpen`), because reading and retiring the browser state is
 * a separate concern from waiting for the portal, the list and the user.
 *
 * `generation` is what makes a retired handoff final: work already in flight
 * for it (a full-list preload promise) captures the value and drops itself
 * when it no longer matches.
 */
export class StalkerLiveAutoOpenState {
    readonly pendingItemId = signal<string | null>(null);
    readonly pendingPlaylistId = signal<string | null>(null);
    readonly pendingCategoryId = signal<string | null>(null);

    private currentGeneration = 0;

    get generation(): number {
        return this.currentGeneration;
    }

    /**
     * Reads the arrival's handoff. Returns true when a NEW pending item was
     * recorded, so the caller can retire whatever the previous one started.
     */
    captureFromHistoryState(): boolean {
        const state = (window.history.state ?? null) as Record<
            string,
            unknown
        > | null;
        const itemId = normalizeStalkerEntityId(
            state?.[OPEN_STALKER_LIVE_ITEM_STATE_KEY]
        );
        if (!itemId) {
            this.clearPendingItem();
            return false;
        }

        this.pendingPlaylistId.set(
            normalizeStalkerEntityId(
                state?.[OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY]
            ) || null
        );
        this.pendingCategoryId.set(
            normalizeStalkerEntityId(
                state?.[OPEN_STALKER_LIVE_CATEGORY_STATE_KEY]
            ) || null
        );
        this.currentGeneration += 1;
        this.pendingItemId.set(itemId);
        return true;
    }

    clearPendingItem(): void {
        this.currentGeneration += 1;
        this.pendingItemId.set(null);
        this.pendingPlaylistId.set(null);
        this.pendingCategoryId.set(null);
    }

    /** Retires the handoff from the history entry so it cannot replay. */
    clearHistoryState(): void {
        try {
            const state = (window.history.state ?? {}) as Record<
                string,
                unknown
            >;
            if (!(OPEN_STALKER_LIVE_ITEM_STATE_KEY in state)) {
                return;
            }

            const nextState = { ...state };
            delete nextState[OPEN_STALKER_LIVE_ITEM_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_PLAYLIST_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_CATEGORY_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_TITLE_STATE_KEY];
            delete nextState[OPEN_STALKER_LIVE_POSTER_STATE_KEY];
            window.history.replaceState(nextState, document.title);
        } catch {
            // Browser history state can be unavailable in restricted contexts.
        }
    }
}
