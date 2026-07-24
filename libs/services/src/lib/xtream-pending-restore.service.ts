import { Injectable } from '@angular/core';
import {
    getXtreamPendingRestoreStorageKey,
    normalizeXtreamPendingRestoreState,
    XtreamPendingRestoreState,
} from '@iptvnator/shared/interfaces';

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

            // Persisted state may predate the current build (e.g. entries
            // written by versions affected by issue #1017), so it is
            // re-normalized on every read, not only on write.
            return normalizeXtreamPendingRestoreState(JSON.parse(rawState));
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
                JSON.stringify(normalizeXtreamPendingRestoreState(state))
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
}
