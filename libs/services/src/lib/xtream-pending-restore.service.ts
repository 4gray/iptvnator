import { Injectable } from '@angular/core';
import {
    getXtreamPendingRestoreStorageKey,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

const EMPTY_RESTORE_STATE: XtreamPendingRestoreState = {
    hiddenCategories: [],
    favorites: [],
    recentlyViewed: [],
    playbackPositions: [],
};

@Injectable({
    providedIn: 'root',
})
export class XtreamPendingRestoreService {
    get(playlistId: string): XtreamPendingRestoreState | null {
        if (!playlistId) {
            return null;
        }

        try {
            const rawState = localStorage.getItem(
                getXtreamPendingRestoreStorageKey(playlistId)
            );

            if (!rawState) {
                return null;
            }

            return this.normalize(JSON.parse(rawState));
        } catch {
            return null;
        }
    }

    set(playlistId: string, state: XtreamPendingRestoreState): void {
        if (!playlistId) {
            return;
        }

        try {
            localStorage.setItem(
                getXtreamPendingRestoreStorageKey(playlistId),
                JSON.stringify(this.normalize(state))
            );
        } catch {
            // Ignore local storage write failures.
        }
    }

    clear(playlistId: string): void {
        if (!playlistId) {
            return;
        }

        try {
            localStorage.removeItem(
                getXtreamPendingRestoreStorageKey(playlistId)
            );
        } catch {
            // Ignore local storage remove failures.
        }
    }

    private normalize(value: unknown): XtreamPendingRestoreState {
        if (!value || typeof value !== 'object') {
            return { ...EMPTY_RESTORE_STATE };
        }

        const candidate = value as Partial<XtreamPendingRestoreState>;

        return {
            hiddenCategories: Array.isArray(candidate.hiddenCategories)
                ? candidate.hiddenCategories
                : [],
            favorites: Array.isArray(candidate.favorites)
                ? candidate.favorites
                : [],
            recentlyViewed: Array.isArray(candidate.recentlyViewed)
                ? candidate.recentlyViewed
                : [],
            playbackPositions: Array.isArray(candidate.playbackPositions)
                ? candidate.playbackPositions
                : [],
        };
    }
}
